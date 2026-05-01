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
	model?: {
		name?: string;
		id?: string;
		contextWindow?: number;
	};
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

type ExtensionAPI = {
	on(
		eventName:
			| "session_start"
			| "session_shutdown"
			| "agent_start"
			| "agent_end"
			| "input"
			| "tool_result"
			| "session_compact",
		handler: (event: any, ctx: ExtensionContext) => void | Promise<void>,
	): void;
};

const ANSI_RESET = "\x1b[0m";
const SEPARATOR_COLOR = "\x1b[38;5;244m";
const POWERLINE_THIN_LEFT = "\uE0B1";
const ASCII_THIN_LEFT = "|";
const CACHE_TTL_MS = 1000;
const BRANCH_TTL_MS = 500;

const NERD_ICONS = {
	model: "\uEC19",
	branch: "\uF126",
	context: "\uE70F",
	auto: "\u{F0068}",
};

const ASCII_ICONS = {
	model: "",
	branch: "⎇",
	context: "◫",
	auto: "AC",
};

type ThemeColor = Parameters<Theme["fg"]>[0];
type SemanticColor =
	| "model"
	| "gitDirty"
	| "gitClean"
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

const COLORS: Record<SemanticColor, ColorValue> = {
	model: "#d787af",
	gitDirty: "warning",
	gitClean: "success",
	context: "dim",
	contextWarn: "warning",
	contextError: "error",
};

let cachedStatus: (Omit<GitStatus, "branch"> & { timestamp: number }) | null =
	null;
let cachedBranch: { branch: string | null; timestamp: number } | null = null;
let pendingStatusFetch: Promise<void> | null = null;
let pendingBranchFetch: Promise<void> | null = null;
let statusInvalidation = 0;
let branchInvalidation = 0;

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

function buildCompactLine(
	ctx: ExtensionContext,
	theme: Theme,
	footerData: ReadonlyFooterDataProvider | null,
	onUpdate: () => void,
): string {
	const contextTokens = collectContextTokens(ctx);
	const providerBranch = footerData?.getGitBranch() ?? null;
	const git = getGitStatus(providerBranch, onUpdate);
	const parts = [
		renderModel(ctx, theme),
		renderGit(git, theme),
		renderContext(ctx, contextTokens, theme),
	].filter((part): part is string => Boolean(part));

	if (parts.length === 0) return "";
	return ` ${parts.join(` ${SEPARATOR_COLOR}${separator()}${ANSI_RESET} `)}${ANSI_RESET} `;
}

export default function statusline(pi: ExtensionAPI): void {
	let currentCtx: ExtensionContext | null = null;
	let footerData: ReadonlyFooterDataProvider | null = null;
	let tuiRef: { requestRender?: () => void } | null = null;

	const requestRender = () => tuiRef?.requestRender?.();

	function install(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		currentCtx = ctx;

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
					render(_width: number): string[] {
						if (!currentCtx) return [];
						const line = buildCompactLine(
							currentCtx,
							theme,
							footerData,
							requestRender,
						);
						return line ? [line] : [];
					},
				};
			},
			{ placement: "belowEditor" },
		);
	}

	pi.on("session_start", (_event, ctx) => install(ctx));
	pi.on("session_shutdown", (_event, ctx) => {
		if (currentCtx === ctx) currentCtx = null;
	});
	pi.on("agent_start", (_event, ctx) => {
		currentCtx = ctx;
		requestRender();
	});
	pi.on("agent_end", (_event, ctx) => {
		currentCtx = ctx;
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
