import { createHash } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import type {
	AuthCredentialLike,
	ModelLike,
	ModelRegistryLike,
	ProviderUsageContext,
} from "./pi-types";

const PROVIDER_USAGE_TTL_MS = 5 * 60 * 1000;
const PROVIDER_USAGE_FAILURE_TTL_MS = 60 * 1000;
const PROVIDER_USAGE_CACHE_VERSION = 5;
const PROVIDER_USAGE_FETCH_TIMEOUT_MS = 5000;
const PROVIDER_USAGE_REFRESH_LOCK_STALE_MS = 20 * 1000;
const PROVIDER_USAGE_REFRESH_LOCK_UPDATE_MS = 5 * 1000;
const PROVIDER_USAGE_REFRESH_RETRY_MS = 100;
const PROVIDER_USAGE_REFRESH_RETRIES = 550;
const PROVIDER_USAGE_FETCH_MAX_ATTEMPTS = 3;
const PROVIDER_USAGE_TRANSIENT_RETRY_BASE_MS = 50;
const PROVIDER_USAGE_THROTTLE_RETRY_BASE_MS = 1000;
const PROVIDER_USAGE_RETRY_MAX_DELAY_MS = 20_000;
const PROVIDER_BADGE_SEPARATOR = " · ";
const GITHUB_LOGO = "\uF09B";
const GOOGLE_LOGO = "\u{F02AD}";

type ThemeLike = {
	fg(color: string, text: string): string;
};

type ProviderUsageAuthKind = "oauth" | "api_key" | "unknown";
type ProviderUsageState = "ready" | "unknown" | "error" | "unsupported";

export type ProviderUsageScope = {
	sessionPercentUsed?: number;
	weeklyPercentUsed?: number;
	monthlyPercentUsed?: number;
	percentUsed?: number;
	balanceUsd?: number;
	creditsUsd?: number;
	spendUsd?: number;
};

export type ProviderUsageStatus = {
	providerId: string;
	authKind: ProviderUsageAuthKind;
	state: ProviderUsageState;
	scope?: ProviderUsageScope;
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
	"openai-codex",
	"github-copilot",
	"google-gemini-cli",
	"google-antigravity",
]);
const API_KEY_PROVIDER_IDS = new Set(["anthropic", "openai", "openrouter"]);
const USAGE_IGNORED_PROVIDER_IDS = new Set(["google-vertex", "litellm"]);
const LLMHUB_USAGE_PROVIDER_ID = "llmhub";
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

const providerUsageCache = new Map<string, ProviderUsageCacheEntry>();
const providerUsageRefreshes = new Map<string, Promise<void>>();
const providerUsageResolvedCacheKeys = new Map<string, string>();
let providerUsageCachePath: string | undefined;
let availableModelsCache = new WeakMap<
	ModelRegistryLike,
	AvailableModelsCacheEntry
>();
let providerUsageInvalidation = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

type LlmHubCredentials = {
	baseUrl: string;
	token: string;
};

function readLlmHubCredentials(): LlmHubCredentials | undefined {
	const claudeConfigDir =
		process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
	try {
		const settings: unknown = JSON.parse(
			readFileSync(join(claudeConfigDir, "settings.json"), "utf8"),
		);
		if (!isRecord(settings) || !isRecord(settings.env)) return undefined;

		const baseUrl = settings.env.ANTHROPIC_BASE_URL;
		const token =
			settings.env.ANTHROPIC_AUTH_TOKEN ?? settings.env.ANTHROPIC_API_KEY;
		if (typeof baseUrl !== "string" || typeof token !== "string") {
			return undefined;
		}

		const normalizedBaseUrl = baseUrl.trim();
		const normalizedToken = token.trim();
		return normalizedBaseUrl && normalizedToken
			? { baseUrl: normalizedBaseUrl, token: normalizedToken }
			: undefined;
	} catch {
		return undefined;
	}
}

function sharedCachePath(): string {
	return (
		process.env.PI_PROVIDER_USAGE_CACHE_PATH ??
		join(
			process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
			"pi",
			"provider-usage.json",
		)
	);
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
		weeklyPercentUsed:
			typeof value.weeklyPercentUsed === "number"
				? value.weeklyPercentUsed
				: undefined,
		monthlyPercentUsed:
			typeof value.monthlyPercentUsed === "number"
				? value.monthlyPercentUsed
				: undefined,
		percentUsed:
			typeof value.percentUsed === "number" ? value.percentUsed : undefined,
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
		fetchedAt:
			typeof value.fetchedAt === "number" ? value.fetchedAt : undefined,
		lastAttemptAt:
			typeof value.lastAttemptAt === "number" ? value.lastAttemptAt : undefined,
	};
}

function readSharedCache(): Map<string, ProviderUsageCacheEntry> {
	const entries = new Map<string, ProviderUsageCacheEntry>();
	try {
		const parsed: unknown = JSON.parse(readFileSync(sharedCachePath(), "utf8"));
		if (!isRecord(parsed) || parsed.version !== PROVIDER_USAGE_CACHE_VERSION) {
			return entries;
		}
		if (!isRecord(parsed.entries)) return entries;
		for (const [key, value] of Object.entries(parsed.entries)) {
			const entry = parseCacheEntry(value);
			if (entry) entries.set(key, entry);
		}
	} catch {
		// A missing or malformed cache is equivalent to an empty cache.
	}
	return entries;
}

function hydrateSharedCache(): void {
	const path = sharedCachePath();
	if (providerUsageCachePath !== path) {
		providerUsageCache.clear();
		providerUsageResolvedCacheKeys.clear();
		providerUsageCachePath = path;
	}
	for (const [key, diskEntry] of readSharedCache()) {
		const memoryEntry = providerUsageCache.get(key);
		if ((diskEntry.lastAttemptAt ?? 0) > (memoryEntry?.lastAttemptAt ?? 0)) {
			providerUsageCache.set(key, diskEntry);
		}
	}
}

async function persistSharedCache(): Promise<void> {
	const path = sharedCachePath();
	mkdirSync(dirname(path), { recursive: true });

	let lease: ProviderRefreshLease;
	try {
		lease = await acquireSharedFileLease(path, 10);
	} catch {
		return;
	}

	const temporaryPath = `${path}.${process.pid}.tmp`;
	try {
		lease.assertOwned();
		const merged = readSharedCache();
		for (const [key, memoryEntry] of providerUsageCache) {
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
					fetchedAt: entry.fetchedAt,
					lastAttemptAt: entry.lastAttemptAt,
				},
			]),
		);
		writeFileSync(
			temporaryPath,
			`${JSON.stringify({ version: PROVIDER_USAGE_CACHE_VERSION, entries })}\n`,
			{ mode: 0o600 },
		);
		lease.assertOwned();
		renameSync(temporaryPath, path);
	} catch {
		try {
			unlinkSync(temporaryPath);
		} catch {
			// Best-effort cache writes must not affect the statusline.
		}
	} finally {
		try {
			await lease.release();
		} catch {
			// A compromised lease is already reported by the refresh owner.
		}
	}
}

function cacheEntryTtlMs(entry: ProviderUsageCacheEntry): number {
	return entry.state === "error" || entry.state === "unknown"
		? PROVIDER_USAGE_FAILURE_TTL_MS
		: PROVIDER_USAGE_TTL_MS;
}

function isCacheEntryFresh(
	entry: ProviderUsageCacheEntry | undefined,
	now = Date.now(),
): boolean {
	return Boolean(
		entry?.lastAttemptAt && now - entry.lastAttemptAt < cacheEntryTtlMs(entry),
	);
}

function credentialFingerprint(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function providerRefreshLeasePath(cacheKey: string): string {
	return `${sharedCachePath()}.refresh-${credentialFingerprint(cacheKey)}`;
}

type ProviderRefreshLease = {
	assertOwned(): void;
	release(): Promise<void>;
};

async function acquireSharedFileLease(
	lockPath: string,
	retries = PROVIDER_USAGE_REFRESH_RETRIES,
): Promise<ProviderRefreshLease> {
	mkdirSync(dirname(lockPath), { recursive: true });
	let compromisedError: Error | undefined;
	const release = await lockfile.lock(lockPath, {
		realpath: false,
		stale: PROVIDER_USAGE_REFRESH_LOCK_STALE_MS,
		update: PROVIDER_USAGE_REFRESH_LOCK_UPDATE_MS,
		retries: {
			retries,
			factor: 1,
			minTimeout: PROVIDER_USAGE_REFRESH_RETRY_MS,
			maxTimeout: PROVIDER_USAGE_REFRESH_RETRY_MS,
		},
		onCompromised: (error) => {
			compromisedError = error;
		},
	});
	return {
		assertOwned() {
			if (compromisedError) throw compromisedError;
		},
		release,
	};
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
	if (normalized === "openai-codex" || normalized === "openai") {
		return "openai";
	}
	return normalized;
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

function providerCacheKey(
	providerId: string,
	authKind: ProviderUsageAuthKind,
): string {
	const targetKey = providerTargetKey(providerId, authKind);
	return providerUsageResolvedCacheKeys.get(targetKey) ?? targetKey;
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
	includeUnsupported = false,
): void {
	if (!providerId) return;
	const normalized = normalizeProviderId(providerId);
	if (!normalized || USAGE_IGNORED_PROVIDER_IDS.has(normalized)) return;
	if (!includeUnsupported && !isProviderSupportedAuth(normalized, authKind)) {
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
	return providerId && API_KEY_PROVIDER_IDS.has(providerId)
		? "api_key"
		: undefined;
}

function getConfiguredModels(
	ctx: ProviderUsageContext,
	onUpdate?: () => void,
): ModelLike[] {
	const registry = ctx.modelRegistry;
	if (!registry) return [];

	const cached = availableModelsCache.get(registry);
	if (cached?.models) return cached.models;
	if (cached?.pending) {
		if (onUpdate) cached.callbacks.add(onUpdate);
		return [];
	}

	const available = registry.getAvailable?.();
	if (Array.isArray(available)) {
		availableModelsCache.set(registry, {
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
				availableModelsCache.delete(registry);
			})
			.finally(() => {
				entry.pending = undefined;
				for (const callback of entry.callbacks) callback();
				entry.callbacks.clear();
			});
		availableModelsCache.set(registry, entry);
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

export async function discoverProviderUsageTargetsAsync(
	ctx: ProviderUsageContext,
): Promise<ProviderUsageTarget[]> {
	const registry = ctx.modelRegistry;
	const available = registry?.getAvailable?.();
	if (registry && available) {
		try {
			availableModelsCache.set(registry, {
				models: Array.isArray(available) ? available : await available,
				callbacks: new Set(),
			});
		} catch {
			// Discovery still falls back to configured models and auth storage.
		}
	}
	return discoverProviderUsageTargets(ctx);
}

export function discoverProviderUsageTargets(
	ctx: ProviderUsageContext,
): ProviderUsageTarget[] {
	const activeProviderId = ctx.model?.provider
		? normalizeProviderId(ctx.model.provider)
		: undefined;
	const activeAuthKind = ctx.model ? modelAuthKind(ctx, ctx.model) : undefined;
	const candidates: ProviderUsageTarget[] = [];

	if (readLlmHubCredentials()) {
		addProviderCandidate(
			candidates,
			LLMHUB_USAGE_PROVIDER_ID,
			"api_key",
			activeProviderId,
			true,
		);
	}

	if (activeProviderId && activeAuthKind) {
		addProviderCandidate(
			candidates,
			activeProviderId,
			activeAuthKind,
			activeProviderId,
			true,
		);
	} else if (activeProviderId) {
		let addedActiveProvider = false;
		if (OAUTH_PROVIDER_IDS.has(activeProviderId)) {
			addProviderCandidate(
				candidates,
				activeProviderId,
				"oauth",
				activeProviderId,
			);
			addedActiveProvider = true;
		}
		if (API_KEY_PROVIDER_IDS.has(activeProviderId)) {
			addProviderCandidate(
				candidates,
				activeProviderId,
				"api_key",
				activeProviderId,
			);
			addedActiveProvider = true;
		}
		if (!addedActiveProvider) {
			addProviderCandidate(
				candidates,
				activeProviderId,
				"unknown",
				activeProviderId,
				true,
			);
		}
	}

	for (const model of getConfiguredModels(ctx)) {
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
		const authStatus = ctx.modelRegistry?.getProviderAuthStatus?.(providerId);
		if (authStatus?.configured) {
			addProviderCandidate(candidates, providerId, "api_key", activeProviderId);
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
	return ctx.modelRegistry?.getApiKeyForProvider?.(providerId);
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
	const credential = getStoredOAuthCredential(ctx, providerId);
	return credential?.access ?? (await getProviderToken(ctx, providerId));
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
	llmHubCredentials?: LlmHubCredentials;
};

async function resolveProviderUsageAccess(
	ctx: ProviderUsageContext,
	target: ProviderUsageTarget,
): Promise<ResolvedProviderUsageAccess> {
	const targetKey = providerTargetKey(target.providerId, target.authKind);
	let token: string | undefined;
	let llmHubCredentials: LlmHubCredentials | undefined;
	let credentialIdentity: string | undefined;

	if (target.providerId === LLMHUB_USAGE_PROVIDER_ID) {
		llmHubCredentials = readLlmHubCredentials();
		if (llmHubCredentials) {
			credentialIdentity = `${normalizeBaseUrl(llmHubCredentials.baseUrl)}\0${llmHubCredentials.token}`;
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
		? `${targetKey}:${credentialFingerprint(`${targetKey}\0${credentialIdentity}`)}`
		: targetKey;
	providerUsageResolvedCacheKeys.set(targetKey, cacheKey);
	return { cacheKey, token, llmHubCredentials };
}

function normalizeBaseUrl(url: string): string {
	return url.trim().replace(/\/+$/, "");
}

function numericField(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string") return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function nestedRecord(
	value: Record<string, unknown>,
	key: string,
): Record<string, unknown> | undefined {
	const child = value[key];
	return isRecord(child) ? child : undefined;
}

const RETRYABLE_PROVIDER_USAGE_STATUS_CODES = new Set([
	408, 429, 500, 502, 503, 504,
]);

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

function providerUsageRetryDelayMs(retry: number, status?: number): number {
	const baseDelay =
		status === 429
			? PROVIDER_USAGE_THROTTLE_RETRY_BASE_MS
			: PROVIDER_USAGE_TRANSIENT_RETRY_BASE_MS;
	const backoff = Math.min(
		PROVIDER_USAGE_RETRY_MAX_DELAY_MS,
		baseDelay * 2 ** retry,
	);
	return Math.random() * backoff;
}

async function waitForRetry(delayMs: number): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

async function fetchProviderUsageResponse(
	url: string,
	init: RequestInit,
): Promise<Response> {
	for (
		let attempt = 0;
		attempt < PROVIDER_USAGE_FETCH_MAX_ATTEMPTS;
		attempt++
	) {
		try {
			const response = await fetch(url, {
				...init,
				signal: AbortSignal.timeout(PROVIDER_USAGE_FETCH_TIMEOUT_MS),
			});
			const canRetry =
				attempt < PROVIDER_USAGE_FETCH_MAX_ATTEMPTS - 1 &&
				RETRYABLE_PROVIDER_USAGE_STATUS_CODES.has(response.status);
			if (!canRetry) return response;

			const serverDelay = retryAfterMs(response);
			if (serverDelay !== undefined) {
				if (serverDelay > PROVIDER_USAGE_RETRY_MAX_DELAY_MS) return response;
				await waitForRetry(serverDelay);
			} else {
				await waitForRetry(providerUsageRetryDelayMs(attempt, response.status));
			}
		} catch (error) {
			if (attempt === PROVIDER_USAGE_FETCH_MAX_ATTEMPTS - 1) throw error;
			await waitForRetry(providerUsageRetryDelayMs(attempt));
		}
	}

	throw new Error("Provider usage retry attempts exhausted");
}

async function fetchJson(
	url: string,
	init: RequestInit,
): Promise<unknown | undefined> {
	const response = await fetchProviderUsageResponse(url, init);
	if (!response.ok) return undefined;
	return response.json();
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}

function parseUtilization(value: unknown): number | undefined {
	const numeric = numericField(value);
	return numeric === undefined ? undefined : clampPercent(numeric);
}

async function fetchOpenRouterKeyStatus(
	token: string,
): Promise<ProviderUsageScope | undefined> {
	const body = await fetchJson("https://openrouter.ai/api/v1/key", {
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
	token: string,
): Promise<ProviderUsageScope | undefined> {
	const body = await fetchJson("https://openrouter.ai/api/v1/credits", {
		headers: { Authorization: `Bearer ${token}` },
	});
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
	baseUrl: string,
	token: string,
): Promise<ProviderUsageScope | undefined> {
	const response = await fetchProviderUsageResponse(
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
	token: string,
): Promise<ProviderUsageScope | undefined> {
	const body = await fetchJson("https://api.anthropic.com/api/oauth/usage", {
		headers: {
			Authorization: `Bearer ${token}`,
			"anthropic-beta": "oauth-2025-04-20",
			"anthropic-version": "2023-06-01",
			"User-Agent": "pi-statusline",
		},
	});
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

type OpenAiUsageWindowKind = "session" | "weekly";

function openAiWindowPercent(
	window: Record<string, unknown> | undefined,
): number | undefined {
	return window
		? parseUtilization(
				window.used_percent ?? window.used_percentage ?? window.utilization,
			)
		: undefined;
}

function openAiWindowKind(
	window: Record<string, unknown> | undefined,
	fallback: OpenAiUsageWindowKind,
): OpenAiUsageWindowKind {
	const durationSeconds = window
		? numericField(window.limit_window_seconds)
		: undefined;
	if (durationSeconds === undefined) return fallback;

	const daySeconds = 24 * 60 * 60;
	return durationSeconds >= 6 * daySeconds ? "weekly" : "session";
}

function parseOpenAiUsageBody(body: unknown): ProviderUsageScope | undefined {
	if (!isRecord(body)) return undefined;

	const rateLimit = nestedRecord(body, "rate_limit");
	const primary = rateLimit
		? nestedRecord(rateLimit, "primary_window")
		: undefined;
	const secondary = rateLimit
		? nestedRecord(rateLimit, "secondary_window")
		: undefined;
	const credits = nestedRecord(body, "credits");
	let sessionPercentUsed: number | undefined;
	let weeklyPercentUsed: number | undefined;
	for (const [window, fallbackKind] of [
		[primary, "session"],
		[secondary, "weekly"],
	] satisfies [Record<string, unknown> | undefined, OpenAiUsageWindowKind][]) {
		const percentUsed = openAiWindowPercent(window);
		if (percentUsed === undefined) continue;
		if (openAiWindowKind(window, fallbackKind) === "weekly") {
			weeklyPercentUsed = Math.max(weeklyPercentUsed ?? 0, percentUsed);
		} else {
			sessionPercentUsed = Math.max(sessionPercentUsed ?? 0, percentUsed);
		}
	}
	const balanceUsd =
		credits?.has_credits === true
			? numericField(
					credits.balance ?? credits.remaining ?? credits.remaining_credits,
				)
			: undefined;

	return sessionPercentUsed !== undefined ||
		weeklyPercentUsed !== undefined ||
		balanceUsd !== undefined
		? { sessionPercentUsed, weeklyPercentUsed, balanceUsd }
		: undefined;
}

async function fetchOpenAiCodexUsage(
	token: string,
): Promise<ProviderUsageScope | undefined> {
	const accountId = extractOpenAiAccountId(token);
	const headers: Record<string, string> = {
		Authorization: `Bearer ${token}`,
		Accept: "application/json",
		"User-Agent": "pi-statusline",
	};
	if (accountId) headers["chatgpt-account-id"] = accountId;

	const body = await fetchJson("https://chatgpt.com/backend-api/wham/usage", {
		headers,
	});
	return parseOpenAiUsageBody(body);
}

function quotaSnapshotPercentUsed(value: unknown): number | undefined {
	if (!isRecord(value)) return undefined;
	const used = numericField(
		value.percent_used ?? value.used_percent ?? value.usedPercentage,
	);
	if (used !== undefined) return used;

	const remaining = numericField(
		value.percent_remaining ??
			value.remaining_percent ??
			value.remainingPercentage,
	);
	return remaining !== undefined ? 100 - remaining : undefined;
}

async function fetchGitHubCopilotUsage(
	token: string,
): Promise<ProviderUsageScope | undefined> {
	const body = await fetchJson("https://api.github.com/copilot_internal/user", {
		headers: {
			Authorization: `token ${token}`,
			Accept: "application/json",
			"Editor-Version": "vscode/1.96.2",
			"Editor-Plugin-Version": "copilot-chat/0.26.7",
			"User-Agent": "GitHubCopilotChat/0.26.7",
			"X-GitHub-Api-Version": "2025-04-01",
		},
	});
	if (!isRecord(body)) return undefined;

	const snapshots =
		nestedRecord(body, "quotaSnapshots") ??
		nestedRecord(body, "quota_snapshots");
	const premium = snapshots
		? (nestedRecord(snapshots, "premiumInteractions") ??
			nestedRecord(snapshots, "premium_interactions"))
		: undefined;
	const percentUsed = quotaSnapshotPercentUsed(premium);

	return percentUsed !== undefined
		? { monthlyPercentUsed: percentUsed }
		: undefined;
}

function parseGoogleOAuthToken(
	value: string,
): { token: string; projectId: string } | undefined {
	try {
		const parsed: unknown = JSON.parse(value);
		if (!isRecord(parsed)) return undefined;
		const token = parsed.token ?? parsed.access;
		const projectId = parsed.projectId ?? parsed.project;
		return typeof token === "string" &&
			token &&
			typeof projectId === "string" &&
			projectId
			? { token, projectId }
			: undefined;
	} catch {
		return undefined;
	}
}

async function fetchGoogleCloudQuota(credential: {
	token: string;
	projectId: string;
}): Promise<ProviderUsageScope | undefined> {
	const body = await fetchJson(
		"https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${credential.token}`,
				"Content-Type": "application/json",
				"User-Agent": "pi-statusline",
			},
			body: JSON.stringify({ project: credential.projectId }),
		},
	);
	if (!isRecord(body) || !Array.isArray(body.buckets)) return undefined;

	const usedPercents = body.buckets
		.map((bucket) => {
			if (!isRecord(bucket)) return undefined;
			const remainingFraction = numericField(bucket.remainingFraction);
			if (remainingFraction !== undefined) {
				return clampPercent((1 - remainingFraction) * 100);
			}
			const percentUsed = numericField(
				bucket.usedPercent ?? bucket.used_percentage ?? bucket.utilization,
			);
			return percentUsed !== undefined
				? parseUtilization(percentUsed)
				: undefined;
		})
		.filter((value): value is number => value !== undefined);

	return usedPercents.length > 0
		? { percentUsed: Math.max(...usedPercents) }
		: undefined;
}

async function fetchProviderUsage(
	target: ProviderUsageTarget,
	access: ResolvedProviderUsageAccess,
): Promise<ProviderUsageStatus> {
	const statusBase = {
		providerId: target.providerId,
		authKind: target.authKind,
		fetchedAt: Date.now(),
	};

	if (target.authKind === "oauth") {
		let scope: ProviderUsageScope | undefined;
		if (target.providerId === "github-copilot") {
			scope = access.token
				? await fetchGitHubCopilotUsage(access.token)
				: undefined;
		} else {
			if (!access.token) return { ...statusBase, state: "unknown" };
			const token = access.token;

			if (target.providerId === "anthropic") {
				scope = await fetchAnthropicOAuthUsage(token);
			} else if (target.providerId === "openai-codex") {
				scope = await fetchOpenAiCodexUsage(token);
			} else if (
				target.providerId === "google-gemini-cli" ||
				target.providerId === "google-antigravity"
			) {
				const googleCredential = parseGoogleOAuthToken(token);
				scope = googleCredential
					? await fetchGoogleCloudQuota(googleCredential)
					: undefined;
			} else {
				return { ...statusBase, state: "unsupported" };
			}
		}

		return scope
			? { ...statusBase, state: "ready", scope }
			: { ...statusBase, state: "unknown" };
	}

	if (
		target.providerId === LLMHUB_USAGE_PROVIDER_ID &&
		target.authKind === "api_key"
	) {
		const credentials = access.llmHubCredentials;
		if (!credentials) return { ...statusBase, state: "unknown" };

		const scope = await fetchLlmHubSpend(
			credentials.baseUrl,
			credentials.token,
		);
		return scope
			? { ...statusBase, state: "ready", scope }
			: { ...statusBase, state: "unknown" };
	}

	if (target.providerId === "openrouter" && target.authKind === "api_key") {
		if (!access.token) return { ...statusBase, state: "unknown" };

		const scope =
			(await fetchOpenRouterKeyStatus(access.token).catch(() => undefined)) ??
			(await fetchOpenRouterCredits(access.token).catch(() => undefined));
		return scope
			? { ...statusBase, state: "ready", scope }
			: { ...statusBase, state: "unknown" };
	}

	return { ...statusBase, state: "unsupported" };
}

export function invalidateProviderUsageCache(): void {
	providerUsageInvalidation++;
	providerUsageCache.clear();
	providerUsageRefreshes.clear();
	providerUsageResolvedCacheKeys.clear();
	providerUsageCachePath = undefined;
	try {
		unlinkSync(sharedCachePath());
	} catch {
		// The cache may not exist.
	}
	invalidateProviderUsageDiscovery();
}

export function invalidateProviderUsageDiscovery(): void {
	availableModelsCache = new WeakMap<
		ModelRegistryLike,
		AvailableModelsCacheEntry
	>();
}

function reportProviderUsageIssue(
	ctx: ProviderUsageContext,
	target: ProviderUsageTarget,
	message: string,
): void {
	ctx.reportError?.(`Provider usage (${target.providerId}): ${message}`);
}

async function refreshProviderUsageTarget(
	ctx: ProviderUsageContext,
	target: ProviderUsageTarget,
	access: ResolvedProviderUsageAccess,
	fetchId: number,
): Promise<void> {
	let lease: ProviderRefreshLease;
	try {
		lease = await acquireSharedFileLease(
			providerRefreshLeasePath(access.cacheKey),
		);
	} catch {
		hydrateSharedCache();
		if (!isCacheEntryFresh(providerUsageCache.get(access.cacheKey))) {
			reportProviderUsageIssue(
				ctx,
				target,
				"timed out waiting for another process",
			);
		}
		return;
	}

	try {
		lease.assertOwned();
		// Another process may have refreshed while this process acquired the lease.
		hydrateSharedCache();
		if (isCacheEntryFresh(providerUsageCache.get(access.cacheKey))) return;

		const attemptedAt = Date.now();
		let entry: ProviderUsageCacheEntry;
		try {
			const status = await fetchProviderUsage(target, access);
			entry = { ...status, lastAttemptAt: attemptedAt };
			if (status.state === "unknown") {
				reportProviderUsageIssue(
					ctx,
					target,
					"provider returned no usage data",
				);
			}
		} catch (error) {
			entry = {
				providerId: target.providerId,
				authKind: target.authKind,
				state: "error",
				fetchedAt: Date.now(),
				lastAttemptAt: attemptedAt,
			};
			reportProviderUsageIssue(
				ctx,
				target,
				error instanceof Error ? error.message : String(error),
			);
		}

		lease.assertOwned();
		if (fetchId !== providerUsageInvalidation) return;
		providerUsageCache.set(access.cacheKey, entry);
		await persistSharedCache();
	} catch (error) {
		reportProviderUsageIssue(
			ctx,
			target,
			`refresh lease was compromised: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		try {
			await lease.release();
		} catch (error) {
			reportProviderUsageIssue(
				ctx,
				target,
				`failed to release refresh lease: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}

async function queueProviderUsageRefresh(
	ctx: ProviderUsageContext,
	target: ProviderUsageTarget,
	fetchId: number,
	onUpdate: () => void,
): Promise<void> {
	// Initialize the cache path before resolving the process-local cache-key map.
	hydrateSharedCache();
	let access: ResolvedProviderUsageAccess;
	try {
		access = await resolveProviderUsageAccess(ctx, target);
	} catch (error) {
		reportProviderUsageIssue(
			ctx,
			target,
			error instanceof Error ? error.message : String(error),
		);
		if (fetchId === providerUsageInvalidation) onUpdate();
		return;
	}

	hydrateSharedCache();
	const refreshKey = `${sharedCachePath()}\0${access.cacheKey}`;
	const existing = providerUsageRefreshes.get(refreshKey);
	if (existing) {
		await existing;
		if (fetchId === providerUsageInvalidation) onUpdate();
		return;
	}

	const pending = refreshProviderUsageTarget(
		ctx,
		target,
		access,
		fetchId,
	).finally(() => {
		if (providerUsageRefreshes.get(refreshKey) === pending) {
			providerUsageRefreshes.delete(refreshKey);
		}
	});
	providerUsageRefreshes.set(refreshKey, pending);
	await pending;
	if (fetchId === providerUsageInvalidation) onUpdate();
}

export function refreshProviderUsage(
	ctx: ProviderUsageContext,
	targets: ProviderUsageTarget[],
	onUpdate: () => void,
): Promise<void> {
	getConfiguredModels(ctx, onUpdate);
	const fetchId = providerUsageInvalidation;
	return Promise.all(
		targets.map((target) =>
			queueProviderUsageRefresh(ctx, target, fetchId, onUpdate),
		),
	).then(() => undefined);
}

function providerDisplayLabel(providerId: string): string {
	switch (providerFamily(providerId)) {
		case LLMHUB_USAGE_PROVIDER_ID:
			return "LLMHub";
		case "anthropic":
			return "Anthropic";
		case "openai":
			return "OpenAI";
		case "openrouter":
			return "OpenRouter";
		case "github-copilot":
			return GITHUB_LOGO;
		case "google-gemini-cli":
		case "google-antigravity":
			return GOOGLE_LOGO;
		default:
			return providerId;
	}
}

function formatPercentValue(percent: number): string {
	return Math.round(percent).toString();
}

function formatPercent(percent: number): string {
	return `${formatPercentValue(percent)}%`;
}

function formatMoney(value: number): string {
	return `$${value.toFixed(2)}`;
}

function formatLabeledPercent(label: string, percent: number): string {
	return `${label}${formatPercent(percent)}`;
}

function formatProviderScope(
	scope: ProviderUsageScope | undefined,
): string | undefined {
	if (!scope) return undefined;
	const percentages = [
		{ label: "S", value: scope.sessionPercentUsed },
		{ label: "W", value: scope.weeklyPercentUsed },
		{ label: "M", value: scope.monthlyPercentUsed },
		{ value: scope.percentUsed },
	].filter(
		(entry): entry is { label?: string; value: number } =>
			entry.value !== undefined,
	);
	if (percentages.length > 0) {
		const showScopeLabels = percentages.length > 1;
		return percentages
			.map(({ label, value }) =>
				showScopeLabels && label
					? formatLabeledPercent(label, value)
					: formatPercent(value),
			)
			.join("/");
	}
	if (scope.balanceUsd !== undefined) return formatMoney(scope.balanceUsd);
	if (scope.creditsUsd !== undefined) return formatMoney(scope.creditsUsd);
	if (scope.spendUsd !== undefined) return formatMoney(scope.spendUsd);
	return undefined;
}

function providerUsageLabelsForTarget(target: ProviderUsageTarget): string[] {
	const status = providerUsageCache.get(
		providerCacheKey(target.providerId, target.authKind),
	);
	const scopeText =
		status?.state === "ready" ? formatProviderScope(status.scope) : undefined;
	if (!scopeText && !target.active) return [];
	return [`${providerDisplayLabel(target.providerId)} ${scopeText ?? "?"}`];
}

export function formatProviderUsage(
	targets: ProviderUsageTarget[],
	activeOnly = false,
): string | undefined {
	hydrateSharedCache();
	const labels = targets
		.filter((target) => !activeOnly || target.active)
		.sort((a, b) => compareProviderIds(a.providerId, b.providerId))
		.flatMap(providerUsageLabelsForTarget);
	return labels.length > 0 ? labels.join(PROVIDER_BADGE_SEPARATOR) : undefined;
}

export function renderProviderUsage(
	targets: ProviderUsageTarget[],
	theme: ThemeLike,
	activeOnly: boolean,
): string | undefined {
	const text = formatProviderUsage(targets, activeOnly);
	return text ? theme.fg("dim", text) : undefined;
}
