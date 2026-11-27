import { createHash } from "node:crypto";
import {
	createProxyUsageStore,
	type ProxyRequestFn,
	type ProxyUsageStore,
} from "./cliproxy-usage";
import {
	extractOpenAiAccountId,
	fetchDirectProviderUsage,
	normalizeBaseUrl,
	parseCachedCopilotUsage,
} from "./provider-fetchers";
import {
	createSharedKeyedCache,
	isUsageCacheFresh,
	type SharedKeyedCache,
} from "./usage-cache";
import { isRecord, numericField, type ProviderUsageScope } from "./usage-quota";
import {
	buildProviderUsageCliSnapshot,
	type CopilotUsageDetails,
	compareProviderFamilies,
	LLMHUB_USAGE_PROVIDER_ID,
	type ProviderUsageAuthKind,
	type ProviderUsageCliSnapshot,
	type ProviderUsageRenderOptions,
	type ProviderUsageRenderSnapshot,
	type ProviderUsageState,
	renderProviderUsageLine,
} from "./usage-render";

export type {
	CopilotQuota,
	CopilotUsageAccount,
	CopilotUsageDetails,
	ProviderUsageCliSnapshot,
	ProviderUsageRenderOptions,
	ThemeLike,
} from "./usage-render";

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

export type { ProxyUsageAccount } from "./cliproxy-usage";
export type { ProviderUsageScope } from "./usage-quota";

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
const LITELLM_PROVIDER_ID = "litellm";
const OPENAI_USAGE_FAMILY = "openai";
const API_KEY_PROVIDER_IDS = new Set([
	"anthropic",
	OPENAI_USAGE_FAMILY,
	"openrouter",
	LLMHUB_USAGE_PROVIDER_ID,
]);
const USAGE_IGNORED_PROVIDER_IDS = new Set([LITELLM_PROVIDER_ID]);

type AvailableModelsCacheEntry = {
	models?: ModelLike[];
	pending?: Promise<void>;
	callbacks: Set<() => void>;
};

type ProviderUsageStoreState = {
	proxyStore: ProxyUsageStore;
	sharedCache: SharedKeyedCache<Map<string, ProviderUsageCacheEntry>>;
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
		sharedCache: createSharedKeyedCache({
			filename: "provider-usage.json",
			envOverride: "PI_PROVIDER_USAGE_CACHE_PATH",
			env: options?.env,
			parse: parseSharedCachePayload,
			serialize: serializeSharedCachePayload,
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

function parseSharedCachePayload(
	parsed: unknown,
): Map<string, ProviderUsageCacheEntry> {
	const entries = new Map<string, ProviderUsageCacheEntry>();
	if (!isRecord(parsed) || !isRecord(parsed.entries)) return entries;
	for (const [key, value] of Object.entries(parsed.entries)) {
		const entry = parseCacheEntry(value);
		if (!entry || !isProviderSupportedAuth(entry.providerId, entry.authKind)) {
			continue;
		}
		entries.set(key, entry);
	}
	return entries;
}

function serializeSharedCachePayload(
	merged: Map<string, ProviderUsageCacheEntry>,
): { entries: Record<string, unknown> } {
	return {
		entries: Object.fromEntries(
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
		),
	};
}

function mergeDiskEntriesIntoMemory(
	state: ProviderUsageStoreState,
	diskEntries: Map<string, ProviderUsageCacheEntry> | undefined,
): void {
	for (const [key, diskEntry] of diskEntries ?? []) {
		const memoryEntry = state.cache.get(key);
		if ((diskEntry.lastAttemptAt ?? 0) > (memoryEntry?.lastAttemptAt ?? 0)) {
			state.cache.set(key, diskEntry);
		}
	}
}

function hydrateSharedCache(state: ProviderUsageStoreState): void {
	const path = state.sharedCache.path();
	if (state.cachePath !== path) {
		state.cache.clear();
		state.resolvedCacheKeys.clear();
		state.proxyStore.pruneTargetLinks();
		state.resolutionIds.clear();
		state.cachePath = path;
	}
	mergeDiskEntriesIntoMemory(state, state.sharedCache.read());
}

function mergeMemoryEntriesForDisk(
	disk: Map<string, ProviderUsageCacheEntry> | undefined,
	entries: Iterable<[string, ProviderUsageCacheEntry]>,
): Map<string, ProviderUsageCacheEntry> {
	const merged = new Map(disk ?? []);
	for (const [key, memoryEntry] of entries) {
		const diskEntry = merged.get(key);
		if (
			!diskEntry ||
			(memoryEntry.lastAttemptAt ?? 0) >= (diskEntry.lastAttemptAt ?? 0)
		) {
			merged.set(key, memoryEntry);
		}
	}
	return merged;
}

function credentialFingerprint(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
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
	return compareProviderFamilies(providerFamily(a), providerFamily(b));
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
	if (normalized === "github-copilot")
		return cachedCopilotPercentUsed(state, ctx);
	if (normalized === "cliproxyapi") return state.proxyStore.cachedPercentUsed();
	return undefined;
}

function cachedCopilotPercentUsed(
	state: ProviderUsageStoreState,
	ctx: ProviderUsageContext,
): number | undefined {
	const credential = getStoredOAuthCredential(ctx, "github-copilot");
	const identity = credential?.refresh ?? credential?.access;
	if (!identity) return undefined;
	const key = credentialScopedKey(
		providerTargetKey("github-copilot", "oauth"),
		identity,
	);
	const quota = state.sharedCache.read()?.get(key)?.copilot?.premium;
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
		isLegacyCodexTarget(target) && token
			? extractOpenAiAccountId(token)
			: undefined;
	return {
		cacheKey,
		token,
		baseUrl,
		codexAccountId: accountId,
	};
}

async function fetchProviderUsage(
	fetchFn: typeof globalThis.fetch,
	target: ProviderUsageTarget,
	access: ResolvedProviderUsageAccess,
): Promise<ProviderUsageStatus> {
	const result = await fetchDirectProviderUsage(fetchFn, target, access);
	return {
		providerId: target.providerId,
		authKind: target.authKind,
		fetchedAt: Date.now(),
		...result,
	};
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
	const outcome = await state.sharedCache.runKeyedRefresh(
		credentialFingerprint(access.cacheKey),
		async (lease) => {
			// Another process may have refreshed while this process acquired the lease.
			const diskEntries = lease.read();
			const sameCachePath = state.cachePath === lease.path;
			if (sameCachePath) {
				mergeDiskEntriesIntoMemory(state, diskEntries);
			}
			const hydratedEntry = sameCachePath
				? state.cache.get(access.cacheKey)
				: diskEntries?.get(access.cacheKey);
			const advanced = (hydratedEntry?.lastAttemptAt ?? 0) > beforeAttemptAt;
			if (isUsageCacheFresh(hydratedEntry)) return sameCachePath && advanced;

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
			const stillSameCachePath = state.cachePath === lease.path;
			const sourceEntries: Iterable<[string, ProviderUsageCacheEntry]> =
				stillSameCachePath
					? [...state.cache.entries(), [access.cacheKey, entry]]
					: [[access.cacheKey, entry]];
			const persisted = await lease.update(
				(disk) => mergeMemoryEntriesForDisk(disk, sourceEntries),
				{ retries: 10 },
			);
			if (!persisted) {
				reportProviderUsageIssue(
					ctx,
					target,
					"failed to persist shared usage cache",
				);
			}
			if (state.cachePath === lease.path) {
				state.cache.set(access.cacheKey, entry);
				return true;
			}
			return false;
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
		if (isLegacyCodexTarget(target)) {
			const bindingChanged = state.proxyStore.setTargetLink(
				targetKey,
				access.codexAccountId
					? { kind: "codex", id: access.codexAccountId }
					: undefined,
			);
			mappingChanged ||= bindingChanged;
		}
	}

	if (isLegacyCodexTarget(target)) {
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

	const refreshKey = `${state.sharedCache.path()}\0${access.cacheKey}`;
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

function isNativeOpenAiTarget(
	target: Pick<ProviderUsageTarget, "providerId" | "authKind">,
): boolean {
	return target.providerId === "openai" && target.authKind === "oauth";
}

function isLegacyCodexTarget(
	target: Pick<ProviderUsageTarget, "providerId" | "authKind">,
): boolean {
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
	const nativeTargets = targets.filter(isNativeOpenAiTarget);
	const proxyRefresh = Promise.all(
		nativeTargets.map((target) =>
			refreshNativeOpenAiBinding(state, ctx, target, onUpdate),
		),
	).then(() =>
		state.proxyStore.refreshSnapshot(
			onUpdate,
			state.proxyStore.hasNativeTargetLink()
				? "native"
				: targets.some(isLegacyCodexTarget)
					? "codex"
					: undefined,
		),
	);
	return Promise.all([
		proxyRefresh,
		...targets
			.filter(
				(target) =>
					!isNativeOpenAiTarget(target) &&
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

function buildRenderSnapshot(
	state: ProviderUsageStoreState,
	targets: ProviderUsageTarget[],
): ProviderUsageRenderSnapshot {
	hydrateSharedCache(state);
	return {
		targets: targets.map((target) => ({
			...target,
			family: providerFamily(target.providerId),
			targetKey: providerTargetKey(target.providerId, target.authKind),
			supported: isProviderSupportedAuth(target.providerId, target.authKind),
			proxyOnly: isNativeOpenAiTarget(target),
			proxyFallback: isLegacyCodexTarget(target),
			status: state.cache.get(
				providerCacheKey(state, target.providerId, target.authKind),
			),
		})),
		proxySnapshot: state.proxyStore.readSnapshot(),
	};
}

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
		options: ProviderUsageRenderOptions,
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
		render(targets, renderOptions) {
			return renderProviderUsageLine(
				buildRenderSnapshot(state, targets),
				renderOptions,
			);
		},
		cliSnapshot(targets) {
			return buildProviderUsageCliSnapshot(buildRenderSnapshot(state, targets));
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
