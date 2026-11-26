import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	isUsageCacheFresh,
	runLeasedRefresh,
	usageSnapshotFreshness,
	writeAtomicJsonFile,
} from "./usage-cache";
import {
	formatProviderScope,
	hasQuota,
	type ProviderUsageScope,
	parseOpenAiUsageBody,
} from "./usage-quota";
import { RETRYABLE_USAGE_STATUS_CODES, retryUsageRequest } from "./usage-retry";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PROXY_REFRESH_BUDGET_MS = 45_000;
const CLIPROXY_REQUEST_TIMEOUT_SECONDS = 10;
const CLIPROXY_FETCH_MAX_ATTEMPTS = 3;
const CLIPROXY_TRANSIENT_RETRY_BASE_MS = 50;
const CLIPROXY_THROTTLE_RETRY_BASE_MS = 500;
const CLIPROXY_RETRY_MAX_DELAY_MS = 5_000;
// Transient curl network, timeout, proxy, TLS handshake, and HTTP/2 stream errors.
const RETRYABLE_CURL_EXIT_CODES = new Set([
	5, 6, 7, 16, 18, 28, 35, 52, 55, 56, 92, 97,
]);
const RETRYABLE_SPAWN_ERROR_CODES = new Set([
	"EAGAIN",
	"EMFILE",
	"ENFILE",
	"ENOMEM",
]);

type ResetCredit = {
	expiresAt?: number;
	grantedAt?: number;
};

// Codex usage credits are not a USD balance or manual-reset credits.
type CreditBalance = number | "unlimited";

type Account = {
	provider: string;
	identity: string;
	scope: ProviderUsageScope;
	observedAt: number;
	plan?: string;
	disabled?: boolean;
	quotaLookupFailed?: boolean;
	resetLookupFailed?: boolean;
	health?: "active" | "unavailable" | "cooling-down" | "error" | "disabled";
	resetCredits?: ResetCredit[];
	resetCreditsObservedAt?: number;
	creditBalance?: CreditBalance;
};

/** Safe presentation data shared by Pi and external renderers; never credentials. */
export type ProxyUsageAccount = {
	key: string;
	summary: string;
	scope: ProviderUsageScope;
	plan?: string;
	health?: Account["health"];
	disabled: boolean;
	quotaLookupFailed: boolean;
	resetLookupFailed: boolean;
	resetCredits?: ResetCredit[];
	resetCreditsObservedAt?: number;
	creditBalance?: CreditBalance;
	fetchedAt: number;
	observedAt: number;
	stale: boolean;
};
// Request-only metadata: never written to the shared usage cache.
type AccountEntry = {
	account: Account;
	authIndex: string;
	accountId?: string;
};
type Snapshot = {
	source: string;
	fetchedAt: number;
	accounts: Account[];
	/** Hashed native registration -> hashed proxy identity. Empty means no safe match. */
	openaiRegistrations?: Record<string, string>;
	/** Hashed ChatGPT account ID -> hashed proxy identity; ambiguous accounts are omitted. */
	codexAccounts?: Record<string, string>;
};
/** Read-only view of the validated CLIProxyAPI snapshot and hashed target links. */
export type ProxySnapshotView = {
	accounts: ProxyUsageAccount[];
	freshness: "fresh" | "stale";
	openaiRegistrations?: Readonly<Record<string, string>>;
	codexAccounts?: Readonly<Record<string, string>>;
};
type AccountLookup = "native" | "codex";
type ProxyConfig = {
	source: string;
	url: string;
	key: string;
};

type ProxyState = {
	snapshot?: Snapshot;
	pending?: Promise<ProxyUpdateOutcome>;
	pendingSource?: string;
	pendingLookup?: AccountLookup;
	lastAttemptAt: number;
	lastAttemptSource?: string;
	lastAttemptFailed: boolean;
	lastAttemptLookup?: AccountLookup;
};

function createProxyState(): ProxyState {
	return {
		lastAttemptAt: 0,
		lastAttemptFailed: false,
	};
}

let state: ProxyState = createProxyState();

function cachePath(): string {
	return (
		process.env.PI_CLIPROXY_USAGE_CACHE_PATH ??
		join(
			process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
			"pi",
			"cliproxy-usage.json",
		)
	);
}

function proxyConfig(): ProxyConfig | undefined {
	const url = process.env.CLIPROXYAPI_BASE_URL;
	const key = process.env.CLIPROXYAPI_MANAGEMENT_KEY;
	if (!url || !key || /[\r\n"\\]/.test(key)) return undefined;
	try {
		const parsed = new URL(url);
		if (
			parsed.protocol !== "https:" &&
			!(
				parsed.protocol === "http:" &&
				["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
			)
		)
			return undefined;
		if (parsed.username || parsed.password || parsed.search || parsed.hash)
			return undefined;
		const basePath = parsed.pathname
			.replace(/\/+$/, "")
			.replace(/\/(?:v1|backend-api)$/, "");
		return {
			url,
			key,
			source: createHash("sha256")
				.update(`${parsed.origin}${basePath}\0${key}`)
				.digest("hex"),
		};
	} catch {
		return undefined;
	}
}

function sourceKey(): string | undefined {
	return proxyConfig()?.source;
}

function readSnapshot(source: string): Snapshot | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(cachePath(), "utf8"));
		if (
			typeof value !== "object" ||
			!value ||
			!("source" in value) ||
			value.source !== source ||
			!("accounts" in value) ||
			!Array.isArray(value.accounts) ||
			!("fetchedAt" in value) ||
			typeof value.fetchedAt !== "number" ||
			!Number.isFinite(value.fetchedAt)
		)
			return undefined;
		return value as Snapshot;
	} catch {
		return undefined;
	}
}

function currentSnapshot(source: string): Snapshot | undefined {
	const disk = readSnapshot(source);
	if (
		disk &&
		(!state.snapshot ||
			state.snapshot.source !== source ||
			disk.fetchedAt > state.snapshot.fetchedAt)
	)
		state.snapshot = disk;
	return state.snapshot?.source === source ? state.snapshot : undefined;
}

function isProxySnapshotFresh(
	data: Snapshot | undefined,
	lookup?: AccountLookup,
): boolean {
	return (
		(lookup !== "native" || data?.openaiRegistrations !== undefined) &&
		(lookup !== "codex" || data?.codexAccounts !== undefined) &&
		isUsageCacheFresh({
			lastAttemptAt: data?.fetchedAt,
			state: data?.accounts.length === 0 ? "unknown" : "ready",
		})
	);
}

function openAiRegistrationKey(clientId: string): string {
	return createHash("sha256").update(clientId).digest("hex");
}

function codexAccountKey(accountId: string): string {
	return createHash("sha256")
		.update(`codex-account\0${accountId}`)
		.digest("hex");
}

/** One-way identity hash matching the snapshot's openaiRegistrations / codexAccounts maps. */
export function hashProxyTargetIdentity(
	kind: "native" | "codex",
	id: string,
): string {
	return kind === "native" ? openAiRegistrationKey(id) : codexAccountKey(id);
}

function uniqueAccountMatches(
	pairs: [string, string][],
): Record<string, string> {
	const matches = new Map<string, string | undefined>();
	for (const [key, account] of pairs) {
		matches.set(key, matches.has(key) ? undefined : account);
	}
	return Object.fromEntries(
		[...matches].filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	);
}

/** Only complete app lists establish uniqueness; never retain profile data or raw IDs. */
function registrationKeys(body: unknown): string[] | undefined {
	if (!body || typeof body !== "object" || Array.isArray(body))
		return undefined;
	const record = body as Record<string, unknown>;
	if (
		!Array.isArray(record.items) ||
		record.items.length > 128 ||
		Object.keys(record).some(
			(key) => !["items", "has_more", "next_cursor"].includes(key),
		) ||
		(record.has_more !== undefined && record.has_more !== false) ||
		(record.next_cursor !== undefined &&
			record.next_cursor !== null &&
			record.next_cursor !== "")
	)
		return undefined;
	const keys = new Set<string>();
	for (const item of record.items) {
		if (!item || typeof item !== "object" || Array.isArray(item))
			return undefined;
		const id = (item as Record<string, unknown>).id;
		if (typeof id !== "string" || !id.trim() || id.length > 512)
			return undefined;
		const key = openAiRegistrationKey(id);
		if (keys.has(key)) return undefined;
		keys.add(key);
	}
	return [...keys];
}

function numeric(value: unknown): number | undefined {
	const number =
		typeof value === "number" || (typeof value === "string" && value.trim())
			? Number(value)
			: NaN;
	return Number.isFinite(number) ? number : undefined;
}

function planName(value: unknown): string | undefined {
	return typeof value === "string" && /^[a-z][a-z0-9_-]{0,31}$/i.test(value)
		? value
		: undefined;
}

function timestamp(value: unknown): number | undefined {
	const parsed = typeof value === "string" ? Date.parse(value) : NaN;
	return Number.isFinite(parsed) ? parsed : undefined;
}

function codexScope(
	value: unknown,
	now: number,
): { scope: ProviderUsageScope; observedAt: number } | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	const signals = record.signals;
	if (!signals || typeof signals !== "object") return undefined;
	const headers = signals as Record<string, unknown>;
	const observedAt =
		typeof record.observed_at === "string"
			? Date.parse(record.observed_at)
			: NaN;
	if (!Number.isFinite(observedAt) || observedAt > now + 60_000)
		return undefined;
	const rateLimit: Record<string, unknown> = {};
	for (const [name, slot] of [
		["Primary", "primary_window"],
		["Secondary", "secondary_window"],
	] as const) {
		const used = numeric(headers[`X-Codex-${name}-Used-Percent`]);
		if (used === undefined) continue;
		const resetAt = numeric(headers[`X-Codex-${name}-Reset-At`]);
		const after = numeric(headers[`X-Codex-${name}-Reset-After-Seconds`]);
		const resetTimestamp =
			resetAt !== undefined && resetAt > 0
				? resetAt * (resetAt < 1e12 ? 1000 : 1)
				: after !== undefined && after >= 0
					? observedAt + after * 1000
					: undefined;
		if (resetTimestamp !== undefined && resetTimestamp <= now) continue;
		if (
			resetTimestamp === undefined &&
			usageSnapshotFreshness({ fetchedAt: observedAt, state: "ready" }, now) ===
				"expired"
		)
			continue;
		const minutes = numeric(headers[`X-Codex-${name}-Window-Minutes`]);
		rateLimit[slot] = {
			used_percent: used,
			limit_window_seconds: minutes === undefined ? undefined : minutes * 60,
			reset_at: resetTimestamp,
		};
	}
	// Header units differ from /usage, but period classification must not.
	const scope = parseOpenAiUsageBody({ rate_limit: rateLimit });
	return scope && hasQuota(scope) ? { scope, observedAt } : undefined;
}

function parseAccountEntries(body: unknown, now = Date.now()): AccountEntry[] {
	if (
		!body ||
		typeof body !== "object" ||
		!Array.isArray((body as { files?: unknown }).files)
	)
		throw new Error("Invalid credentials response");
	const accounts: AccountEntry[] = [];
	for (const value of (body as { files: unknown[] }).files) {
		if (!value || typeof value !== "object") continue;
		const file = value as Record<string, unknown>;
		if (file.provider !== "codex") continue;
		const identity = file.auth_index;
		if (typeof identity !== "string" || !identity) continue;
		let usage = codexScope(file.quota, now);
		if (!usage && file.model_quotas && typeof file.model_quotas === "object") {
			for (const candidate of Object.values(file.model_quotas)) {
				const parsed = codexScope(candidate, now);
				if (parsed && (!usage || parsed.observedAt > usage.observedAt))
					usage = parsed;
			}
		}
		const accountId =
			file.id_token && typeof file.id_token === "object"
				? (file.id_token as Record<string, unknown>).chatgpt_account_id
				: undefined;
		accounts.push({
			account: {
				provider: "codex",
				identity: createHash("sha256").update(identity).digest("hex"),
				...(usage ?? { scope: {}, observedAt: now }),
				plan: planName(
					file.id_token && typeof file.id_token === "object"
						? (file.id_token as Record<string, unknown>).plan_type
						: undefined,
				),
				disabled: file.disabled === true,
				health:
					file.disabled === true
						? "disabled"
						: Array.isArray(file.cooldowns) && file.cooldowns.length > 0
							? "cooling-down"
							: file.unavailable === true
								? "unavailable"
								: file.status === "error"
									? "error"
									: file.status === "active" || file.status === "ready"
										? "active"
										: undefined,
			},
			authIndex: identity,
			accountId:
				typeof accountId === "string" && accountId ? accountId : undefined,
		});
	}
	return accounts.sort(
		(a, b) =>
			a.account.provider.localeCompare(b.account.provider) ||
			a.account.identity.localeCompare(b.account.identity),
	);
}

class ProxyTransportError extends Error {}

function requestManagementOnce(
	url: string,
	key: string,
	path: string,
	data?: Record<string, unknown>,
	timeoutSeconds = CLIPROXY_REQUEST_TIMEOUT_SECONDS,
): Promise<{ status: number; body: unknown }> {
	return new Promise((resolve, reject) => {
		const endpoint = new URL(
			path,
			`${url.replace(/\/+$/, "").replace(/\/(?:v1|backend-api)$/, "")}/`,
		).toString();
		// curl honors the work profile's HTTPS_PROXY, HTTP_PROXY and NO_PROXY. The key
		// travels on stdin, not argv, and neither stderr nor the raw body is logged.
		const child = spawn(
			"curl",
			[
				"-q",
				"--config",
				"-",
				"--silent",
				"--max-time",
				String(timeoutSeconds),
				"--write-out",
				"\n%{http_code}",
				endpoint,
			],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
		let output = "";
		let bytes = 0;
		child.stdout.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > MAX_RESPONSE_BYTES) {
				child.kill();
				return;
			}
			output += chunk.toString("utf8");
		});
		child.stderr.resume();
		child.stdin.on("error", () => {
			/* curl can exit before consuming its config */
		});
		child.on("error", (error: NodeJS.ErrnoException) =>
			reject(
				error.code && RETRYABLE_SPAWN_ERROR_CODES.has(error.code)
					? new ProxyTransportError("CLIProxyAPI transport unavailable")
					: new Error("CLIProxyAPI transport unavailable"),
			),
		);
		child.on("close", (code) => {
			if (bytes > MAX_RESPONSE_BYTES) {
				reject(new Error("CLIProxyAPI response exceeded size limit"));
				return;
			}
			if (code !== 0) {
				reject(
					code !== null && RETRYABLE_CURL_EXIT_CODES.has(code)
						? new ProxyTransportError("CLIProxyAPI request failed")
						: new Error("CLIProxyAPI request failed"),
				);
				return;
			}
			const boundary = output.lastIndexOf("\n");
			const status = Number(output.slice(boundary + 1));
			if (
				boundary < 0 ||
				!Number.isInteger(status) ||
				status < 100 ||
				status > 599
			) {
				reject(new Error("CLIProxyAPI returned an invalid HTTP status"));
				return;
			}
			try {
				resolve({
					status,
					body:
						status === 200 ? JSON.parse(output.slice(0, boundary)) : undefined,
				});
			} catch {
				reject(new Error("CLIProxyAPI returned invalid JSON"));
			}
		});
		let config = `header = "Authorization: Bearer ${key}"\n`;
		if (data !== undefined) {
			config += `request = "POST"\nheader = "Content-Type: application/json"\ndata = ${JSON.stringify(JSON.stringify(data))}\n`;
		}
		child.stdin.end(config);
	});
}

async function requestManagement(
	url: string,
	key: string,
	path: string,
	data?: Record<string, unknown>,
	options?: {
		deadlineMs?: number;
		retryStatus?: (response: {
			status: number;
			body: unknown;
		}) => number | undefined;
	},
): Promise<{ status: number; body: unknown }> {
	const deadlineMs = options?.deadlineMs;
	return retryUsageRequest(
		() => {
			let timeoutSeconds = CLIPROXY_REQUEST_TIMEOUT_SECONDS;
			if (deadlineMs !== undefined) {
				const remainingMs = deadlineMs - performance.now();
				if (remainingMs <= 0) {
					throw new ProxyTransportError("CLIProxyAPI refresh budget exceeded");
				}
				timeoutSeconds = Math.max(
					1,
					Math.min(
						CLIPROXY_REQUEST_TIMEOUT_SECONDS,
						Math.ceil(remainingMs / 1000),
					),
				);
			}
			return requestManagementOnce(url, key, path, data, timeoutSeconds);
		},
		{
			maxAttempts: CLIPROXY_FETCH_MAX_ATTEMPTS,
			transientBaseMs: CLIPROXY_TRANSIENT_RETRY_BASE_MS,
			throttleBaseMs: CLIPROXY_THROTTLE_RETRY_BASE_MS,
			maxDelayMs: CLIPROXY_RETRY_MAX_DELAY_MS,
			deadlineMs,
			statusOf: (response) =>
				RETRYABLE_USAGE_STATUS_CODES.has(response.status)
					? response.status
					: options?.retryStatus?.(response),
			shouldRetryError: (error) => error instanceof ProxyTransportError,
		},
	);
}

async function fetchCodexBody(
	url: string,
	key: string,
	entry: AccountEntry,
	endpoint: "usage" | "rate-limit-reset-credits" | "usage/chatpass/apps",
	deadlineMs: number,
): Promise<unknown> {
	try {
		const header: Record<string, string> = {
			Authorization: "Bearer $TOKEN$",
			Accept: "application/json",
			"OpenAI-Beta": "codex-1",
			originator: "Codex Desktop",
		};
		if (entry.accountId) header["chatgpt-account-id"] = entry.accountId;
		// Share one attempt budget across management and upstream transient failures.
		const response = await requestManagement(
			url,
			key,
			"v8/management/requests/api-call",
			{
				auth_index: entry.authIndex,
				method: "GET",
				url: `https://chatgpt.com/backend-api/wham/${endpoint}`,
				header,
			},
			{
				deadlineMs,
				retryStatus: (res) => {
					if (res.status !== 200 || !res.body || typeof res.body !== "object")
						return undefined;
					const statusCode = (res.body as Record<string, unknown>).status_code;
					return typeof statusCode === "number" ? statusCode : undefined;
				},
			},
		);
		if (
			response.status !== 200 ||
			!response.body ||
			typeof response.body !== "object"
		)
			return undefined;
		const upstream = response.body as Record<string, unknown>;
		if (upstream.status_code !== 200 || typeof upstream.body !== "string")
			return undefined;
		return JSON.parse(upstream.body) as unknown;
	} catch {
		return undefined;
	}
}

async function fetchResetCredits(
	url: string,
	key: string,
	entry: AccountEntry,
	deadlineMs: number,
): Promise<{ count: number; credits: ResetCredit[] } | undefined> {
	try {
		const body = await fetchCodexBody(
			url,
			key,
			entry,
			"rate-limit-reset-credits",
			deadlineMs,
		);
		if (!body || typeof body !== "object") return undefined;
		const credits = body as Record<string, unknown>;
		const count = numeric(credits.available_count ?? credits.availableCount);
		if (count === undefined) return undefined;
		const available = Array.isArray(credits.credits)
			? credits.credits.flatMap((value: unknown) => {
					if (!value || typeof value !== "object") return [];
					const credit = value as Record<string, unknown>;
					if (
						credit.status !== "available" ||
						credit.is_supported_by_plan === false
					)
						return [];
					const expiresAt = timestamp(credit.expires_at);
					if (expiresAt !== undefined && expiresAt <= Date.now()) return [];
					return [{ expiresAt, grantedAt: timestamp(credit.granted_at) }];
				})
			: [];
		available.sort(
			(a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity),
		);
		return { count: Math.max(0, Math.floor(count)), credits: available };
	} catch {
		// Reset credits are optional; an unsupported endpoint or failed account
		// lookup must not hide its observed quota or other accounts' credits.
		return undefined;
	}
}

function creditBalance(value: unknown): CreditBalance | undefined {
	if (value === "unlimited") return value;
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: undefined;
}

function parseCreditBalance(body: unknown): CreditBalance | undefined {
	if (!body || typeof body !== "object") return undefined;
	const credits = (body as { credits?: unknown }).credits;
	if (!credits || typeof credits !== "object") return undefined;
	const record = credits as Record<string, unknown>;
	if (record.unlimited === true) return "unlimited";
	if (record.balance != null) return creditBalance(numeric(record.balance));
	return record.has_credits === false ? 0 : undefined;
}

async function fetchProxyAccounts(
	url: string,
	key: string,
	cached: Snapshot | undefined,
	includeRegistrations: boolean,
): Promise<
	Pick<Snapshot, "accounts" | "openaiRegistrations" | "codexAccounts">
> {
	const deadlineMs = performance.now() + PROXY_REFRESH_BUDGET_MS;
	const response = await requestManagement(
		url,
		key,
		"v8/management/credentials",
		undefined,
		{ deadlineMs },
	);
	if (response.status !== 200)
		throw new Error("CLIProxyAPI returned a non-OK response");
	const entries = parseAccountEntries(response.body);
	const files = (response.body as { files: unknown[] }).files;
	let registrationsComplete =
		entries.length ===
		files.filter(
			(file) =>
				file &&
				typeof file === "object" &&
				(file as { provider?: unknown }).provider === "codex",
		).length;
	const codexAccounts =
		registrationsComplete && entries.every((entry) => !!entry.accountId)
			? uniqueAccountMatches(
					entries.map((entry) => [
						codexAccountKey(entry.accountId as string),
						entry.account.identity,
					]),
				)
			: {};
	const registrationAccounts: [string, string][] = [];
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(4, entries.length) }, async () => {
			while (next < entries.length) {
				const entry = entries[next++];
				if (includeRegistrations) {
					const keys = registrationKeys(
						await fetchCodexBody(
							url,
							key,
							entry,
							"usage/chatpass/apps",
							deadlineMs,
						),
					);
					if (!keys) registrationsComplete = false;
					for (const registration of keys ?? []) {
						registrationAccounts.push([registration, entry.account.identity]);
					}
				}
				const previous = cached?.accounts.find(
					(account) => account?.identity === entry.account.identity,
				);
				const previousResetAt =
					previous?.resetCreditsObservedAt ?? cached?.fetchedAt;
				const retained = previous
					? usableScope(
							{
								...previous,
								quotaLookupFailed: true,
								resetCreditsObservedAt: previousResetAt,
							},
							Date.now(),
						)
					: undefined;
				// /usage is authoritative for every account, even if it has never
				// served inference and therefore has no management quota headers.
				const usageBody = await fetchCodexBody(
					url,
					key,
					entry,
					"usage",
					deadlineMs,
				);
				entry.account.creditBalance = parseCreditBalance(usageBody);
				const quota = parseOpenAiUsageBody(usageBody);
				const headerQuota = hasQuota(usableScope(entry.account, Date.now()));
				entry.account.quotaLookupFailed =
					!hasQuota(quota) && (entry.account.disabled || !headerQuota);
				if (quota && hasQuota(quota)) {
					// Codex credits are not USD; only copy quota fields into the badge.
					delete quota.balanceUsd;
					entry.account.scope = quota;
					entry.account.observedAt = Date.now();
				} else if (
					previous &&
					hasQuota(retained) &&
					(!headerQuota || previous.observedAt > entry.account.observedAt)
				) {
					entry.account.scope = { ...retained };
					delete entry.account.scope.availableResets;
					entry.account.observedAt = previous.observedAt;
					entry.account.quotaLookupFailed = true;
				}
				entry.account.plan ??= previous?.plan;
				const resets = await fetchResetCredits(url, key, entry, deadlineMs);
				if (resets) {
					entry.account.scope.availableResets = resets.count;
					entry.account.resetCredits = resets.credits;
					entry.account.resetCreditsObservedAt = Date.now();
					entry.account.resetLookupFailed = false;
				} else if (entry.account.disabled) {
					entry.account.resetLookupFailed = true;
					// Only failed reads use last-known values. Preserve their original
					// age; successful metadata refreshes must not extend their lifetime.
					if (retained?.availableResets !== undefined && previous) {
						entry.account.scope.availableResets = retained.availableResets;
						entry.account.resetCredits = previous.resetCredits;
						entry.account.resetCreditsObservedAt = previousResetAt;
					}
				}
			}
		}),
	);
	return {
		accounts: entries
			.map(({ account }) => account)
			.filter((account) => usableScope(account, Date.now()) !== undefined),
		codexAccounts,
		...(includeRegistrations
			? {
					openaiRegistrations: uniqueAccountMatches(
						registrationsComplete ? registrationAccounts : [],
					),
				}
			: {}),
	};
}

type ProxyUpdateOutcome = "updated" | "fresh" | "contended" | "failed";

function lookupCovers(
	covered: AccountLookup | undefined,
	requested: AccountLookup | undefined,
): boolean {
	return !requested || covered === requested || covered === "native";
}

async function update(
	config: ProxyConfig,
	lookup?: AccountLookup,
): Promise<ProxyUpdateOutcome> {
	const { source, url, key } = config;
	const path = cachePath();
	const outcome = await runLeasedRefresh(`${path}.refresh`, async (lease) => {
		const cached = currentSnapshot(source);
		if (isProxySnapshotFresh(cached, lookup)) return "fresh" as const;
		const accounts = await fetchProxyAccounts(
			url,
			key,
			cached,
			lookup === "native",
		);
		lease.assertOwned();
		const updated: Snapshot = {
			source,
			fetchedAt: Date.now(),
			...accounts,
		};
		writeAtomicJsonFile(path, updated, lease);
		state.snapshot = updated;
		return "updated" as const;
	});
	if (outcome.status === "ok") return outcome.value;
	if (outcome.status === "contended" || outcome.status === "compromised") {
		// Another process owns or took over the refresh lease; re-check disk without flagging an error.
		return isProxySnapshotFresh(currentSnapshot(source), lookup)
			? "fresh"
			: "contended";
	}
	// A failing read never erases a recent, usable snapshot.
	return "failed";
}

function recordProxyRefreshOutcome(
	source: string,
	lookup: AccountLookup | undefined,
	outcome: ProxyUpdateOutcome,
	before: Snapshot | undefined,
	beforeFetchedAt: number,
	onUpdate: () => void,
): ProxyUpdateOutcome {
	if (outcome === "updated") {
		state.lastAttemptSource = source;
		state.lastAttemptLookup = lookup;
		state.lastAttemptFailed = false;
		state.lastAttemptAt = state.snapshot?.fetchedAt ?? Date.now();
		onUpdate();
	} else if (outcome === "fresh") {
		state.lastAttemptSource = source;
		state.lastAttemptLookup = lookup;
		state.lastAttemptFailed = false;
		const after = currentSnapshot(source);
		state.lastAttemptAt = after?.fetchedAt ?? 0;
		if ((after?.fetchedAt ?? 0) > beforeFetchedAt) onUpdate();
	} else if (outcome === "contended") {
		const after = currentSnapshot(source);
		const hasActiveFailure =
			state.lastAttemptSource === source &&
			state.lastAttemptFailed &&
			(after?.fetchedAt ?? 0) < state.lastAttemptAt;
		if (!hasActiveFailure) {
			state.lastAttemptSource = source;
			state.lastAttemptLookup = lookup;
			state.lastAttemptFailed = false;
			state.lastAttemptAt = 0;
		}
		if ((after?.fetchedAt ?? 0) > beforeFetchedAt) onUpdate();
	} else {
		state.lastAttemptSource = source;
		state.lastAttemptLookup = lookup;
		state.lastAttemptFailed = true;
		state.lastAttemptAt = Date.now();
		if (before) onUpdate();
	}
	return outcome;
}

export function refreshProxySnapshot(
	onUpdate: () => void,
	lookup?: AccountLookup,
): Promise<void> {
	const config = proxyConfig();
	if (!config) return Promise.resolve();
	const { source } = config;
	const before = currentSnapshot(source);
	if (isProxySnapshotFresh(before, lookup)) return Promise.resolve();
	const beforeFetchedAt = before?.fetchedAt ?? 0;
	if (state.pending) {
		const joinedSource = state.pendingSource;
		const joinedLookup = state.pendingLookup;
		return state.pending.then((outcome) => {
			const after = currentSnapshot(source);
			if (
				(after?.fetchedAt ?? 0) > beforeFetchedAt ||
				(joinedSource === source &&
					outcome === "failed" &&
					before !== undefined)
			)
				onUpdate();
			if (
				isProxySnapshotFresh(after, lookup) ||
				(joinedSource === source &&
					(lookupCovers(joinedLookup, lookup) ||
						outcome === "contended" ||
						outcome === "failed"))
			) {
				return;
			}
			return refreshProxySnapshot(onUpdate, lookup);
		});
	}
	if (
		state.lastAttemptSource === source &&
		(state.lastAttemptFailed ||
			lookupCovers(state.lastAttemptLookup, lookup)) &&
		isUsageCacheFresh({
			lastAttemptAt: state.lastAttemptAt,
			state: state.lastAttemptFailed
				? "error"
				: !before || before.accounts.length === 0
					? "unknown"
					: "ready",
		})
	)
		return Promise.resolve();
	const run = update(config, lookup)
		.then((outcome) =>
			recordProxyRefreshOutcome(
				source,
				lookup,
				outcome,
				before,
				beforeFetchedAt,
				onUpdate,
			),
		)
		.finally(() => {
			if (state.pending === run) {
				state.pending = undefined;
				state.pendingSource = undefined;
				state.pendingLookup = undefined;
			}
		});
	state.pending = run;
	state.pendingSource = source;
	state.pendingLookup = lookup;
	return run.then(() => {});
}

function usableScope(
	account: Account,
	now: number,
): ProviderUsageScope | undefined {
	if (!account.scope || typeof account.scope !== "object") return undefined;
	const scope: ProviderUsageScope = {};
	for (const [percentKey, resetKey] of [
		["sessionPercentUsed", "sessionResetAt"],
		["weeklyPercentUsed", "weeklyResetAt"],
		["monthlyPercentUsed", "monthlyResetAt"],
		["percentUsed", "resetAt"],
	] as const) {
		const used = account.scope[percentKey];
		const resetAt = account.scope[resetKey];
		if (typeof used !== "number" || !Number.isFinite(used)) continue;
		if (
			(account.disabled || account.quotaLookupFailed) &&
			usageSnapshotFreshness(
				{ fetchedAt: account.observedAt, state: "ready" },
				now,
			) === "expired"
		)
			continue;
		if (
			typeof resetAt === "number"
				? resetAt <= now
				: usageSnapshotFreshness(
						{ fetchedAt: account.observedAt, state: "ready" },
						now,
					) === "expired"
		)
			continue;
		scope[percentKey] = used;
		if (typeof resetAt === "number" && Number.isFinite(resetAt))
			scope[resetKey] = resetAt;
	}
	if (scope.percentUsed !== undefined)
		scope.windowSeconds = numeric(account.scope.windowSeconds);
	const resets = account.scope.availableResets;
	if (
		typeof resets === "number" &&
		Number.isFinite(resets) &&
		resets >= 0 &&
		(account.resetCreditsObservedAt === undefined ||
			usageSnapshotFreshness(
				{ fetchedAt: account.resetCreditsObservedAt, state: "ready" },
				now,
			) !== "expired")
	)
		scope.availableResets = Math.floor(resets);
	return account.disabled === true ||
		hasQuota(scope) ||
		(scope.availableResets ?? 0) > 0
		? scope
		: undefined;
}

/** The proxy can choose any enabled Codex account. Keep even expired recorded windows. */
export function cachedProxyPercentUsed(): number | undefined {
	const source = sourceKey();
	if (!source) return undefined;
	let max: number | undefined;
	for (const account of readSnapshot(source)?.accounts ?? []) {
		if (account?.provider !== "codex" || account.disabled === true) continue;
		for (const used of [
			account.scope?.sessionPercentUsed,
			account.scope?.weeklyPercentUsed,
			account.scope?.monthlyPercentUsed,
			account.scope?.percentUsed,
		]) {
			if (typeof used === "number" && Number.isFinite(used) && used >= 0)
				max = max === undefined ? used : Math.max(max, used);
		}
	}
	return max;
}

function proxySnapshotFreshness(
	source: string,
	data: Snapshot | undefined,
): "fresh" | "stale" | "expired" {
	return usageSnapshotFreshness(
		data && {
			fetchedAt: data.fetchedAt,
			lastAttemptAt: state.lastAttemptAt,
			state:
				state.lastAttemptSource === source &&
				state.lastAttemptFailed &&
				state.lastAttemptAt > data.fetchedAt
					? "error"
					: "ready",
		},
	);
}

function proxyUsageAccountsFromSnapshot(
	source: string,
	data: Snapshot | undefined,
): ProxyUsageAccount[] {
	const freshness = proxySnapshotFreshness(source, data);
	if (freshness === "expired" || !data || !Array.isArray(data.accounts))
		return [];
	return data.accounts.flatMap((account) => {
		if (
			account?.provider !== "codex" ||
			typeof account.identity !== "string" ||
			!/^[a-f0-9]{64}$/.test(account.identity) ||
			typeof account.observedAt !== "number" ||
			!Number.isFinite(account.observedAt)
		)
			return [];
		const disabled = account.disabled === true;
		const scope =
			usableScope(account, Date.now()) ?? (disabled ? {} : undefined);
		const scopeText = formatProviderScope(scope);
		if (!scope || (!scopeText && !disabled)) return [];
		const summary = scopeText ?? "?";
		return [
			{
				key: account.identity,
				summary,
				scope,
				plan: planName(account.plan),
				creditBalance: creditBalance(account.creditBalance),
				disabled,
				quotaLookupFailed: account.quotaLookupFailed === true,
				resetLookupFailed: account.resetLookupFailed === true,
				health: disabled
					? "disabled"
					: ["active", "unavailable", "cooling-down", "error"].includes(
								account.health ?? "",
							)
						? account.health
						: undefined,
				resetCreditsObservedAt:
					scope.availableResets !== undefined
						? (account.resetCreditsObservedAt ?? data.fetchedAt)
						: undefined,
				resetCredits:
					scope.availableResets !== undefined &&
					Array.isArray(account.resetCredits)
						? account.resetCredits.flatMap((credit) => {
								if (!credit || typeof credit !== "object") return [];
								return [
									{
										expiresAt:
											typeof credit.expiresAt === "number" &&
											Number.isFinite(credit.expiresAt)
												? credit.expiresAt
												: undefined,
										grantedAt:
											typeof credit.grantedAt === "number" &&
											Number.isFinite(credit.grantedAt)
												? credit.grantedAt
												: undefined,
									},
								];
							})
						: undefined,
				fetchedAt: data.fetchedAt,
				observedAt: account.observedAt,
				stale:
					freshness === "stale" ||
					account.quotaLookupFailed === true ||
					account.resetLookupFailed === true,
			},
		];
	});
}

/** Read the current validated CLIProxyAPI snapshot and hashed target links. */
export function readProxySnapshot(): ProxySnapshotView | undefined {
	const source = sourceKey();
	if (!source) return undefined;
	const data = currentSnapshot(source);
	const freshness = proxySnapshotFreshness(source, data);
	if (freshness === "expired" || !data) return undefined;
	return {
		accounts: proxyUsageAccountsFromSnapshot(source, data),
		freshness,
		openaiRegistrations: data.openaiRegistrations,
		codexAccounts: data.codexAccounts,
	};
}

export function resetProxySnapshot(): void {
	state = createProxyState();
}
