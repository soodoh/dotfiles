import {
	isRecord,
	nestedRecord,
	numericField,
	type ProviderUsageScope,
	parseOpenAiResetCreditsBody,
	parseOpenAiUsageBody,
	parseUtilization,
} from "./usage-quota";
import {
	type CopilotUsageDetails,
	LLMHUB_USAGE_PROVIDER_ID,
	type ProviderUsageAuthKind,
	type ProviderUsageState,
} from "./usage-render";
import { parseRetryAfterMs, retryUsageRequest } from "./usage-retry";

const PROVIDER_USAGE_FETCH_TIMEOUT_MS = 5000;
const PROVIDER_USAGE_FETCH_MAX_ATTEMPTS = 3;
const PROVIDER_USAGE_TRANSIENT_RETRY_BASE_MS = 50;
const PROVIDER_USAGE_THROTTLE_RETRY_BASE_MS = 1000;
const PROVIDER_USAGE_RETRY_MAX_DELAY_MS = 20_000;

export type ProviderUsageFetchAccess = {
	token?: string;
	baseUrl?: string;
};

export type ProviderUsageFetchResult = {
	state: ProviderUsageState;
	scope?: ProviderUsageScope;
	copilot?: CopilotUsageDetails;
};

type ProviderUsageFetcher = (
	fetchFn: typeof globalThis.fetch,
	access: ProviderUsageFetchAccess,
) => Promise<ProviderUsageFetchResult>;

export function normalizeBaseUrl(url: string): string {
	return url.trim().replace(/\/+$/, "");
}

function copilotNonNegativeNumber(value: unknown): number | undefined {
	const parsed = numericField(value);
	return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function copilotBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function copilotPercent(value: unknown): number | undefined {
	const parsed = copilotNonNegativeNumber(value);
	return parsed !== undefined && parsed <= 100 ? parsed : undefined;
}

function copilotDate(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	// Date-only resets mean midnight UTC; never interpret a zone-less time locally.
	if (!/^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(value))
		return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

const COPILOT_PLANS: Record<string, string> = {
	free: "Free",
	individual: "Pro",
	pro: "Pro",
	individual_pro: "Pro+",
	pro_plus: "Pro+",
	"pro+": "Pro+",
	business: "Business",
	enterprise: "Enterprise",
	student: "Student",
	max: "Max",
};
const COPILOT_PLAN_NAMES = new Set(Object.values(COPILOT_PLANS));

function copilotPlan(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const key = value.toLowerCase();
	return Object.hasOwn(COPILOT_PLANS, key) ? COPILOT_PLANS[key] : undefined;
}

/** Parse the existing read-only copilot_internal/user response, in either casing. */
function parseCopilotUsage(value: unknown): CopilotUsageDetails | undefined {
	if (!isRecord(value)) return undefined;
	const snapshots = isRecord(value.quota_snapshots ?? value.quotaSnapshots)
		? ((value.quota_snapshots ?? value.quotaSnapshots) as Record<
				string,
				unknown
			>)
		: undefined;
	const rawCandidate =
		snapshots?.premium_interactions ?? snapshots?.premiumInteractions;
	const raw = isRecord(rawCandidate) ? rawCandidate : undefined;
	const details: CopilotUsageDetails = {
		plan: copilotPlan(value.copilot_plan ?? value.copilotPlan),
	};
	if (raw) {
		const billing =
			copilotBoolean(raw.token_based_billing ?? raw.tokenBasedBilling) ??
			copilotBoolean(value.token_based_billing ?? value.tokenBasedBilling);
		const unlimited =
			copilotBoolean(raw.unlimited) ??
			(Number(raw.entitlement) === -1 ? true : undefined);
		const allowance = unlimited
			? undefined
			: copilotNonNegativeNumber(raw.entitlement);
		// quota_remaining has the entitlement's basis and more precision than remaining.
		// credits_used is an aggregate with no denominator (microsoft/vscode#319589).
		const remaining = unlimited
			? undefined
			: copilotNonNegativeNumber(
					raw.quota_remaining ?? raw.quotaRemaining ?? raw.remaining,
				);
		const reportedUsed = copilotPercent(
			raw.percent_used ?? raw.used_percent ?? raw.usedPercentage,
		);
		const reportedRemaining = copilotPercent(
			raw.percent_remaining ?? raw.remaining_percent ?? raw.remainingPercentage,
		);
		const percentUsed = unlimited
			? undefined
			: (reportedUsed ??
				(reportedRemaining !== undefined
					? 100 - reportedRemaining
					: undefined));
		const seconds = copilotNonNegativeNumber(
			raw.quota_reset_at ?? raw.quotaResetAt,
		);
		const resetAt =
			seconds && Number.isFinite(seconds * 1000)
				? seconds * 1000
				: (copilotDate(value.quota_reset_date_utc ?? value.quotaResetDateUtc) ??
					copilotDate(value.quota_reset_date ?? value.quotaResetDate));
		details.premium = {
			unit:
				billing === true
					? "credits"
					: billing === false
						? "requests"
						: "unknown",
			unlimited,
			allowance,
			remaining,
			used:
				allowance !== undefined &&
				remaining !== undefined &&
				remaining <= allowance
					? allowance - remaining
					: undefined,
			percentUsed,
			creditsUsed: copilotNonNegativeNumber(
				raw.credits_used ?? raw.creditsUsed,
			),
			overagePermitted: copilotBoolean(
				raw.overage_permitted ?? raw.overagePermitted,
			),
			overageUsed: copilotNonNegativeNumber(
				raw.overage_count ?? raw.overageCount,
			),
			resetAt,
		};
	}
	if (
		details.premium &&
		details.premium.unit === "unknown" &&
		Object.entries(details.premium).every(
			([key, item]) => key === "unit" || item === undefined,
		)
	) {
		delete details.premium;
	}
	return details.plan || details.premium ? details : undefined;
}

/** Validate the normalized cache independently from the provider's response shape. */
export function parseCachedCopilotUsage(
	value: unknown,
): CopilotUsageDetails | undefined {
	if (!isRecord(value)) return undefined;
	const details: CopilotUsageDetails = {
		plan:
			typeof value.plan === "string" && COPILOT_PLAN_NAMES.has(value.plan)
				? value.plan
				: undefined,
	};
	const raw = nestedRecord(value, "premium");
	if (raw) {
		details.premium = {
			unit:
				raw.unit === "credits" || raw.unit === "requests"
					? raw.unit
					: "unknown",
			unlimited: copilotBoolean(raw.unlimited),
			percentUsed: copilotPercent(raw.percentUsed),
			allowance: copilotNonNegativeNumber(raw.allowance),
			remaining: copilotNonNegativeNumber(raw.remaining),
			used: copilotNonNegativeNumber(raw.used),
			creditsUsed: copilotNonNegativeNumber(raw.creditsUsed),
			overagePermitted: copilotBoolean(raw.overagePermitted),
			overageUsed: copilotNonNegativeNumber(raw.overageUsed),
			resetAt: copilotNonNegativeNumber(raw.resetAt),
		};
	}
	return details.plan || details.premium ? details : undefined;
}

function jwtPayload(token: string): Record<string, unknown> | undefined {
	const [, encoded] = token.split(".");
	if (!encoded) return undefined;
	try {
		const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
		const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
		return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
	} catch {
		return undefined;
	}
}

export function extractOpenAiAccountId(token: string): string | undefined {
	const payload = jwtPayload(token);
	if (!payload) return undefined;
	const authClaim = nestedRecord(payload, "https://api.openai.com/auth");
	const accountId = authClaim?.chatgpt_account_id ?? authClaim?.account_id;
	return typeof accountId === "string" && accountId ? accountId : undefined;
}

async function fetchProviderUsageResponse(
	fetchFn: typeof globalThis.fetch,
	url: string,
	init: RequestInit,
): Promise<Response> {
	return retryUsageRequest(
		() =>
			fetchFn(url, {
				...init,
				signal: AbortSignal.timeout(PROVIDER_USAGE_FETCH_TIMEOUT_MS),
			}),
		{
			maxAttempts: PROVIDER_USAGE_FETCH_MAX_ATTEMPTS,
			transientBaseMs: PROVIDER_USAGE_TRANSIENT_RETRY_BASE_MS,
			throttleBaseMs: PROVIDER_USAGE_THROTTLE_RETRY_BASE_MS,
			maxDelayMs: PROVIDER_USAGE_RETRY_MAX_DELAY_MS,
			statusOf: (response) => response.status,
			serverDelayMs: parseRetryAfterMs,
			onRetryResult: (response) => {
				void response.body?.cancel().catch(() => undefined);
			},
		},
	);
}

async function fetchJson(
	fetchFn: typeof globalThis.fetch,
	url: string,
	init: RequestInit,
): Promise<unknown | undefined> {
	const response = await fetchProviderUsageResponse(fetchFn, url, init);
	if (!response.ok) {
		void response.body?.cancel().catch(() => undefined);
		return undefined;
	}
	return response.json();
}

async function fetchOpenRouterKeyStatus(
	fetchFn: typeof globalThis.fetch,
	token: string,
): Promise<ProviderUsageScope | undefined> {
	const body = await fetchJson(fetchFn, "https://openrouter.ai/api/v1/key", {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!isRecord(body) || !isRecord(body.data)) return undefined;

	const remaining = numericField(body.data.limit_remaining);
	if (remaining !== undefined) return { balanceUsd: remaining };

	const limit = numericField(body.data.limit);
	const usage = numericField(body.data.usage);
	if (limit !== undefined && usage !== undefined) {
		return { balanceUsd: limit - usage };
	}

	return undefined;
}

function parseOpenRouterCreditsBody(
	body: unknown,
): ProviderUsageScope | undefined {
	if (!isRecord(body) || !isRecord(body.data)) return undefined;

	const totalCredits = numericField(body.data.total_credits);
	const totalUsage = numericField(body.data.total_usage);
	if (totalCredits === undefined || totalUsage === undefined) return undefined;

	return {
		balanceUsd: totalCredits - totalUsage,
		creditsUsd: totalCredits,
	};
}

async function fetchOpenRouterCredits(
	fetchFn: typeof globalThis.fetch,
	token: string,
): Promise<ProviderUsageScope | undefined> {
	const body = await fetchJson(
		fetchFn,
		"https://openrouter.ai/api/v1/credits",
		{
			headers: { Authorization: `Bearer ${token}` },
		},
	);
	return parseOpenRouterCreditsBody(body);
}

function parseLlmHubSpend(body: unknown): ProviderUsageScope | undefined {
	if (!isRecord(body)) return undefined;
	const info = nestedRecord(body, "info");
	const spend = info ? numericField(info.spend) : undefined;
	if (spend !== undefined) return { spendUsd: spend };

	const error = nestedRecord(body, "error");
	if (error?.type !== "budget_exceeded" || typeof error.message !== "string") {
		return undefined;
	}
	const match = error.message.match(/Current cost:\s*([0-9]+(?:\.[0-9]+)?)/i);
	const exceededSpend = match?.[1] ? numericField(match[1]) : undefined;
	return exceededSpend !== undefined ? { spendUsd: exceededSpend } : undefined;
}

async function fetchLlmHubSpend(
	fetchFn: typeof globalThis.fetch,
	baseUrl: string,
	token: string,
): Promise<ProviderUsageScope | undefined> {
	const response = await fetchProviderUsageResponse(
		fetchFn,
		`${normalizeBaseUrl(baseUrl)}/key/info`,
		{ headers: { Authorization: `Bearer ${token}` } },
	);
	const body: unknown = await response.json();
	return parseLlmHubSpend(body);
}

async function fetchAnthropicOAuthUsage(
	fetchFn: typeof globalThis.fetch,
	token: string,
): Promise<ProviderUsageScope | undefined> {
	const body = await fetchJson(
		fetchFn,
		"https://api.anthropic.com/api/oauth/usage",
		{
			headers: {
				Authorization: `Bearer ${token}`,
				"anthropic-beta": "oauth-2025-04-20",
				"anthropic-version": "2023-06-01",
				"User-Agent": "pi-statusline",
			},
		},
	);
	if (!isRecord(body)) return undefined;

	const fiveHour = nestedRecord(body, "five_hour");
	const sevenDay = nestedRecord(body, "seven_day");
	const sevenDaySonnet = nestedRecord(body, "seven_day_sonnet");
	const sevenDayOpus = nestedRecord(body, "seven_day_opus");
	const sessionPercentUsed = fiveHour
		? parseUtilization(
				fiveHour.utilization ??
					fiveHour.used_percentage ??
					fiveHour.used_percent,
			)
		: undefined;
	const weeklyCandidates = [sevenDay, sevenDaySonnet, sevenDayOpus]
		.map((record) =>
			record
				? parseUtilization(
						record.utilization ?? record.used_percentage ?? record.used_percent,
					)
				: undefined,
		)
		.filter((value): value is number => value !== undefined);
	const weeklyPercentUsed =
		weeklyCandidates.length > 0 ? Math.max(...weeklyCandidates) : undefined;

	return sessionPercentUsed !== undefined || weeklyPercentUsed !== undefined
		? { sessionPercentUsed, weeklyPercentUsed }
		: undefined;
}

async function fetchOpenAiCodexUsage(
	fetchFn: typeof globalThis.fetch,
	token: string,
): Promise<ProviderUsageScope | undefined> {
	const accountId = extractOpenAiAccountId(token);
	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		Accept: "application/json",
		"User-Agent": "pi-statusline",
	};
	if (accountId) headers["chatgpt-account-id"] = accountId;

	const [usageBody, resetCreditsBody] = await Promise.all([
		fetchJson(fetchFn, "https://chatgpt.com/backend-api/wham/usage", {
			headers,
		}).catch(() => undefined),
		fetchJson(
			fetchFn,
			"https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
			{
				headers: {
					...headers,
					"OpenAI-Beta": "codex-1",
					originator: "Codex Desktop",
				},
			},
		).catch(() => undefined),
	]);
	const usageScope = parseOpenAiUsageBody(usageBody);
	const resetCredits = parseOpenAiResetCreditsBody(resetCreditsBody);
	const resetCreditsScope = resetCredits
		? { availableResets: resetCredits.count }
		: undefined;
	return usageScope || resetCreditsScope
		? { ...usageScope, ...resetCreditsScope }
		: undefined;
}

async function fetchGitHubCopilotUsage(
	fetchFn: typeof globalThis.fetch,
	token: string,
): Promise<CopilotUsageDetails | undefined> {
	const response = await fetchProviderUsageResponse(
		fetchFn,
		"https://api.github.com/copilot_internal/user",
		{
			headers: {
				Authorization: `token ${token}`,
				Accept: "application/json",
				"Editor-Version": "vscode/1.96.2",
				"Editor-Plugin-Version": "copilot-chat/0.26.7",
				"User-Agent": "GitHubCopilotChat/0.26.7",
				"X-GitHub-Api-Version": "2025-04-01",
			},
		},
	);
	if (!response.ok) {
		void response.body?.cancel().catch(() => undefined);
		throw new Error(`HTTP ${response.status}`);
	}
	return parseCopilotUsage(await response.json());
}

function scopeResult(
	scope: ProviderUsageScope | undefined,
): ProviderUsageFetchResult {
	return scope ? { state: "ready", scope } : { state: "unknown" };
}

const PROVIDER_USAGE_FETCHERS = new Map<string, ProviderUsageFetcher>([
	[
		"github-copilot:oauth",
		async (fetchFn, access) => {
			const copilot = access.token
				? await fetchGitHubCopilotUsage(fetchFn, access.token)
				: undefined;
			const percentUsed = copilot?.premium?.percentUsed;
			// Reset/count details are popup-only; keep Pi's compact badge unchanged.
			return {
				state: copilot ? "ready" : "unknown",
				copilot,
				scope:
					percentUsed !== undefined
						? { monthlyPercentUsed: percentUsed }
						: undefined,
			};
		},
	],
	[
		"anthropic:oauth",
		async (fetchFn, access) =>
			access.token
				? scopeResult(await fetchAnthropicOAuthUsage(fetchFn, access.token))
				: { state: "unknown" },
	],
	[
		"openai-codex:oauth",
		async (fetchFn, access) =>
			access.token
				? scopeResult(await fetchOpenAiCodexUsage(fetchFn, access.token))
				: { state: "unknown" },
	],
	[
		`${LLMHUB_USAGE_PROVIDER_ID}:api_key`,
		async (fetchFn, access) =>
			access.baseUrl && access.token
				? scopeResult(
						await fetchLlmHubSpend(fetchFn, access.baseUrl, access.token),
					)
				: { state: "unknown" },
	],
	[
		"openrouter:api_key",
		async (fetchFn, access) => {
			if (!access.token) return { state: "unknown" };
			const scope =
				(await fetchOpenRouterKeyStatus(fetchFn, access.token).catch(
					() => undefined,
				)) ??
				(await fetchOpenRouterCredits(fetchFn, access.token).catch(
					() => undefined,
				));
			return scopeResult(scope);
		},
	],
]);

export async function fetchDirectProviderUsage(
	fetchFn: typeof globalThis.fetch,
	target: { providerId: string; authKind: ProviderUsageAuthKind },
	access: ProviderUsageFetchAccess,
): Promise<ProviderUsageFetchResult> {
	const fetcher = PROVIDER_USAGE_FETCHERS.get(
		`${target.providerId}:${target.authKind}`,
	);
	if (!fetcher) return { state: "unsupported" };
	return fetcher(fetchFn, access);
}
