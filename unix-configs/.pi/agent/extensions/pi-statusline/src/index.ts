import { spawn } from "node:child_process";

type Theme = {
	fg(color: string, text: string): string;
};

type ReadonlyFooterDataProvider = {
	getGitBranch(): string | null;
	onBranchChange(callback: () => void): () => void;
};

type TuiLike = {
	requestRender?: () => void;
};

type ModelLike = {
	name?: string;
	id?: string;
	contextWindow?: number;
	provider?: string;
	api?: string;
	baseUrl?: string;
};

type AuthCredentialLike =
	| {
			type: "oauth";
			access?: string;
			refresh?: string;
	  }
	| { type: "api_key" };

type AuthStorageLike = {
	get?(provider: string): AuthCredentialLike | undefined;
	list?(): string[];
	hasAuth?(provider: string): boolean;
	getOAuthProviders?(): { id: string; name?: string }[];
};

type ModelRegistryLike = {
	getAll?(): ModelLike[];
	getAvailable?(): ModelLike[];
	hasConfiguredAuth?(model: ModelLike): boolean;
	getProviderAuthStatus?(provider: string): {
		configured: boolean;
		source?: string;
		label?: string;
	};
	getProviderDisplayName?(provider: string): string;
	getApiKeyForProvider?(provider: string): Promise<string | undefined>;
	isUsingOAuth?(model: ModelLike): boolean;
	authStorage?: AuthStorageLike;
};

type ExtensionContext = {
	hasUI: boolean;
	ui: {
		setFooter(
			factory:
				| ((
						tui: TuiLike,
						theme: Theme,
						footerData: ReadonlyFooterDataProvider,
				  ) => {
						dispose?(): void;
						invalidate?(): void;
						render(width?: number): string[];
				  })
				| undefined,
		): void;
		setWidget(
			key: string,
			factory:
				| ((
						tui: TuiLike,
						theme: Theme,
				  ) => {
						dispose?(): void;
						invalidate?(): void;
						render(width: number): string[];
				  })
				| undefined,
			options?: { placement?: "aboveEditor" | "belowEditor" },
		): void;
	};
	sessionManager?: {
		getBranch?(): unknown[];
	};
	model?: ModelLike;
	modelRegistry?: ModelRegistryLike;
	settingsManager?: {
		getCompactionSettings?(): { enabled?: boolean } | undefined;
	};
	getContextUsage?():
		| {
				tokens: number | null;
				contextWindow: number;
				percent: number | null;
		  }
		| undefined;
};

type AfterProviderResponseEvent = {
	status: number;
	headers: Record<string, string>;
};

type ExtensionEvent = Partial<AfterProviderResponseEvent> & {
	toolName?: string;
};

type ExtensionEventName =
	| "session_start"
	| "session_shutdown"
	| "agent_start"
	| "agent_end"
	| "input"
	| "tool_result"
	| "session_compact"
	| "after_provider_response"
	| "model_select";

type ExtensionAPI = {
	on(
		eventName: ExtensionEventName,
		handler: (
			event: ExtensionEvent,
			ctx: ExtensionContext,
		) => void | Promise<void>,
	): void;
};

const ANSI_RESET = "\x1b[0m";
const SEPARATOR_COLOR = "\x1b[38;5;244m";
const POWERLINE_THIN_LEFT = "\uE0B1";
const ASCII_THIN_LEFT = "|";
const CACHE_TTL_MS = 1000;
const BRANCH_TTL_MS = 500;
const PROVIDER_USAGE_TTL_MS = 5 * 60 * 1000;
const PROVIDER_USAGE_FETCH_TIMEOUT_MS = 5000;
const PROVIDER_BADGE_SEPARATOR = " · ";

const NERD_ICONS = {
	model: "\uEC19",
	branch: "\uF126",
	context: "\uE70F",
	auto: "\u{F0068}",
	provider: "\uF544",
	anthropic: "\uF544",
	openai: "\uE7CF",
	openrouter: "\uF135",
	github: "\uF09B",
	google: "\uE7B2",
	antigravity: "\uF11E",
};

const ASCII_ICONS = {
	model: "",
	branch: "⎇",
	context: "◫",
	auto: "AC",
	provider: "",
	anthropic: "",
	openai: "",
	openrouter: "",
	github: "",
	google: "",
	antigravity: "",
};

type ThemeColor = Parameters<Theme["fg"]>[0];
type SemanticColor =
	| "model"
	| "gitDirty"
	| "gitClean"
	| "providerUsage"
	| "context"
	| "contextWarn"
	| "contextError";
type ColorValue = ThemeColor | `#${string}`;

type AssistantTokenUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
};

type GitStatus = {
	branch: string | null;
	staged: number;
	unstaged: number;
	untracked: number;
};

type ProviderUsageAuthKind = "oauth" | "api_key" | "unknown";
type ProviderUsageState = "ready" | "unknown" | "error" | "unsupported";

type ProviderUsageScope = {
	sessionPercentUsed?: number;
	weeklyPercentUsed?: number;
	monthlyPercentUsed?: number;
	percentUsed?: number;
	balanceUsd?: number;
	creditsUsd?: number;
};

type ProviderUsageStatus = {
	providerId: string;
	authKind: ProviderUsageAuthKind;
	state: ProviderUsageState;
	scope?: ProviderUsageScope;
	fetchedAt?: number;
};

type ProviderUsageCacheEntry = ProviderUsageStatus & {
	lastAttemptAt?: number;
	pending?: Promise<void>;
};

type ProviderUsageTarget = {
	providerId: string;
	authKind: ProviderUsageAuthKind;
	active: boolean;
};

const COLORS: Record<SemanticColor, ColorValue> = {
	model: "#d787af",
	gitDirty: "warning",
	gitClean: "success",
	providerUsage: "dim",
	context: "dim",
	contextWarn: "warning",
	contextError: "error",
};

const OAUTH_PROVIDER_IDS = new Set([
	"anthropic",
	"openai-codex",
	"github-copilot",
	"google-gemini-cli",
	"google-antigravity",
]);
const API_KEY_PROVIDER_IDS = new Set(["anthropic", "openai", "openrouter"]);
const PROVIDER_FAMILY_ORDER = [
	"anthropic",
	"openai",
	"openrouter",
	"github-copilot",
	"google-gemini-cli",
	"google-antigravity",
];

let cachedStatus: (Omit<GitStatus, "branch"> & { timestamp: number }) | null =
	null;
let cachedBranch: { branch: string | null; timestamp: number } | null = null;
let pendingStatusFetch: Promise<void> | null = null;
let pendingBranchFetch: Promise<void> | null = null;
let statusInvalidation = 0;
let branchInvalidation = 0;
const providerUsageCache = new Map<string, ProviderUsageCacheEntry>();
let providerUsageInvalidation = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNerdFonts(): boolean {
	if (process.env.POWERLINE_NERD_FONTS === "1") return true;
	if (process.env.POWERLINE_NERD_FONTS === "0") return false;
	if (process.env.GHOSTTY_RESOURCES_DIR) return true;

	const term = (process.env.TERM_PROGRAM || "").toLowerCase();
	return ["iterm", "wezterm", "kitty", "ghostty", "alacritty"].some((t) =>
		term.includes(t),
	);
}

function icons(): typeof NERD_ICONS {
	return hasNerdFonts() ? NERD_ICONS : ASCII_ICONS;
}

function separator(): string {
	return hasNerdFonts() ? POWERLINE_THIN_LEFT : ASCII_THIN_LEFT;
}

function withIcon(icon: string, text: string): string {
	return icon ? `${icon} ${text}` : text;
}

function hexToAnsi(hex: string): string {
	const h = hex.replace("#", "");
	const r = Number.parseInt(h.slice(0, 2), 16);
	const g = Number.parseInt(h.slice(2, 4), 16);
	const b = Number.parseInt(h.slice(4, 6), 16);
	return `\x1b[38;2;${r};${g};${b}m`;
}

function applyColor(theme: Theme, color: ColorValue, text: string): string {
	if (/^#[0-9a-fA-F]{6}$/.test(color)) {
		return `${hexToAnsi(color)}${text}${ANSI_RESET}`;
	}
	return theme.fg(color as ThemeColor, text);
}

function color(theme: Theme, semantic: SemanticColor, text: string): string {
	return applyColor(theme, COLORS[semantic], text);
}

function formatTokens(n: number): string {
	if (n < 1000) return n.toString();
	if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1000000) return `${Math.round(n / 1000)}k`;
	if (n < 10000000) return `${(n / 1000000).toFixed(1)}M`;
	return `${Math.round(n / 1000000)}M`;
}

function stripAnsi(text: string): string {
	return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function displayLength(text: string): number {
	return Array.from(stripAnsi(text)).length;
}

function runGit(args: string[], timeoutMs = 200): Promise<string | null> {
	return new Promise((resolve) => {
		const proc = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let resolved = false;

		const timeout = setTimeout(() => {
			proc.kill();
			finish(null);
		}, timeoutMs);

		function finish(result: string | null): void {
			if (resolved) return;
			resolved = true;
			clearTimeout(timeout);
			resolve(result);
		}

		proc.stdout.on("data", (data) => {
			stdout += data.toString();
		});
		proc.on("close", (code) => finish(code === 0 ? stdout.trim() : null));
		proc.on("error", () => finish(null));
	});
}

function parseGitStatus(output: string): Omit<GitStatus, "branch"> {
	let staged = 0;
	let unstaged = 0;
	let untracked = 0;

	for (const line of output.split("\n")) {
		if (!line) continue;
		const x = line[0];
		const y = line[1];

		if (x === "?" && y === "?") {
			untracked++;
			continue;
		}
		if (x && x !== " " && x !== "?") staged++;
		if (y && y !== " ") unstaged++;
	}

	return { staged, unstaged, untracked };
}

async function fetchGitBranch(): Promise<string | null> {
	const branch = await runGit(["branch", "--show-current"]);
	if (branch === null) return null;
	if (branch) return branch;

	const sha = await runGit(["rev-parse", "--short", "HEAD"]);
	return sha ? `${sha} (detached)` : "detached";
}

function getCurrentBranch(
	providerBranch: string | null,
	onUpdate: () => void,
): string | null {
	const now = Date.now();
	if (cachedBranch && now - cachedBranch.timestamp < BRANCH_TTL_MS) {
		return cachedBranch.branch;
	}

	if (!pendingBranchFetch) {
		const fetchId = branchInvalidation;
		pendingBranchFetch = fetchGitBranch().then((result) => {
			if (fetchId === branchInvalidation) {
				cachedBranch = { branch: result, timestamp: Date.now() };
				onUpdate();
			}
			pendingBranchFetch = null;
		});
	}

	return cachedBranch ? cachedBranch.branch : providerBranch;
}

function getGitStatus(
	providerBranch: string | null,
	onUpdate: () => void,
): GitStatus {
	const now = Date.now();
	const branch = getCurrentBranch(providerBranch, onUpdate);

	if (cachedStatus && now - cachedStatus.timestamp < CACHE_TTL_MS) {
		return { branch, ...cachedStatus };
	}

	if (!pendingStatusFetch) {
		const fetchId = statusInvalidation;
		pendingStatusFetch = runGit(["status", "--porcelain"], 500).then(
			(output) => {
				if (fetchId === statusInvalidation) {
					const parsed = output
						? parseGitStatus(output)
						: { staged: 0, unstaged: 0, untracked: 0 };
					cachedStatus = { ...parsed, timestamp: Date.now() };
					onUpdate();
				}
				pendingStatusFetch = null;
			},
		);
	}

	return cachedStatus
		? { branch, ...cachedStatus }
		: { branch, staged: 0, unstaged: 0, untracked: 0 };
}

function invalidateGit(): void {
	cachedStatus = null;
	cachedBranch = null;
	statusInvalidation++;
	branchInvalidation++;
}

function isAssistantMessageWithUsage(
	value: unknown,
): value is { usage: AssistantTokenUsage; stopReason?: string } {
	if (!isRecord(value)) return false;
	const usage = value.usage;
	if (!isRecord(usage)) return false;
	return (
		value.role === "assistant" &&
		typeof usage.input === "number" &&
		typeof usage.output === "number" &&
		typeof usage.cacheRead === "number" &&
		typeof usage.cacheWrite === "number" &&
		(value.stopReason === undefined || typeof value.stopReason === "string")
	);
}

function collectContextTokens(ctx: ExtensionContext): number {
	let lastAssistant: { usage: AssistantTokenUsage } | undefined;
	const branch = ctx.sessionManager?.getBranch?.() ?? [];

	for (const entry of branch) {
		if (!isRecord(entry) || entry.type !== "message") continue;
		const message = entry.message;
		if (!isAssistantMessageWithUsage(message)) continue;
		if (message.stopReason === "error" || message.stopReason === "aborted")
			continue;

		lastAssistant = message;
	}

	const contextTokens = lastAssistant
		? lastAssistant.usage.input +
			lastAssistant.usage.output +
			lastAssistant.usage.cacheRead +
			lastAssistant.usage.cacheWrite
		: (ctx.getContextUsage?.()?.tokens ?? 0);

	return contextTokens ?? 0;
}

function normalizeProviderId(providerId: string): string {
	return providerId.trim().toLowerCase();
}

function providerFamily(providerId: string): string {
	const normalized = normalizeProviderId(providerId);
	if (normalized === "openai-codex" || normalized === "openai") {
		return "openai";
	}
	return normalized;
}

function providerOrder(providerId: string): number {
	const family = providerFamily(providerId);
	const index = PROVIDER_FAMILY_ORDER.indexOf(family);
	return index === -1 ? PROVIDER_FAMILY_ORDER.length : index;
}

function providerCacheKey(
	providerId: string,
	authKind: ProviderUsageAuthKind,
): string {
	return `${normalizeProviderId(providerId)}:${authKind}`;
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

function addProviderCandidate(
	candidates: ProviderUsageTarget[],
	providerId: string | undefined,
	authKind: ProviderUsageAuthKind,
	activeProviderId: string | undefined,
	includeUnsupported = false,
): void {
	if (!providerId) return;
	const normalized = normalizeProviderId(providerId);
	if (!normalized) return;
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
	ctx: ExtensionContext,
	model: ModelLike,
): ProviderUsageAuthKind | undefined {
	if (ctx.modelRegistry?.isUsingOAuth?.(model)) return "oauth";
	const providerId = model.provider
		? normalizeProviderId(model.provider)
		: undefined;
	const credential = providerId
		? ctx.modelRegistry?.authStorage?.get?.(providerId)
		: undefined;
	if (credential?.type === "oauth") return "oauth";
	if (credential?.type === "api_key") return "api_key";
	return providerId && API_KEY_PROVIDER_IDS.has(providerId)
		? "api_key"
		: undefined;
}

function getConfiguredModels(ctx: ExtensionContext): ModelLike[] {
	const available = ctx.modelRegistry?.getAvailable?.();
	if (available) return available;

	const allModels = ctx.modelRegistry?.getAll?.() ?? [];
	const hasConfiguredAuth = ctx.modelRegistry?.hasConfiguredAuth;
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

	return providerOrder(candidate.providerId) < providerOrder(current.providerId)
		? candidate
		: current;
}

function discoverProviderUsageTargets(
	ctx: ExtensionContext,
): ProviderUsageTarget[] {
	const activeProviderId = ctx.model?.provider
		? normalizeProviderId(ctx.model.provider)
		: undefined;
	const activeAuthKind = ctx.model ? modelAuthKind(ctx, ctx.model) : undefined;
	const candidates: ProviderUsageTarget[] = [];

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

	const authStorage = ctx.modelRegistry?.authStorage;
	for (const providerId of authStorage?.list?.() ?? []) {
		const normalized = normalizeProviderId(providerId);
		const credential = authStorage?.get?.(normalized);
		if (credential?.type === "oauth") {
			addProviderCandidate(candidates, normalized, "oauth", activeProviderId);
		} else if (credential?.type === "api_key") {
			addProviderCandidate(candidates, normalized, "api_key", activeProviderId);
		}
	}

	for (const provider of authStorage?.getOAuthProviders?.() ?? []) {
		const normalized = normalizeProviderId(provider.id);
		if (authStorage?.hasAuth?.(normalized)) {
			addProviderCandidate(candidates, normalized, "oauth", activeProviderId);
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

	return [...byFamily.values()].sort((a, b) => {
		if (a.active !== b.active) return a.active ? -1 : 1;
		return providerOrder(a.providerId) - providerOrder(b.providerId);
	});
}

async function getProviderToken(
	ctx: ExtensionContext,
	providerId: string,
): Promise<string | undefined> {
	return ctx.modelRegistry?.getApiKeyForProvider?.(providerId);
}

function getStoredOAuthCredential(
	ctx: ExtensionContext,
	providerId: string,
): Extract<AuthCredentialLike, { type: "oauth" }> | undefined {
	const credential = ctx.modelRegistry?.authStorage?.get?.(providerId);
	return credential?.type === "oauth" ? credential : undefined;
}

async function getGitHubCopilotUserToken(
	ctx: ExtensionContext,
): Promise<string | undefined> {
	const credential = getStoredOAuthCredential(ctx, "github-copilot");
	return credential?.refresh ?? (await getProviderToken(ctx, "github-copilot"));
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

async function fetchJson(
	url: string,
	init: RequestInit,
): Promise<unknown | undefined> {
	const response = await fetch(url, {
		...init,
		signal: AbortSignal.timeout(PROVIDER_USAGE_FETCH_TIMEOUT_MS),
	});
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

async function fetchOpenRouterCredits(
	token: string,
): Promise<ProviderUsageScope | undefined> {
	const body = await fetchJson("https://openrouter.ai/api/v1/credits", {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!isRecord(body) || !isRecord(body.data)) return undefined;

	const totalCredits = numericField(body.data.total_credits);
	const totalUsage = numericField(body.data.total_usage);
	if (totalCredits === undefined || totalUsage === undefined) return undefined;

	return {
		balanceUsd: totalCredits - totalUsage,
		creditsUsd: totalCredits,
	};
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
	if (!isRecord(body)) return undefined;

	const rateLimit = nestedRecord(body, "rate_limit");
	const primary = rateLimit
		? nestedRecord(rateLimit, "primary_window")
		: undefined;
	const secondary = rateLimit
		? nestedRecord(rateLimit, "secondary_window")
		: undefined;
	const credits = nestedRecord(body, "credits");
	const sessionPercentUsed = primary
		? parseUtilization(
				primary.used_percent ?? primary.used_percentage ?? primary.utilization,
			)
		: undefined;
	const weeklyPercentUsed = secondary
		? parseUtilization(
				secondary.used_percent ??
					secondary.used_percentage ??
					secondary.utilization,
			)
		: undefined;
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
	ctx: ExtensionContext,
	target: ProviderUsageTarget,
): Promise<ProviderUsageStatus> {
	const statusBase = {
		providerId: target.providerId,
		authKind: target.authKind,
		fetchedAt: Date.now(),
	};

	if (target.authKind === "oauth") {
		const token = await getProviderToken(ctx, target.providerId);
		if (!token) return { ...statusBase, state: "unknown" };

		let scope: ProviderUsageScope | undefined;
		if (target.providerId === "anthropic") {
			scope = await fetchAnthropicOAuthUsage(token);
		} else if (target.providerId === "openai-codex") {
			scope = await fetchOpenAiCodexUsage(token);
		} else if (target.providerId === "github-copilot") {
			const githubToken = await getGitHubCopilotUserToken(ctx);
			scope = githubToken
				? await fetchGitHubCopilotUsage(githubToken)
				: undefined;
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

		return scope
			? { ...statusBase, state: "ready", scope }
			: { ...statusBase, state: "unknown" };
	}

	if (target.providerId === "openrouter" && target.authKind === "api_key") {
		const token = await getProviderToken(ctx, target.providerId);
		if (!token) return { ...statusBase, state: "unknown" };

		const scope =
			(await fetchOpenRouterKeyStatus(token)) ??
			(await fetchOpenRouterCredits(token));
		return scope
			? { ...statusBase, state: "ready", scope }
			: { ...statusBase, state: "unknown" };
	}

	return { ...statusBase, state: "unsupported" };
}

function invalidateProviderUsageCache(): void {
	providerUsageInvalidation++;
	providerUsageCache.clear();
}

function refreshProviderUsage(
	ctx: ExtensionContext,
	targets: ProviderUsageTarget[],
	onUpdate: () => void,
): void {
	const now = Date.now();
	const fetchId = providerUsageInvalidation;
	for (const target of targets) {
		const key = providerCacheKey(target.providerId, target.authKind);
		const entry = providerUsageCache.get(key);
		if (entry?.pending) continue;
		if (
			entry?.lastAttemptAt &&
			now - entry.lastAttemptAt < PROVIDER_USAGE_TTL_MS
		) {
			continue;
		}

		const pending = fetchProviderUsage(ctx, target)
			.then((status) => {
				if (fetchId !== providerUsageInvalidation) return;
				providerUsageCache.set(key, {
					...status,
					lastAttemptAt: now,
				});
			})
			.catch(() => {
				if (fetchId !== providerUsageInvalidation) return;
				providerUsageCache.set(key, {
					providerId: target.providerId,
					authKind: target.authKind,
					state: "error",
					fetchedAt: Date.now(),
					lastAttemptAt: now,
				});
			})
			.finally(() => {
				if (fetchId === providerUsageInvalidation) onUpdate();
			});

		providerUsageCache.set(key, {
			providerId: target.providerId,
			authKind: target.authKind,
			state: entry?.state ?? "unknown",
			scope: entry?.scope,
			fetchedAt: entry?.fetchedAt,
			lastAttemptAt: now,
			pending,
		});
	}
}

function providerShortLabel(providerId: string): string {
	switch (providerFamily(providerId)) {
		case "anthropic":
			return "Anth";
		case "openai":
			return "OAI";
		case "openrouter":
			return "OR";
		case "github-copilot":
			return "GH";
		case "google-gemini-cli":
			return "Gem";
		case "google-antigravity":
			return "AG";
		default:
			return providerId.slice(0, 6);
	}
}

function providerIcon(providerId: string): string {
	const family = providerFamily(providerId);
	const iconSet = icons();
	if (family === "anthropic") return iconSet.anthropic;
	if (family === "openai") return iconSet.openai;
	if (family === "openrouter") return iconSet.openrouter;
	if (family === "github-copilot") return iconSet.github;
	if (family === "google-gemini-cli") return iconSet.google;
	if (family === "google-antigravity") return iconSet.antigravity;
	return iconSet.provider;
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

function formatProviderScope(
	scope: ProviderUsageScope | undefined,
): string | undefined {
	if (!scope) return undefined;
	const usageParts: string[] = [];
	if (scope.sessionPercentUsed !== undefined) {
		usageParts.push(`${formatPercent(scope.sessionPercentUsed)} se`);
	}
	if (scope.weeklyPercentUsed !== undefined) {
		usageParts.push(`${formatPercent(scope.weeklyPercentUsed)} wk`);
	}
	if (scope.monthlyPercentUsed !== undefined) {
		usageParts.push(`${formatPercent(scope.monthlyPercentUsed)} mo`);
	}
	if (scope.percentUsed !== undefined) {
		usageParts.push(formatPercent(scope.percentUsed));
	}
	if (usageParts.length > 0) return usageParts.join(" ");
	if (scope.balanceUsd !== undefined) return formatMoney(scope.balanceUsd);
	if (scope.creditsUsd !== undefined) return formatMoney(scope.creditsUsd);
	return undefined;
}

function renderProviderBadge(
	target: ProviderUsageTarget,
	theme: Theme,
): string | undefined {
	const status = providerUsageCache.get(
		providerCacheKey(target.providerId, target.authKind),
	);
	const scopeText =
		status?.state === "ready" ? formatProviderScope(status.scope) : undefined;
	if (!scopeText && !target.active) return undefined;

	const usageText = scopeText ?? "?";
	const label = withIcon(
		providerIcon(target.providerId),
		providerShortLabel(target.providerId),
	);
	return color(theme, "providerUsage", `${label} ${usageText}`);
}

function renderProviderUsage(
	targets: ProviderUsageTarget[],
	theme: Theme,
	activeOnly: boolean,
): string | undefined {
	const badges = targets
		.filter((target) => !activeOnly || target.active)
		.map((target) => renderProviderBadge(target, theme))
		.filter((badge): badge is string => Boolean(badge));

	return badges.length > 0 ? badges.join(PROVIDER_BADGE_SEPARATOR) : undefined;
}

function renderModel(ctx: ExtensionContext, theme: Theme): string {
	let modelName = ctx.model?.name || ctx.model?.id || "no-model";
	if (modelName.startsWith("Claude ")) modelName = modelName.slice(7);
	return color(theme, "model", withIcon(icons().model, modelName));
}

function renderGit(git: GitStatus, theme: Theme): string | undefined {
	const { branch, staged, unstaged, untracked } = git;
	const isDirty = staged > 0 || unstaged > 0 || untracked > 0;
	if (!branch && !isDirty) return undefined;

	let content = "";
	if (branch) {
		content = color(
			theme,
			isDirty ? "gitDirty" : "gitClean",
			withIcon(icons().branch, branch),
		);
	}

	const indicators: string[] = [];
	if (unstaged > 0) indicators.push(theme.fg("warning", `*${unstaged}`));
	if (staged > 0) indicators.push(theme.fg("success", `+${staged}`));
	if (indicators.length > 0)
		content += content ? ` ${indicators.join(" ")}` : indicators.join(" ");

	return content || undefined;
}

function renderContext(
	ctx: ExtensionContext,
	contextTokens: number,
	theme: Theme,
): string | undefined {
	const contextUsage = ctx.getContextUsage?.();
	const contextWindow =
		contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	if (!contextWindow) return undefined;

	const pct = contextUsage?.percent ?? (contextTokens / contextWindow) * 100;
	const autoCompactEnabled =
		ctx.settingsManager?.getCompactionSettings?.()?.enabled ?? true;
	const autoIcon = autoCompactEnabled && icons().auto ? ` ${icons().auto}` : "";
	const text = `${pct.toFixed(1)}%/${formatTokens(contextWindow)}${autoIcon}`;
	const semantic =
		pct > 90 ? "contextError" : pct > 70 ? "contextWarn" : "context";
	return withIcon(icons().context, color(theme, semantic, text));
}

function formatLine(parts: (string | undefined)[]): string {
	const visibleParts = parts.filter((part): part is string => Boolean(part));
	if (visibleParts.length === 0) return "";
	return ` ${visibleParts.join(` ${SEPARATOR_COLOR}${separator()}${ANSI_RESET} `)}${ANSI_RESET} `;
}

function buildCompactLine(
	ctx: ExtensionContext,
	theme: Theme,
	footerData: ReadonlyFooterDataProvider | null,
	onUpdate: () => void,
	width: number,
): string {
	const providerUsageTargets = discoverProviderUsageTargets(ctx);
	refreshProviderUsage(ctx, providerUsageTargets, onUpdate);

	const contextTokens = collectContextTokens(ctx);
	const providerBranch = footerData?.getGitBranch() ?? null;
	const git = getGitStatus(providerBranch, onUpdate);
	const modelPart = renderModel(ctx, theme);
	const gitPart = renderGit(git, theme);
	const contextPart = renderContext(ctx, contextTokens, theme);
	const providerPart = renderProviderUsage(providerUsageTargets, theme, false);
	const activeProviderPart = renderProviderUsage(
		providerUsageTargets,
		theme,
		true,
	);

	const fullLine = formatLine([modelPart, gitPart, providerPart, contextPart]);
	if (!width || displayLength(fullLine) <= width) return fullLine;

	const activeProviderLine = formatLine([
		modelPart,
		gitPart,
		activeProviderPart,
		contextPart,
	]);
	if (displayLength(activeProviderLine) <= width) return activeProviderLine;

	return formatLine([modelPart, gitPart, contextPart]);
}

export default function statusline(pi: ExtensionAPI): void {
	let currentCtx: ExtensionContext | null = null;
	let footerData: ReadonlyFooterDataProvider | null = null;
	let tuiRef: { requestRender?: () => void } | null = null;

	const requestRender = () => tuiRef?.requestRender?.();
	const refreshCurrentProviderUsage = (ctx: ExtensionContext): void => {
		currentCtx = ctx;
		refreshProviderUsage(ctx, discoverProviderUsageTargets(ctx), requestRender);
	};

	function install(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		currentCtx = ctx;
		refreshProviderUsage(ctx, discoverProviderUsageTargets(ctx), requestRender);

		ctx.ui.setFooter((tui, _theme, data) => {
			tuiRef = tui;
			footerData = data;
			const unsubscribe = data.onBranchChange(() => {
				invalidateGit();
				requestRender();
			});

			return {
				dispose: unsubscribe,
				invalidate: requestRender,
				render: () => [],
			};
		});

		ctx.ui.setWidget(
			"pi-statusline",
			(tui, theme) => {
				tuiRef = tui;
				return {
					dispose() {},
					invalidate: requestRender,
					render(width: number): string[] {
						if (!currentCtx) return [];
						const line = buildCompactLine(
							currentCtx,
							theme,
							footerData,
							requestRender,
							width,
						);
						return line ? [line] : [];
					},
				};
			},
			{ placement: "belowEditor" },
		);
	}

	pi.on("session_start", (_event, ctx) => {
		invalidateProviderUsageCache();
		install(ctx);
	});
	pi.on("session_shutdown", (_event, ctx) => {
		if (currentCtx === ctx) currentCtx = null;
	});
	pi.on("agent_start", (_event, ctx) => {
		currentCtx = ctx;
		requestRender();
	});
	pi.on("agent_end", (_event, ctx) => {
		refreshCurrentProviderUsage(ctx);
		requestRender();
	});
	pi.on("after_provider_response", (_event, ctx) => {
		refreshCurrentProviderUsage(ctx);
		requestRender();
	});
	pi.on("model_select", (_event, ctx) => {
		invalidateProviderUsageCache();
		refreshCurrentProviderUsage(ctx);
		requestRender();
	});
	pi.on("input", (_event, ctx) => {
		currentCtx = ctx;
		requestRender();
	});
	pi.on("tool_result", (event, ctx) => {
		currentCtx = ctx;
		if (event.toolName === "bash") invalidateGit();
		requestRender();
	});
	pi.on("session_compact", (_event, ctx) => {
		currentCtx = ctx;
		requestRender();
	});
}
