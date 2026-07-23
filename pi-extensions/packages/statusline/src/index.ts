import { resolve } from "node:path";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
	type GitStatus,
	getGitStatus,
	invalidateGit,
	type ReadonlyFooterDataProvider,
} from "./git-status";
import type {
	ModelLike,
	ModelRegistryLike,
	ProviderUsageContext,
} from "./pi-types";
import {
	discoverProviderUsageTargets,
	invalidateProviderUsageDiscovery,
	refreshProviderUsage,
	renderProviderUsage,
} from "./provider-usage";

type Theme = {
	fg(color: string, text: string): string;
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
		getCwd?(): string;
	};
	model?: ModelLike;
	modelRegistry?: ModelRegistryLike;
	readStoredCredential?: typeof readStoredCredential;
	settingsManager?: {
		getCompactionSettings?(): { enabled?: boolean } | undefined;
		getGlobalSettings?(): Record<string, unknown>;
		getProjectSettings?(): Record<string, unknown>;
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

type ThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

type ExtensionEvent = Partial<AfterProviderResponseEvent> & {
	toolName?: string;
	level?: ThinkingLevel;
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
	| "model_select"
	| "thinking_level_select";

type ExtensionAPI = {
	getThinkingLevel?(): ThinkingLevel;
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
const NERD_ICONS = {
	model: "\uEC19",
	thinking: "\uF0EB",
	branch: "\uF126",
	context: "\uE70F",
	auto: "\u{F0068}",
};

const ASCII_ICONS = {
	model: "",
	thinking: "T",
	branch: "⎇",
	context: "◫",
	auto: "AC",
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

type StatuslineSection =
	| "model"
	| "thinking"
	| "git"
	| "provider_usage"
	| "context";
type StatuslineLayout = StatuslineSection[][];
type ProviderUsageRenderMode = "full" | "active" | "omit";

const DEFAULT_STATUSLINE_LAYOUT: StatuslineLayout = [
	["model", "thinking", "git", "context"],
	["provider_usage"],
];
const COLORS: Record<SemanticColor, ColorValue> = {
	model: "#d787af",
	gitDirty: "warning",
	gitClean: "success",
	providerUsage: "dim",
	context: "dim",
	contextWarn: "warning",
	contextError: "error",
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function configuredSectionsFromSettings(
	settings: Record<string, unknown> | undefined,
): { present: boolean; value?: unknown } {
	if (!settings) return { present: false };
	const statusline = settings.statusline;
	if (!isRecord(statusline)) return { present: false };
	if (!Object.hasOwn(statusline, "sections")) {
		return { present: false };
	}
	return { present: true, value: statusline.sections };
}

function isStatuslineSection(value: string): value is StatuslineSection {
	return (
		value === "model" ||
		value === "thinking" ||
		value === "git" ||
		value === "provider_usage" ||
		value === "context"
	);
}

function parseSectionLine(
	value: unknown[],
	seen: Set<StatuslineSection>,
): StatuslineSection[] {
	const sections: StatuslineSection[] = [];
	for (const item of value) {
		if (typeof item !== "string" || !isStatuslineSection(item)) continue;
		if (seen.has(item)) continue;
		seen.add(item);
		sections.push(item);
	}
	return sections;
}

function parseStatuslineLayout(value: unknown): StatuslineLayout | undefined {
	if (!Array.isArray(value)) return undefined;

	const seen = new Set<StatuslineSection>();

	// Detect nested array format: [["model", "git"], ["provider_usage"]]
	const isNested =
		value.length > 0 && value.every((item) => Array.isArray(item));
	if (isNested) {
		const lines: StatuslineLayout = [];
		for (const row of value) {
			const parsed = parseSectionLine(row, seen);
			if (parsed.length > 0) lines.push(parsed);
		}
		return lines.length > 0 ? lines : undefined;
	}

	// Flat array format: ["model", "git", "context"] → single line
	const flat = parseSectionLine(value, seen);
	return flat.length > 0 ? [flat] : undefined;
}

function getStatuslineLayout(ctx: ExtensionContext): StatuslineLayout {
	const projectSetting = configuredSectionsFromSettings(
		ctx.settingsManager?.getProjectSettings?.(),
	);
	if (projectSetting.present) {
		return (
			parseStatuslineLayout(projectSetting.value) ?? DEFAULT_STATUSLINE_LAYOUT
		);
	}

	const globalSetting = configuredSectionsFromSettings(
		ctx.settingsManager?.getGlobalSettings?.(),
	);
	if (globalSetting.present) {
		return (
			parseStatuslineLayout(globalSetting.value) ?? DEFAULT_STATUSLINE_LAYOUT
		);
	}

	return DEFAULT_STATUSLINE_LAYOUT;
}

function hasProviderUsageSection(ctx: ExtensionContext): boolean {
	return getStatuslineLayout(ctx).some((line) =>
		line.includes("provider_usage"),
	);
}

function toProviderUsageContext(ctx: ExtensionContext): ProviderUsageContext {
	return {
		model: ctx.model,
		modelRegistry: ctx.modelRegistry,
		readStoredCredential: ctx.readStoredCredential ?? readStoredCredential,
	};
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

function isHexColor(color: ColorValue): color is `#${string}` {
	return /^#[0-9a-fA-F]{6}$/.test(color);
}

function applyColor(theme: Theme, color: ColorValue, text: string): string {
	if (isHexColor(color)) {
		return `${hexToAnsi(color)}${text}${ANSI_RESET}`;
	}
	return theme.fg(color, text);
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

function displayLength(text: string): number {
	return visibleWidth(text);
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

function thinkingColor(level: ThinkingLevel): ThemeColor {
	return `thinking${level.charAt(0).toUpperCase()}${level.slice(1)}`;
}

function renderThinking(level: ThinkingLevel, theme: Theme): string {
	return theme.fg(thinkingColor(level), withIcon(icons().thinking, level));
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

function sessionCwd(ctx: ExtensionContext): string {
	return resolve(ctx.sessionManager?.getCwd?.() ?? process.cwd());
}

function buildStatusLines(
	ctx: ExtensionContext,
	theme: Theme,
	footerData: ReadonlyFooterDataProvider | null,
	onUpdate: () => void,
	width: number,
	thinkingLevel: ThinkingLevel,
): string[] {
	const layout = getStatuslineLayout(ctx);
	const allSections = layout.flat();
	const providerUsageEnabled = allSections.includes("provider_usage");
	const providerUsageCtx = toProviderUsageContext(ctx);
	const providerUsageTargets = providerUsageEnabled
		? discoverProviderUsageTargets(providerUsageCtx)
		: [];
	if (providerUsageEnabled) {
		refreshProviderUsage(providerUsageCtx, providerUsageTargets, onUpdate);
	}

	const contextTokens = allSections.includes("context")
		? collectContextTokens(ctx)
		: 0;
	const providerBranch = footerData?.getGitBranch() ?? null;
	const git = allSections.includes("git")
		? getGitStatus(sessionCwd(ctx), providerBranch, onUpdate)
		: undefined;

	const renderSectionParts = (
		sections: StatuslineSection[],
		providerMode: ProviderUsageRenderMode,
	): (string | undefined)[] =>
		sections.map((section) => {
			switch (section) {
				case "model":
					return renderModel(ctx, theme);
				case "thinking":
					return renderThinking(thinkingLevel, theme);
				case "git":
					return git ? renderGit(git, theme) : undefined;
				case "provider_usage":
					if (!providerUsageEnabled || providerMode === "omit")
						return undefined;
					return renderProviderUsage(
						providerUsageTargets,
						theme,
						providerMode === "active",
					);
				case "context":
					return renderContext(ctx, contextTokens, theme);
				default:
					return undefined;
			}
		});

	const lines: string[] = [];
	for (const lineSections of layout) {
		const fullLine = formatLine(renderSectionParts(lineSections, "full"));
		if (!width || displayLength(fullLine) <= width) {
			if (fullLine) lines.push(fullLine);
			continue;
		}

		const activeProviderLine = formatLine(
			renderSectionParts(lineSections, "active"),
		);
		if (displayLength(activeProviderLine) <= width) {
			if (activeProviderLine) lines.push(activeProviderLine);
			continue;
		}

		const omitLine = formatLine(renderSectionParts(lineSections, "omit"));
		if (omitLine) {
			lines.push(truncateToWidth(omitLine, width, ""));
		}
	}

	return lines;
}

export default function statusline(pi: ExtensionAPI): void {
	let currentCtx: ExtensionContext | null = null;
	let footerData: ReadonlyFooterDataProvider | null = null;
	let tuiRef: { requestRender?: () => void } | null = null;
	let thinkingLevel: ThinkingLevel = "off";

	const requestRender = () => tuiRef?.requestRender?.();
	const refreshCurrentProviderUsage = (ctx: ExtensionContext): void => {
		currentCtx = ctx;
		if (hasProviderUsageSection(ctx)) {
			const providerUsageCtx = toProviderUsageContext(ctx);
			refreshProviderUsage(
				providerUsageCtx,
				discoverProviderUsageTargets(providerUsageCtx),
				requestRender,
			);
		}
	};

	function install(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		currentCtx = ctx;
		thinkingLevel = pi.getThinkingLevel?.() ?? thinkingLevel;
		if (hasProviderUsageSection(ctx)) {
			const providerUsageCtx = toProviderUsageContext(ctx);
			refreshProviderUsage(
				providerUsageCtx,
				discoverProviderUsageTargets(providerUsageCtx),
				requestRender,
			);
		}

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
						return buildStatusLines(
							currentCtx,
							theme,
							footerData,
							requestRender,
							width,
							thinkingLevel,
						);
					},
				};
			},
			{ placement: "belowEditor" },
		);
	}

	pi.on("session_start", (_event, ctx) => {
		invalidateProviderUsageDiscovery();
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
		invalidateProviderUsageDiscovery();
		refreshCurrentProviderUsage(ctx);
		requestRender();
	});
	pi.on("thinking_level_select", (event, ctx) => {
		currentCtx = ctx;
		thinkingLevel = event.level ?? pi.getThinkingLevel?.() ?? thinkingLevel;
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
