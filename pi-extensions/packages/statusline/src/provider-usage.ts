import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	createProxyUsageStore,
	type DirectProxyFallback,
	type ProxyRequestFn,
	type ProxySnapshotView,
	type ProxyUsageAccount,
	type ProxyUsageStore,
} from "./cliproxy-usage";
import {
	isUsageCacheFresh,
	runLeasedRefresh,
	updateLeasedJsonFile,
	usageSnapshotFreshness,
} from "./usage-cache";
import {
	formatProviderScope,
	isRecord,
	nestedRecord,
	numericField,
	PROVIDER_BADGE_SEPARATOR,
	type ProviderUsageScope,
	parseOpenAiUsageBody,
	parseUtilization,
} from "./usage-quota";
import { retryUsageRequest } from "./usage-retry";

/** Sanitized account data only: never retain identity, organizations, SKU or tokens. */
export type CopilotQuota = {
	unit: "credits" | "requests" | "unknown";
	unlimited?: boolean;
	percentUsed?: number;
	allowance?: number;
	remaining?: number;
	used?: number;
	creditsUsed?: number;
	overagePermitted?: boolean;
	overageUsed?: number;
	resetAt?: number;
};

export type CopilotUsageDetails = {
	plan?: string;
	premium?: CopilotQuota;
};

export type ProviderUsageStoreOptions = {
	fetch?: typeof globalThis.fetch;
	requestProxy?: ProxyRequestFn;
	env?: NodeJS.ProcessEnv;
};

export type ModelLike = {
	name?: string;
	id?: string;
	contextWindow?: number;
	provider?: string;
	api?: string;
	baseUrl?: string;
};

export type AuthCredentialLike =
	| {
			type: "oauth";
			access?: string;
			refresh?: string;
			clientId?: string;
			scopes?: string[];
	  }
	| { type: "api_key" };

export type MaybePromise<T> = T | Promise<T>;

export type ProviderLike = {
	name?: string;
	baseUrl?: string;
};

export type ProviderAuthLike = {
	auth?: {
		apiKey?: string;
	};
	env?: Record<string, string>;
};

export type ModelRegistryLike = {
	getAll?(): ModelLike[];
	getAvailable?(): MaybePromise<ModelLike[]>;
	hasConfiguredAuth?(model: ModelLike): boolean;
	getProvider?(provider: string): ProviderLike | undefined;
	getProviderAuthStatus?(provider: string): {
		configured: boolean;
		source?: string;
		label?: string;
	};
	getProviderDisplayName?(provider: string): string;
	getProviderAuth?(provider: string): Promise<ProviderAuthLike | undefined>;
	getApiKeyForProvider?(provider: string): Promise<string | undefined>;
	isUsingOAuth?(model: ModelLike): boolean;
};

export type ProviderUsageContext = {
	model?: ModelLike;
	modelRegistry?: ModelRegistryLike;
	readStoredCredential?(providerId: string): AuthCredentialLike | undefined;
	reportError?(message: string): void;
};

const PROVIDER_USAGE_FETCH_TIMEOUT_MS = 5000;
const PROVIDER_USAGE_FETCH_MAX_ATTEMPTS = 3;
const PROVIDER_USAGE_TRANSIENT_RETRY_BASE_MS = 50;
const PROVIDER_USAGE_THROTTLE_RETRY_BASE_MS = 1000;
const PROVIDER_USAGE_RETRY_MAX_DELAY_MS = 20_000;
const OPENAI_LOGO = "\u{F0004}";
const CODEX_PROXY_LOGO = "\uF120"; // nf-fa-terminal
const OPENROUTER_LOGO = "\u{F0469}";
const GITHUB_LOGO = "\uF09B";

export type { ProxyUsageAccount } from "./cliproxy-usage";
export type { ProviderUsageScope } from "./usage-quota";

type ThemeLike = {
	fg(color: string, text: string): string;
};

type ProviderUsageAuthKind = "oauth" | "api_key" | "unknown";
type ProviderUsageState = "ready" | "unknown" | "error" | "unsupported";

export type ProviderUsageStatus = {
	providerId: string;
	authKind: ProviderUsageAuthKind;
	state: ProviderUsageState;
	scope?: ProviderUsageScope;
	copilot?: CopilotUsageDetails;
	fetchedAt?: number;
};

type ProviderUsageCacheEntry = ProviderUsageStatus & {
	lastAttemptAt?: number;
};

export type ProviderUsageTarget = {
	providerId: string;
	authKind: ProviderUsageAuthKind;
	active: boolean;
};

const OAUTH_PROVIDER_IDS = new Set([
	"anthropic",
	"openai",
	"openai-codex",
	"github-copilot",
]);
const LLMHUB_USAGE_PROVIDER_ID = "llm-hub";
const LITELLM_PROVIDER_ID = "litellm";
const OPENAI_USAGE_FAMILY = "openai";
const API_KEY_PROVIDER_IDS = new Set([
	"anthropic",
	OPENAI_USAGE_FAMILY,
	"openrouter",
	LLMHUB_USAGE_PROVIDER_ID,
]);
const USAGE_IGNORED_PROVIDER_IDS = new Set([LITELLM_PROVIDER_ID]);
const PROVIDER_FAMILY_ORDER = [
	LLMHUB_USAGE_PROVIDER_ID,
	"github-copilot",
	"openai",
	"openrouter",
];

type AvailableModelsCacheEntry = {
	models?: ModelLike[];
	pending?: Promise<void>;
	callbacks: Set<() => void>;
};

type ProviderUsageStoreState = {
	proxyStore: ProxyUsageStore;
	fetchFn?: typeof globalThis.fetch;
	env?: NodeJS.ProcessEnv;
	cache: Map<string, ProviderUsageCacheEntry>;
	refreshes: Map<string, Promise<void>>;
	resolvedCacheKeys: Map<string, string>;
	resolutionIds: Map<string, number>;
	cachePath: string | undefined;
	availableModelsCache: WeakMap<ModelRegistryLike, AvailableModelsCacheEntry>;
	discoveryId: number;
	resolutionId: number;
};

function createStoreState(
	options?: ProviderUsageStoreOptions,
): ProviderUsageStoreState {
	return {
		proxyStore: createProxyUsageStore({
			requestProxy: options?.requestProxy,
			env: options?.env,
		}),
		fetchFn: options?.fetch,
		env: options?.env,
		cache: new Map(),
		refreshes: new Map(),
		resolvedCacheKeys: new Map(),
		resolutionIds: new Map(),
		cachePath: undefined,
		availableModelsCache: new WeakMap(),
		discoveryId: 0,
		resolutionId: 0,
	};
}

function sharedCachePath(env?: NodeJS.ProcessEnv): string {
	const source = env ?? process.env;
	return (
		source.PI_PROVIDER_USAGE_CACHE_PATH ??
		join(
			source.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
			"pi",
			"provider-usage.json",
		)
	);
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

function copilotPlan(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const plans: Record<string, string> = {
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
	const key = value.toLowerCase();
	return Object.hasOwn(plans, key) ? plans[key] : undefined;
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
function parseCachedCopilotUsage(
	value: unknown,
): CopilotUsageDetails | undefined {
	if (!isRecord(value)) return undefined;
	const details: CopilotUsageDetails = {
		plan:
			typeof value.plan === "string" &&
			[
				"Free",
				"Pro",
				"Pro+",
				"Business",
				"Enterprise",
				"Student",
				"Max",
			].includes(value.plan)
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

function isProviderUsageAuthKind(
	value: unknown,
): value is ProviderUsageAuthKind {
	return value === "oauth" || value === "api_key" || value === "unknown";
}

function isProviderUsageState(value: unknown): value is ProviderUsageState {
	return (
		value === "ready" ||
		value === "unknown" ||
		value === "error" ||
		value === "unsupported"
	);
}

function parseCachedScope(value: unknown): ProviderUsageScope | undefined {
	if (!isRecord(value)) return undefined;
	return {
		sessionPercentUsed:
			typeof value.sessionPercentUsed === "number"
				? value.sessionPercentUsed
				: undefined,
		sessionResetAt:
			typeof value.sessionResetAt === "number"
				? value.sessionResetAt
				: undefined,
		weeklyPercentUsed:
			typeof value.weeklyPercentUsed === "number"
				? value.weeklyPercentUsed
				: undefined,
		weeklyResetAt:
			typeof value.weeklyResetAt === "number" ? value.weeklyResetAt : undefined,
		monthlyPercentUsed:
			typeof value.monthlyPercentUsed === "number"
				? value.monthlyPercentUsed
				: undefined,
		monthlyResetAt: numericField(value.monthlyResetAt),
		percentUsed:
			typeof value.percentUsed === "number" ? value.percentUsed : undefined,
		resetAt: numericField(value.resetAt),
		windowSeconds: numericField(value.windowSeconds),
		availableResets:
			typeof value.availableResets === "number"
				? value.availableResets
				: undefined,
		balanceUsd:
			typeof value.balanceUsd === "number" ? value.balanceUsd : undefined,
		creditsUsd:
			typeof value.creditsUsd === "number" ? value.creditsUsd : undefined,
		spendUsd: typeof value.spendUsd === "number" ? value.spendUsd : undefined,
	};
}

function parseCacheEntry(value: unknown): ProviderUsageCacheEntry | undefined {
	if (!isRecord(value)) return undefined;
	if (
		typeof value.providerId !== "string" ||
		!isProviderUsageAuthKind(value.authKind) ||
		!isProviderUsageState(value.state)
	) {
		return undefined;
	}

	const scope = parseCachedScope(value.scope);
	return {
		providerId: value.providerId,
		authKind: value.authKind,
		state: value.state,
		scope,
		copilot:
			value.providerId === "github-copilot"
				? parseCachedCopilotUsage(value.copilot)
				: undefined,
		fetchedAt:
			typeof value.fetchedAt === "number" ? value.fetchedAt : undefined,
		lastAttemptAt:
			typeof value.lastAttemptAt === "number" ? value.lastAttemptAt : undefined,
	};
}

function readSharedCache(
	env?: NodeJS.ProcessEnv,
): Map<string, ProviderUsageCacheEntry> {
	const entries = new Map<string, ProviderUsageCacheEntry>();
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(sharedCachePath(env), "utf8"),
		);
		if (!isRecord(parsed) || !isRecord(parsed.entries)) return entries;
		for (const [key, value] of Object.entries(parsed.entries)) {
			const entry = parseCacheEntry(value);
			if (
				!entry ||
				!isProviderSupportedAuth(entry.providerId, entry.authKind)
			) {
				continue;
			}
			entries.set(key, entry);
		}
	} catch {
		// A missing or malformed cache is equivalent to an empty cache.
	}
	return entries;
}

function hydrateSharedCache(state: ProviderUsageStoreState): void {
	const path = sharedCachePath(state.env);
	if (state.cachePath !== path) {
		state.cache.clear();
		state.resolvedCacheKeys.clear();
		state.proxyStore.pruneTargetLinks();
		state.resolutionIds.clear();
		state.cachePath = path;
	}
	for (const [key, diskEntry] of readSharedCache(state.env)) {
		const memoryEntry = state.cache.get(key);
		if ((diskEntry.lastAttemptAt ?? 0) > (memoryEntry?.lastAttemptAt ?? 0)) {
			state.cache.set(key, diskEntry);
		}
	}
}

async function persistSharedCache(
	state: ProviderUsageStoreState,
): Promise<void> {
	await updateLeasedJsonFile(
		sharedCachePath(state.env),
		() => {
			const merged = readSharedCache(state.env);
			for (const [key, memoryEntry] of state.cache) {
				const diskEntry = merged.get(key);
				if (
					!diskEntry ||
					(memoryEntry.lastAttemptAt ?? 0) >= (diskEntry.lastAttemptAt ?? 0)
				) {
					merged.set(key, memoryEntry);
				}
			}

			const entries = Object.fromEntries(
				[...merged.entries()].map(([key, entry]) => [
					key,
					{
						providerId: entry.providerId,
						authKind: entry.authKind,
						state: entry.state,
						scope: entry.scope,
						copilot: entry.copilot,
						fetchedAt: entry.fetchedAt,
						lastAttemptAt: entry.lastAttemptAt,
					},
				]),
			);
			return { entries };
		},
		{ retries: 10 },
	);
}

function credentialFingerprint(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function providerRefreshLeasePath(
	cacheKey: string,
	env?: NodeJS.ProcessEnv,
): string {
	return `${sharedCachePath(env)}.refresh-${credentialFingerprint(cacheKey)}`;
}

function normalizeProviderId(providerId: string): string {
	return providerId.trim().toLowerCase();
}

function getStoredCredential(
	ctx: ProviderUsageContext,
	providerId: string,
): AuthCredentialLike | undefined {
	return ctx.readStoredCredential?.(providerId);
}

function providerFamily(providerId: string): string {
	const normalized = normalizeProviderId(providerId);
	if (normalized === "openai-codex" || normalized === OPENAI_USAGE_FAMILY) {
		return OPENAI_USAGE_FAMILY;
	}
	return normalized;
}

export function mappedProviderUsageFamily(
	model: ModelLike | undefined,
): string | undefined {
	if (
		!model?.provider ||
		normalizeProviderId(model.provider) !== LITELLM_PROVIDER_ID
	) {
		return undefined;
	}
	const route = model.id?.trim().split("/", 1)[0]?.trim().toLowerCase();
	return route === "chatgpt" || route === OPENAI_USAGE_FAMILY
		? OPENAI_USAGE_FAMILY
		: undefined;
}

function compareProviderIds(a: string, b: string): number {
	const aFamily = providerFamily(a);
	const bFamily = providerFamily(b);
	const aIndex = PROVIDER_FAMILY_ORDER.indexOf(aFamily);
	const bIndex = PROVIDER_FAMILY_ORDER.indexOf(bFamily);
	const aOrder = aIndex === -1 ? PROVIDER_FAMILY_ORDER.length : aIndex;
	const bOrder = bIndex === -1 ? PROVIDER_FAMILY_ORDER.length : bIndex;
	return aOrder - bOrder || aFamily.localeCompare(bFamily);
}

function providerTargetKey(
	providerId: string,
	authKind: ProviderUsageAuthKind,
): string {
	return `${normalizeProviderId(providerId)}:${authKind}`;
}

function credentialScopedKey(
	targetKey: string,
	credentialIdentity: string,
): string {
	return `${targetKey}:${credentialFingerprint(`${targetKey}\0${credentialIdentity}`)}`;
}

/** Model routing uses the last recorded value, without refreshing OAuth or usage. */
function cachedProviderPercentUsedInStore(
	state: ProviderUsageStoreState,
	providerId: string,
	ctx: ProviderUsageContext,
): number | undefined {
	const normalized = normalizeProviderId(providerId);
	if (normalized === "github-copilot") return cachedCopilotPercentUsed(ctx);
	if (normalized === "cliproxyapi") return state.proxyStore.cachedPercentUsed();
	return undefined;
}

function cachedCopilotPercentUsed(
	ctx: ProviderUsageContext,
): number | undefined {
	const credential = getStoredOAuthCredential(ctx, "github-copilot");
	const identity = credential?.refresh ?? credential?.access;
	if (!identity) return undefined;
	const key = credentialScopedKey(
		providerTargetKey("github-copilot", "oauth"),
		identity,
	);
	const quota = readSharedCache().get(key)?.copilot?.premium;
	if (!quota || quota.unlimited) return undefined;
	if (quota.percentUsed !== undefined) return quota.percentUsed;
	if (
		quota.allowance !== undefined &&
		quota.allowance > 0 &&
		quota.remaining !== undefined
	)
		return Math.max(
			0,
			((quota.allowance - quota.remaining) / quota.allowance) * 100,
		);
	return undefined;
}

function providerCacheKey(
	state: ProviderUsageStoreState,
	providerId: string,
	authKind: ProviderUsageAuthKind,
): string {
	const targetKey = providerTargetKey(providerId, authKind);
	return state.resolvedCacheKeys.get(targetKey) ?? targetKey;
}

function isProviderSupportedAuth(
	providerId: string,
	authKind: ProviderUsageAuthKind,
): boolean {
	const normalized = normalizeProviderId(providerId);
	if (authKind === "oauth") return OAUTH_PROVIDER_IDS.has(normalized);
	if (authKind === "api_key") return API_KEY_PROVIDER_IDS.has(normalized);
	return false;
}

function supportedApiKeyProviderIds(): string[] {
	return [...API_KEY_PROVIDER_IDS];
}

function addProviderCandidate(
	candidates: ProviderUsageTarget[],
	providerId: string | undefined,
	authKind: ProviderUsageAuthKind,
	activeProviderId: string | undefined,
): void {
	if (!providerId) return;
	const normalized = normalizeProviderId(providerId);
	if (
		!normalized ||
		USAGE_IGNORED_PROVIDER_IDS.has(normalized) ||
		!isProviderSupportedAuth(normalized, authKind)
	) {
		return;
	}

	candidates.push({
		providerId: normalized,
		authKind,
		active: activeProviderId === normalized,
	});
}

function modelAuthKind(
	ctx: ProviderUsageContext,
	model: ModelLike,
): ProviderUsageAuthKind | undefined {
	if (ctx.modelRegistry?.isUsingOAuth?.(model)) return "oauth";
	const providerId = model.provider
		? normalizeProviderId(model.provider)
		: undefined;
	const credential = providerId
		? getStoredCredential(ctx, providerId)
		: undefined;
	if (credential?.type === "oauth") return "oauth";
	if (credential?.type === "api_key") return "api_key";
	if (!providerId || !API_KEY_PROVIDER_IDS.has(providerId)) return undefined;

	if (providerId === LLMHUB_USAGE_PROVIDER_ID) {
		if (ctx.modelRegistry?.getProviderAuthStatus?.(providerId)?.configured) {
			return "api_key";
		}
		return ctx.modelRegistry?.hasConfiguredAuth?.(model)
			? "api_key"
			: undefined;
	}

	return "api_key";
}

function getConfiguredModels(
	state: ProviderUsageStoreState,
	ctx: ProviderUsageContext,
	onUpdate?: () => void,
): ModelLike[] {
	const registry = ctx.modelRegistry;
	if (!registry) return [];

	const cached = state.availableModelsCache.get(registry);
	if (cached?.models) return cached.models;
	if (cached?.pending) {
		if (onUpdate) cached.callbacks.add(onUpdate);
		return [];
	}

	const available = registry.getAvailable?.();
	if (Array.isArray(available)) {
		state.availableModelsCache.set(registry, {
			models: available,
			callbacks: new Set(),
		});
		return available;
	}
	if (available) {
		const entry: AvailableModelsCacheEntry = { callbacks: new Set() };
		if (onUpdate) entry.callbacks.add(onUpdate);
		entry.pending = available
			.then((models) => {
				entry.models = Array.isArray(models) ? models : [];
			})
			.catch(() => {
				state.availableModelsCache.delete(registry);
			})
			.finally(() => {
				entry.pending = undefined;
				for (const callback of entry.callbacks) callback();
				entry.callbacks.clear();
			});
		state.availableModelsCache.set(registry, entry);
		return [];
	}

	const allModels = registry.getAll?.() ?? [];
	const hasConfiguredAuth = registry.hasConfiguredAuth;
	return hasConfiguredAuth
		? allModels.filter((model) => hasConfiguredAuth(model))
		: [];
}

function providerAuthKindOrder(authKind: ProviderUsageAuthKind): number {
	if (authKind === "oauth") return 0;
	if (authKind === "api_key") return 1;
	return 2;
}

function preferProviderCandidate(
	current: ProviderUsageTarget | undefined,
	candidate: ProviderUsageTarget,
	activeProviderId: string | undefined,
	activeAuthKind: ProviderUsageAuthKind | undefined,
): ProviderUsageTarget {
	if (!current) return candidate;

	const candidateMatchesActive = candidate.providerId === activeProviderId;
	const currentMatchesActive = current.providerId === activeProviderId;
	if (candidateMatchesActive !== currentMatchesActive) {
		return candidateMatchesActive ? candidate : current;
	}

	if (candidateMatchesActive && currentMatchesActive && activeAuthKind) {
		if (
			candidate.authKind === activeAuthKind &&
			current.authKind !== activeAuthKind
		) {
			return candidate;
		}
		if (
			current.authKind === activeAuthKind &&
			candidate.authKind !== activeAuthKind
		) {
			return current;
		}
	}

	if (candidate.authKind !== current.authKind) {
		return providerAuthKindOrder(candidate.authKind) <
			providerAuthKindOrder(current.authKind)
			? candidate
			: current;
	}

	return compareProviderIds(candidate.providerId, current.providerId) < 0
		? candidate
		: current;
}

async function discoverProviderUsageTargetsAsyncInStore(
	state: ProviderUsageStoreState,
	ctx: ProviderUsageContext,
): Promise<ProviderUsageTarget[]> {
	const discoveryId = ++state.discoveryId;
	const registry = ctx.modelRegistry;
	const available = registry?.getAvailable?.();
	if (registry && available) {
		try {
			const models = Array.isArray(available) ? available : await available;
			if (discoveryId === state.discoveryId) {
				state.availableModelsCache.set(registry, {
					models,
					callbacks: new Set(),
				});
			}
		} catch {
			// Discovery still falls back to configured models and auth storage.
		}
	}
	const targets = discoverProviderUsageTargets(state, ctx);
	if (discoveryId === state.discoveryId) {
		state.proxyStore.pruneTargetLinks(
			targets.map((target) =>
				providerTargetKey(target.providerId, target.authKind),
			),
		);
	}
	return targets;
}

function discoverProviderUsageTargets(
	state: ProviderUsageStoreState,
	ctx: ProviderUsageContext,
): ProviderUsageTarget[] {
	const activeProviderId = ctx.model?.provider
		? normalizeProviderId(ctx.model.provider)
		: undefined;
	const activeAuthKind = ctx.model ? modelAuthKind(ctx, ctx.model) : undefined;
	const candidates: ProviderUsageTarget[] = [];
	const configuredModels = getConfiguredModels(state, ctx);
	const llmHubConfigured =
		activeProviderId === LLMHUB_USAGE_PROVIDER_ID ||
		configuredModels.some(
			(model) =>
				model.provider &&
				normalizeProviderId(model.provider) === LLMHUB_USAGE_PROVIDER_ID,
		) ||
		(ctx.modelRegistry?.getAll?.() ?? []).some(
			(model) =>
				model.provider &&
				normalizeProviderId(model.provider) === LLMHUB_USAGE_PROVIDER_ID,
		) ||
		ctx.modelRegistry?.getProvider?.(LLMHUB_USAGE_PROVIDER_ID) !== undefined;

	if (
		activeProviderId &&
		activeAuthKind &&
		isProviderSupportedAuth(activeProviderId, activeAuthKind)
	) {
		addProviderCandidate(
			candidates,
			activeProviderId,
			activeAuthKind,
			activeProviderId,
		);
	} else if (
		activeProviderId &&
		!activeAuthKind &&
		activeProviderId !== LLMHUB_USAGE_PROVIDER_ID
	) {
		if (OAUTH_PROVIDER_IDS.has(activeProviderId)) {
			addProviderCandidate(
				candidates,
				activeProviderId,
				"oauth",
				activeProviderId,
			);
		}
		if (API_KEY_PROVIDER_IDS.has(activeProviderId)) {
			addProviderCandidate(
				candidates,
				activeProviderId,
				"api_key",
				activeProviderId,
			);
		}
	}

	for (const model of configuredModels) {
		const authKind = modelAuthKind(ctx, model);
		if (authKind) {
			addProviderCandidate(
				candidates,
				model.provider,
				authKind,
				activeProviderId,
			);
		}
	}

	if (ctx.readStoredCredential) {
		const storedProviderIds = new Set([
			...OAUTH_PROVIDER_IDS,
			...API_KEY_PROVIDER_IDS,
		]);
		for (const providerId of storedProviderIds) {
			if (providerId === LLMHUB_USAGE_PROVIDER_ID && !llmHubConfigured) {
				continue;
			}
			const credential = getStoredCredential(ctx, providerId);
			if (credential?.type === "oauth") {
				addProviderCandidate(candidates, providerId, "oauth", activeProviderId);
			} else if (credential?.type === "api_key") {
				addProviderCandidate(
					candidates,
					providerId,
					"api_key",
					activeProviderId,
				);
			}
		}
	}

	for (const providerId of supportedApiKeyProviderIds()) {
		if (providerId === LLMHUB_USAGE_PROVIDER_ID && !llmHubConfigured) {
			continue;
		}
		const authStatus = ctx.modelRegistry?.getProviderAuthStatus?.(providerId);
		if (authStatus?.configured) {
			const authKind =
				getStoredCredential(ctx, providerId)?.type ??
				(authStatus.source === "OAuth" ? "oauth" : "api_key");
			addProviderCandidate(candidates, providerId, authKind, activeProviderId);
		}
	}

	const byFamily = new Map<string, ProviderUsageTarget>();
	for (const candidate of candidates) {
		const family = providerFamily(candidate.providerId);
		byFamily.set(
			family,
			preferProviderCandidate(
				byFamily.get(family),
				candidate,
				activeProviderId,
				activeAuthKind,
			),
		);
	}

	return [...byFamily.values()].sort((a, b) =>
		compareProviderIds(a.providerId, b.providerId),
	);
}

async function getProviderToken(
	ctx: ProviderUsageContext,
	providerId: string,
): Promise<string | undefined> {
	const providerAuth = await ctx.modelRegistry?.getProviderAuth?.(providerId);
	return (
		providerAuth?.auth?.apiKey ??
		(await ctx.modelRegistry?.getApiKeyForProvider?.(providerId))
	);
}

function getStoredOAuthCredential(
	ctx: ProviderUsageContext,
	providerId: string,
): Extract<AuthCredentialLike, { type: "oauth" }> | undefined {
	const credential = getStoredCredential(ctx, providerId);
	return credential?.type === "oauth" ? credential : undefined;
}

async function getOAuthProviderToken(
	ctx: ProviderUsageContext,
	providerId: string,
): Promise<string | undefined> {
	// Native auth resolution refreshes expired OAuth access before usage polling.
	return (
		(await getProviderToken(ctx, providerId)) ??
		getStoredOAuthCredential(ctx, providerId)?.access
	);
}

async function getGitHubCopilotUserToken(
	ctx: ProviderUsageContext,
): Promise<string | undefined> {
	const credential = getStoredOAuthCredential(ctx, "github-copilot");
	return credential?.refresh ?? (await getProviderToken(ctx, "github-copilot"));
}

type ResolvedProviderUsageAccess = {
	cacheKey: string;
	token?: string;
	baseUrl?: string;
	codexAccountId?: string;
};

function configuredProviderBaseUrl(
	state: ProviderUsageStoreState,
	ctx: ProviderUsageContext,
	providerId: string,
): string | undefined {
	const normalizedProviderId = normalizeProviderId(providerId);
	if (
		ctx.model?.provider &&
		normalizeProviderId(ctx.model.provider) === normalizedProviderId &&
		ctx.model.baseUrl
	) {
		return ctx.model.baseUrl;
	}

	const configuredModel = [
		...getConfiguredModels(state, ctx),
		...(ctx.modelRegistry?.getAll?.() ?? []),
	].find(
		(model) =>
			model.provider &&
			normalizeProviderId(model.provider) === normalizedProviderId &&
			model.baseUrl,
	);
	return (
		configuredModel?.baseUrl ??
		ctx.modelRegistry?.getProvider?.(normalizedProviderId)?.baseUrl
	);
}

async function resolveProviderUsageAccess(
	state: ProviderUsageStoreState,
	ctx: ProviderUsageContext,
	target: ProviderUsageTarget,
): Promise<ResolvedProviderUsageAccess> {
	const targetKey = providerTargetKey(target.providerId, target.authKind);
	let token: string | undefined;
	let baseUrl: string | undefined;
	let credentialIdentity: string | undefined;

	if (
		target.providerId === LLMHUB_USAGE_PROVIDER_ID &&
		target.authKind === "api_key"
	) {
		token = await getProviderToken(ctx, target.providerId);
		baseUrl = configuredProviderBaseUrl(state, ctx, target.providerId);
		if (baseUrl && token) {
			credentialIdentity = `${normalizeBaseUrl(baseUrl)}\0${token}`;
		}
	} else if (target.authKind === "oauth") {
		token =
			target.providerId === "github-copilot"
				? await getGitHubCopilotUserToken(ctx)
				: await getOAuthProviderToken(ctx, target.providerId);
		credentialIdentity = token;
	} else if (target.authKind === "api_key") {
		token = await getProviderToken(ctx, target.providerId);
		credentialIdentity = token;
	}

	const cacheKey = credentialIdentity
		? credentialScopedKey(targetKey, credentialIdentity)
		: targetKey;
	const accountId =
		isLegacyCodex(target) && token ? extractOpenAiAccountId(token) : undefined;
	return {
		cacheKey,
		token,
		baseUrl,
		codexAccountId: accountId,
	};
}

function normalizeBaseUrl(url: string): string {
	return url.trim().replace(/\/+$/, "");
}

function retryAfterMs(response: Response): number | undefined {
	const value = response.headers.get("retry-after")?.trim();
	if (!value) return undefined;

	const seconds = Number(value);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp)
		? Math.max(0, timestamp - Date.now())
		: undefined;
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
			serverDelayMs: retryAfterMs,
		},
	);
}

async function fetchJson(
	fetchFn: typeof globalThis.fetch,
	url: string,
	init: RequestInit,
): Promise<unknown | undefined> {
	const response = await fetchProviderUsageResponse(fetchFn, url, init);
	if (!response.ok) return undefined;
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

function extractOpenAiAccountId(token: string): string | undefined {
	const payload = jwtPayload(token);
	if (!payload) return undefined;
	const authClaim = nestedRecord(payload, "https://api.openai.com/auth");
	const accountId = authClaim?.chatgpt_account_id ?? authClaim?.account_id;
	return typeof accountId === "string" && accountId ? accountId : undefined;
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

function parseOpenAiResetCreditsBody(
	body: unknown,
): ProviderUsageScope | undefined {
	if (!isRecord(body)) return undefined;
	const availableCount = numericField(
		body.available_count ?? body.availableCount,
	);
	return availableCount === undefined
		? undefined
		: { availableResets: Math.max(0, Math.floor(availableCount)) };
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
	const resetCreditsScope = parseOpenAiResetCreditsBody(resetCreditsBody);
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
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return parseCopilotUsage(await response.json());
}

async function fetchProviderUsage(
	fetchFn: typeof globalThis.fetch,
	target: ProviderUsageTarget,
	access: ResolvedProviderUsageAccess,
): Promise<ProviderUsageStatus> {
	const makeStatus = (
		fields: Omit<ProviderUsageStatus, "providerId" | "authKind" | "fetchedAt">,
	): ProviderUsageStatus => ({
		providerId: target.providerId,
		authKind: target.authKind,
		fetchedAt: Date.now(),
		...fields,
	});

	if (target.authKind === "oauth") {
		let scope: ProviderUsageScope | undefined;
		if (target.providerId === "github-copilot") {
			const copilot = access.token
				? await fetchGitHubCopilotUsage(fetchFn, access.token)
				: undefined;
			const percentUsed = copilot?.premium?.percentUsed;
			// Reset/count details are popup-only; keep Pi's compact badge unchanged.
			return makeStatus({
				state: copilot ? "ready" : "unknown",
				copilot,
				scope:
					percentUsed !== undefined
						? { monthlyPercentUsed: percentUsed }
						: undefined,
			});
		} else {
			if (!access.token) return makeStatus({ state: "unknown" });
			const token = access.token;

			if (target.providerId === "anthropic") {
				scope = await fetchAnthropicOAuthUsage(fetchFn, token);
			} else if (target.providerId === "openai-codex") {
				scope = await fetchOpenAiCodexUsage(fetchFn, token);
			} else {
				return makeStatus({ state: "unsupported" });
			}
		}

		return scope
			? makeStatus({ state: "ready", scope })
			: makeStatus({ state: "unknown" });
	}

	if (
		target.providerId === LLMHUB_USAGE_PROVIDER_ID &&
		target.authKind === "api_key"
	) {
		if (!access.baseUrl || !access.token) {
			return makeStatus({ state: "unknown" });
		}

		const scope = await fetchLlmHubSpend(fetchFn, access.baseUrl, access.token);
		return scope
			? makeStatus({ state: "ready", scope })
			: makeStatus({ state: "unknown" });
	}

	if (target.providerId === "openrouter" && target.authKind === "api_key") {
		if (!access.token) return makeStatus({ state: "unknown" });

		const scope =
			(await fetchOpenRouterKeyStatus(fetchFn, access.token).catch(
				() => undefined,
			)) ??
			(await fetchOpenRouterCredits(fetchFn, access.token).catch(
				() => undefined,
			));
		return scope
			? makeStatus({ state: "ready", scope })
			: makeStatus({ state: "unknown" });
	}

	return makeStatus({ state: "unsupported" });
}

function invalidateProviderUsageDiscoveryInStore(
	state: ProviderUsageStoreState,
): void {
	state.discoveryId++;
	state.availableModelsCache = new WeakMap<
		ModelRegistryLike,
		AvailableModelsCacheEntry
	>();
}

function hydrateEntryIfAdvanced(
	state: ProviderUsageStoreState,
	cacheKey: string,
	beforeAttemptAt: number,
): boolean {
	hydrateSharedCache(state);
	return (state.cache.get(cacheKey)?.lastAttemptAt ?? 0) > beforeAttemptAt;
}

function reportProviderUsageIssue(
	ctx: ProviderUsageContext,
	target: ProviderUsageTarget,
	message: string,
): void {
	ctx.reportError?.(`Provider usage (${target.providerId}): ${message}`);
}

async function refreshProviderUsageTarget(
	state: ProviderUsageStoreState,
	ctx: ProviderUsageContext,
	target: ProviderUsageTarget,
	access: ResolvedProviderUsageAccess,
): Promise<boolean> {
	const beforeAttemptAt = state.cache.get(access.cacheKey)?.lastAttemptAt ?? 0;
	const outcome = await runLeasedRefresh(
		providerRefreshLeasePath(access.cacheKey, state.env),
		async (lease) => {
			// Another process may have refreshed while this process acquired the lease.
			const advanced = hydrateEntryIfAdvanced(
				state,
				access.cacheKey,
				beforeAttemptAt,
			);
			const hydratedEntry = state.cache.get(access.cacheKey);
			if (isUsageCacheFresh(hydratedEntry)) return advanced;

			const previousEntry = hydratedEntry;
			let entry: ProviderUsageCacheEntry;
			try {
				const status = await fetchProviderUsage(
					state.fetchFn ?? globalThis.fetch,
					target,
					access,
				);
				const completedAt = status.fetchedAt ?? Date.now();
				entry = {
					...status,
					scope:
						status.scope ??
						(status.state === "unknown" ? previousEntry?.scope : undefined),
					copilot:
						status.copilot ??
						(status.state === "unknown" ? previousEntry?.copilot : undefined),
					fetchedAt:
						status.scope ||
						status.copilot ||
						!(previousEntry?.scope || previousEntry?.copilot)
							? completedAt
							: previousEntry.fetchedAt,
					lastAttemptAt: completedAt,
				};
				if (status.state === "unknown") {
					reportProviderUsageIssue(
						ctx,
						target,
						"provider returned no usage data",
					);
				}
			} catch (error) {
				const completedAt = Date.now();
				entry = {
					providerId: target.providerId,
					authKind: target.authKind,
					state: "error",
					scope: previousEntry?.scope,
					copilot: previousEntry?.copilot,
					fetchedAt:
						previousEntry?.scope || previousEntry?.copilot
							? previousEntry.fetchedAt
							: completedAt,
					lastAttemptAt: completedAt,
				};
				reportProviderUsageIssue(
					ctx,
					target,
					error instanceof Error ? error.message : String(error),
				);
			}

			lease.assertOwned();
			state.cache.set(access.cacheKey, entry);
			await persistSharedCache(state);
			return true;
		},
		{
			onReleaseError: (error) => {
				reportProviderUsageIssue(
					ctx,
					target,
					`failed to release refresh lease: ${error instanceof Error ? error.message : String(error)}`,
				);
			},
		},
	);

	if (outcome.status === "ok") return outcome.value;
	if (outcome.status === "contended") {
		const advanced = hydrateEntryIfAdvanced(
			state,
			access.cacheKey,
			beforeAttemptAt,
		);
		if (!isUsageCacheFresh(state.cache.get(access.cacheKey))) {
			reportProviderUsageIssue(
				ctx,
				target,
				"timed out waiting for another process",
			);
		}
		return advanced;
	}
	if (outcome.status === "compromised") {
		const advanced = hydrateEntryIfAdvanced(
			state,
			access.cacheKey,
			beforeAttemptAt,
		);
		reportProviderUsageIssue(
			ctx,
			target,
			`refresh lease was compromised: ${outcome.error.message}`,
		);
		return advanced;
	}
	if (outcome.phase === "acquire") {
		const advanced = hydrateEntryIfAdvanced(
			state,
			access.cacheKey,
			beforeAttemptAt,
		);
		if (!isUsageCacheFresh(state.cache.get(access.cacheKey))) {
			reportProviderUsageIssue(
				ctx,
				target,
				`failed to acquire refresh lease: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`,
			);
		}
		return advanced;
	}
	reportProviderUsageIssue(
		ctx,
		target,
		outcome.error instanceof Error
			? outcome.error.message
			: String(outcome.error),
	);
	return false;
}

async function queueProviderUsageRefresh(
	state: ProviderUsageStoreState,
	ctx: ProviderUsageContext,
	target: ProviderUsageTarget,
	onUpdate: () => void,
	proxyRefresh: Promise<void>,
): Promise<void> {
	// Initialize the cache path before resolving the process-local cache-key map.
	hydrateSharedCache(state);
	const targetKey = providerTargetKey(target.providerId, target.authKind);
	const resolutionId = ++state.resolutionId;
	state.resolutionIds.set(targetKey, resolutionId);
	let access: ResolvedProviderUsageAccess;
	try {
		access = await resolveProviderUsageAccess(state, ctx, target);
	} catch (error) {
		reportProviderUsageIssue(
			ctx,
			target,
			error instanceof Error ? error.message : String(error),
		);
		if (state.resolutionIds.get(targetKey) === resolutionId) {
			const hadProxyBinding = state.proxyStore.setTargetLink(
				targetKey,
				undefined,
			);
			if (state.resolvedCacheKeys.delete(targetKey) || hadProxyBinding)
				onUpdate();
		}
		return;
	}

	const isLatestResolution =
		state.resolutionIds.get(targetKey) === resolutionId;
	let mappingChanged = false;
	if (isLatestResolution) {
		mappingChanged = state.resolvedCacheKeys.get(targetKey) !== access.cacheKey;
		state.resolvedCacheKeys.set(targetKey, access.cacheKey);
		if (isLegacyCodex(target)) {
			const bindingChanged = state.proxyStore.setTargetLink(
				targetKey,
				access.codexAccountId
					? { kind: "codex", id: access.codexAccountId }
					: undefined,
			);
			mappingChanged ||= bindingChanged;
		}
	}

	if (isLegacyCodex(target)) {
		// Give the shared reader first refusal, including cold-cache refreshes.
		await proxyRefresh;
		if (state.resolutionIds.get(targetKey) !== resolutionId) return;
		if (state.proxyStore.targetQuotaState(targetKey) === "fresh") {
			onUpdate();
			return;
		}
	}

	hydrateSharedCache(state);
	if (isUsageCacheFresh(state.cache.get(access.cacheKey))) {
		if (mappingChanged) onUpdate();
		return;
	}

	const refreshKey = `${sharedCachePath(state.env)}\0${access.cacheKey}`;
	const existing = state.refreshes.get(refreshKey);
	if (existing) {
		const beforeAttemptAt =
			state.cache.get(access.cacheKey)?.lastAttemptAt ?? 0;
		await existing;
		const advanced =
			(state.cache.get(access.cacheKey)?.lastAttemptAt ?? 0) > beforeAttemptAt;
		if (advanced || mappingChanged) onUpdate();
		return;
	}

	let didUpdate = false;
	const pending = refreshProviderUsageTarget(state, ctx, target, access)
		.then((updated) => {
			didUpdate = updated;
		})
		.finally(() => {
			if (state.refreshes.get(refreshKey) === pending) {
				state.refreshes.delete(refreshKey);
			}
		});
	state.refreshes.set(refreshKey, pending);
	await pending;
	if (didUpdate || mappingChanged) {
		onUpdate();
	}
}

function isNativeOpenAi(target: ProviderUsageTarget): boolean {
	return target.providerId === "openai" && target.authKind === "oauth";
}

function isLegacyCodex(target: ProviderUsageTarget): boolean {
	return target.providerId === "openai-codex" && target.authKind === "oauth";
}

function nativeOpenAiClientId(ctx: ProviderUsageContext): string | undefined {
	const credential = getStoredOAuthCredential(ctx, "openai");
	return credential?.access &&
		typeof credential.clientId === "string" &&
		credential.clientId.trim() &&
		credential.clientId.length <= 512 &&
		Array.isArray(credential.scopes) &&
		credential.scopes.includes("chatgpt.tokens.use.direct")
		? credential.clientId
		: undefined;
}

async function refreshNativeOpenAiBinding(
	state: ProviderUsageStoreState,
	ctx: ProviderUsageContext,
	target: ProviderUsageTarget,
	onUpdate: () => void,
): Promise<void> {
	const targetKey = providerTargetKey(target.providerId, target.authKind);
	const resolutionId = ++state.resolutionId;
	state.resolutionIds.set(targetKey, resolutionId);
	const expectedClientId = nativeOpenAiClientId(ctx);
	if (
		state.proxyStore.setTargetLink(
			targetKey,
			expectedClientId ? { kind: "native", id: expectedClientId } : undefined,
			{ clearOnlyOnMismatch: true },
		)
	) {
		onUpdate();
	}
	let clientId: string | undefined;
	try {
		// Resolve through Pi (including its OAuth refresh), but never send this token to the proxy.
		const token = await getProviderToken(ctx, "openai");
		if (token && getStoredOAuthCredential(ctx, "openai")?.access === token)
			clientId = nativeOpenAiClientId(ctx);
	} catch {
		// Runtime overrides, missing grants and failed auth resolution leave quota unavailable.
	}
	if (state.resolutionIds.get(targetKey) !== resolutionId) return;
	if (
		state.proxyStore.setTargetLink(
			targetKey,
			clientId ? { kind: "native", id: clientId } : undefined,
		)
	) {
		onUpdate();
	}
}

function refreshProviderUsageInStore(
	state: ProviderUsageStoreState,
	ctx: ProviderUsageContext,
	targets: ProviderUsageTarget[],
	onUpdate: () => void,
): Promise<void> {
	getConfiguredModels(state, ctx, onUpdate);
	// Initialize shared-cache state before any asynchronous auth resolution starts.
	hydrateSharedCache(state);
	state.proxyStore.pruneTargetLinks(
		targets.map((target) =>
			providerTargetKey(target.providerId, target.authKind),
		),
	);
	const nativeTargets = targets.filter(isNativeOpenAi);
	const proxyRefresh = Promise.all(
		nativeTargets.map((target) =>
			refreshNativeOpenAiBinding(state, ctx, target, onUpdate),
		),
	).then(() =>
		state.proxyStore.refreshSnapshot(
			onUpdate,
			state.proxyStore.hasNativeTargetLink()
				? "native"
				: targets.some(isLegacyCodex)
					? "codex"
					: undefined,
		),
	);
	return Promise.all([
		proxyRefresh,
		...targets
			.filter(
				(target) =>
					!isNativeOpenAi(target) &&
					isProviderSupportedAuth(target.providerId, target.authKind),
			)
			.map((target) =>
				queueProviderUsageRefresh(state, ctx, target, onUpdate, proxyRefresh),
			),
	]).then(() => {
		// A joined proxy refresh may belong to a disposed footer; notify this native consumer too.
		if (nativeTargets.length > 0) onUpdate();
	});
}

function providerDisplayLabel(providerId: string): string {
	switch (providerFamily(providerId)) {
		case LLMHUB_USAGE_PROVIDER_ID:
			return "LLMHub";
		case "anthropic":
			return "Anthropic";
		case "openai":
			return OPENAI_LOGO;
		case "openrouter":
			return OPENROUTER_LOGO;
		case "github-copilot":
			return GITHUB_LOGO;
		default:
			return providerId;
	}
}

function providerUsageLabelsForTarget(
	state: ProviderUsageStoreState,
	target: ProviderUsageTarget,
): string[] {
	if (isNativeOpenAi(target)) {
		return [`${providerDisplayLabel(target.providerId)} ?`];
	}
	const status = state.cache.get(
		providerCacheKey(state, target.providerId, target.authKind),
	);
	const freshness = usageSnapshotFreshness(status);
	const scopeText =
		freshness === "expired" ? undefined : formatProviderScope(status?.scope);
	if (!scopeText && !target.active) return [];
	return [
		`${providerDisplayLabel(target.providerId)} ${scopeText ? `${scopeText}${freshness === "stale" ? " !" : ""}` : "?"}`,
	];
}

function isTargetActive(
	target: ProviderUsageTarget,
	activeFamilyOverride?: string,
): boolean {
	return (
		target.active ||
		(activeFamilyOverride !== undefined &&
			providerFamily(target.providerId) === activeFamilyOverride)
	);
}

function directProviderUsageBadges(
	state: ProviderUsageStoreState,
	targets: ProviderUsageTarget[],
	activeOnly: boolean,
	activeFamilyOverride: string | undefined,
	proxySnapshot: ProxySnapshotView | undefined,
): { active: boolean; text: string }[] {
	return targets
		.filter(
			(target) =>
				isProviderSupportedAuth(target.providerId, target.authKind) &&
				(proxySnapshot?.targetQuotaState(
					providerTargetKey(target.providerId, target.authKind),
				) ?? "unlinked") === "unlinked",
		)
		.map((target) => ({
			...target,
			active: isTargetActive(target, activeFamilyOverride),
		}))
		.filter((target) => !activeOnly || target.active)
		.sort((a, b) => compareProviderIds(a.providerId, b.providerId))
		.flatMap((target) =>
			providerUsageLabelsForTarget(state, target).map((text) => ({
				active: target.active,
				text,
			})),
		);
}

export type CopilotUsageAccount = {
	summary: string;
	details?: CopilotUsageDetails;
	state: ProviderUsageState;
	fetchedAt?: number;
	lastAttemptAt?: number;
	stale: boolean;
};

function buildCopilotUsageAccount(
	state: ProviderUsageStoreState,
	targets: ProviderUsageTarget[],
): CopilotUsageAccount | undefined {
	const target = targets.find(
		(target) =>
			target.providerId === "github-copilot" && target.authKind === "oauth",
	);
	if (!target) return undefined;
	const status = state.cache.get(
		providerCacheKey(state, target.providerId, target.authKind),
	);
	const freshness = usageSnapshotFreshness(status);
	return {
		summary:
			freshness === "expired"
				? "?"
				: (formatProviderScope(status?.scope) ?? "?"),
		details: freshness === "expired" ? undefined : status?.copilot,
		state: status?.state ?? "unknown",
		fetchedAt: status?.fetchedAt,
		lastAttemptAt: status?.lastAttemptAt,
		stale: freshness === "stale",
	};
}

function legacyCodexDirectFallbacks(
	state: ProviderUsageStoreState,
	targets: ProviderUsageTarget[],
): Map<string, DirectProxyFallback> {
	const fallbacks = new Map<string, DirectProxyFallback>();
	for (const target of targets) {
		if (!isLegacyCodex(target)) continue;
		const status = state.cache.get(
			providerCacheKey(state, target.providerId, target.authKind),
		);
		if (!status?.scope) continue;
		const freshness = usageSnapshotFreshness(status);
		if (freshness === "expired") continue;
		fallbacks.set(providerTargetKey(target.providerId, target.authKind), {
			scope: status.scope,
			freshness,
			state: status.state,
			fetchedAt: status.fetchedAt,
			lastAttemptAt: status.lastAttemptAt,
		});
	}
	return fallbacks;
}

function resolveProxyAccounts(
	state: ProviderUsageStoreState,
	targets: ProviderUsageTarget[],
	proxySnapshot: ProxySnapshotView | undefined,
): ProxyUsageAccount[] {
	if (!proxySnapshot) return [];
	return proxySnapshot.resolveAccounts(
		legacyCodexDirectFallbacks(state, targets),
	);
}

function renderProxyUsageBadges(
	state: ProviderUsageStoreState,
	targets: ProviderUsageTarget[],
	proxySnapshot: ProxySnapshotView | undefined,
	options: {
		compact: boolean;
		activeOnly: boolean;
		activeFamilyOverride?: string;
		activeProxy: boolean;
	},
	renderPart: (text: string, active: boolean) => string,
): string[] {
	if (!proxySnapshot) return [];
	const linked = new Map<string, boolean>();
	for (const target of targets) {
		const accountKey = proxySnapshot.linkedAccountKey(
			providerTargetKey(target.providerId, target.authKind),
		);
		if (!accountKey) continue;
		linked.set(
			accountKey,
			!!linked.get(accountKey) ||
				isTargetActive(target, options.activeFamilyOverride),
		);
	}
	const valid = resolveProxyAccounts(state, targets, proxySnapshot).filter(
		(account) =>
			!options.activeOnly || options.activeProxy || linked.get(account.key),
	);
	const visible = options.compact ? valid.slice(0, 2) : valid;
	const scopes = visible.map((account) => {
		const proxyActive = options.activeProxy && !account.disabled;
		if (linked.has(account.key)) {
			const directActive = linked.get(account.key) === true;
			return `${renderPart(OPENAI_LOGO, directActive)} ${renderPart(CODEX_PROXY_LOGO, proxyActive)} ${renderPart(account.summary, directActive || proxyActive)}`;
		}
		return renderPart(`${CODEX_PROXY_LOGO} ${account.summary}`, proxyActive);
	});
	if (scopes.length === 0) return [];
	if (options.compact && valid.length > visible.length)
		scopes.push(renderPart(`+${valid.length - visible.length}`, false));
	return [
		`${scopes.join(renderPart(PROVIDER_BADGE_SEPARATOR, false))}${valid.some((account) => account.stale) ? renderPart(" !", false) : ""}`,
	];
}

function renderUsageLine(
	state: ProviderUsageStoreState,
	targets: ProviderUsageTarget[],
	proxySnapshot: ProxySnapshotView | undefined,
	options: {
		activeOnly: boolean;
		activeFamilyOverride?: string;
		compact: boolean;
		activeProxy: boolean;
	},
	renderPart: (text: string, active: boolean) => string,
): string | undefined {
	const directBadges = directProviderUsageBadges(
		state,
		targets,
		options.activeOnly,
		options.activeFamilyOverride,
		proxySnapshot,
	).map(({ active, text }) => renderPart(text, active));
	const proxyBadges = renderProxyUsageBadges(
		state,
		targets,
		proxySnapshot,
		options,
		renderPart,
	);
	const parts = [...directBadges, ...proxyBadges];
	return parts.length > 0
		? parts.join(renderPart(PROVIDER_BADGE_SEPARATOR, false))
		: undefined;
}

export type ProviderUsageCliSnapshot = {
	text: string;
	directText: string;
	copilot?: CopilotUsageAccount;
	proxyAccounts: ProxyUsageAccount[];
};

export type ProviderUsageStore = {
	discoverTargetsAsync(
		ctx: ProviderUsageContext,
	): Promise<ProviderUsageTarget[]>;
	refresh(
		ctx: ProviderUsageContext,
		targets: ProviderUsageTarget[],
		onUpdate: () => void,
	): Promise<void>;
	render(
		targets: ProviderUsageTarget[],
		theme: ThemeLike,
		activeOnly: boolean,
		renderActive?: (text: string) => string,
		activeFamilyOverride?: string,
		activeProxy?: boolean,
	): string | undefined;
	cliSnapshot(targets: ProviderUsageTarget[]): ProviderUsageCliSnapshot;
	cachedPercentUsed(
		providerId: string,
		ctx: ProviderUsageContext,
	): number | undefined;
	invalidateDiscovery(): void;
};

export function createProviderUsageStore(
	options?: ProviderUsageStoreOptions,
): ProviderUsageStore {
	const state = createStoreState(options);
	return {
		discoverTargetsAsync(ctx) {
			return discoverProviderUsageTargetsAsyncInStore(state, ctx);
		},
		refresh(ctx, targets, onUpdate) {
			return refreshProviderUsageInStore(state, ctx, targets, onUpdate);
		},
		render(
			targets,
			theme,
			activeOnly,
			renderActive = (text) => theme.fg("dim", text),
			activeFamilyOverride,
			activeProxy = false,
		) {
			hydrateSharedCache(state);
			return renderUsageLine(
				state,
				targets,
				state.proxyStore.readSnapshot(),
				{ activeOnly, activeFamilyOverride, compact: false, activeProxy },
				(text, active) => (active ? renderActive(text) : theme.fg("dim", text)),
			);
		},
		cliSnapshot(targets) {
			hydrateSharedCache(state);
			const proxySnapshot = state.proxyStore.readSnapshot();
			const nonCopilotTargets = targets.filter(
				(target) => target.providerId !== "github-copilot",
			);
			return {
				text:
					renderUsageLine(
						state,
						targets,
						proxySnapshot,
						{ activeOnly: false, compact: true, activeProxy: false },
						(text) => text,
					) ?? "",
				directText: directProviderUsageBadges(
					state,
					nonCopilotTargets,
					false,
					undefined,
					proxySnapshot,
				)
					.map(({ text }) => text)
					.join(PROVIDER_BADGE_SEPARATOR),
				copilot: buildCopilotUsageAccount(state, targets),
				proxyAccounts: resolveProxyAccounts(state, targets, proxySnapshot),
			};
		},
		cachedPercentUsed(providerId, ctx) {
			return cachedProviderPercentUsedInStore(state, providerId, ctx);
		},
		invalidateDiscovery() {
			invalidateProviderUsageDiscoveryInStore(state);
		},
	};
}

export const defaultProviderUsageStore = createProviderUsageStore();
