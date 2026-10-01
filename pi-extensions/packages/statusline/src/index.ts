import { resolve } from "node:path";
import {
	type ExtensionAPI,
	type ExtensionContext,
	readStoredCredential,
} from "@earendil-works/pi-coding-agent";

type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

import {
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
	FAST_CHANGED_EVENT,
	FAST_READER_EVENT,
	type FastReader,
	isCliproxyFast,
} from "./cliproxy-fast";
import {
	GIT_REFRESH_INTERVAL_MS,
	type GitStatus,
	getGitStatus,
	invalidateGit,
} from "./git-status";
import type { ProviderUsageContext } from "./pi-types";
import {
	discoverProviderUsageTargetsAsync,
	invalidateProviderUsageDiscovery,
	mappedProviderUsageFamily,
	type ProviderUsageTarget,
	refreshProviderUsage,
	renderProviderUsage,
} from "./provider-usage";

type Theme = {
	fg(color: string, text: string): string;
};

type TuiLike = {
	requestRender?: () => void;
};

const ANSI_RESET = "\x1b[0m";
const SEPARATOR_COLOR = "\x1b[38;5;244m";
const POWERLINE_THIN_LEFT = "\uE0B1";
const ICONS = {
	model: "\uEC19",
	fast: "\uF0E7",
	thinking: "\uF0EB",
	branch: "\uF126",
	context: "\uE70F",
	auto: "\u{F0068}",
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

type StatuslineSection =
	| "model"
	| "thinking"
	| "git"
	| "provider_usage"
	| "context";
type StatuslineLayout = StatuslineSection[][];
type ProviderUsageRenderMode = "full" | "active";

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

function configuredSectionsFromSettings(settings: unknown): unknown {
	if (!isRecord(settings) || !isRecord(settings.statusline)) return undefined;
	return settings.statusline.sections;
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

function getStatuslineLayout(pi: ExtensionAPI): StatuslineLayout {
	const setting = configuredSectionsFromSettings(pi.getSettings());
	return parseStatuslineLayout(setting) ?? DEFAULT_STATUSLINE_LAYOUT;
}

function toProviderUsageContext(ctx: ExtensionContext): ProviderUsageContext {
	return {
		model: ctx.model,
		modelRegistry: ctx.modelRegistry,
		readStoredCredential,
	};
}

function withIcon(icon: string, text: string): string {
	return `${icon} ${text}`;
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

function renderModel(
	ctx: ExtensionContext,
	theme: Theme,
	fastReader: FastReader | undefined,
): string {
	let modelName = ctx.model?.name || ctx.model?.id || "no-model";
	if (modelName.startsWith("Claude ")) modelName = modelName.slice(7);

	const model = color(theme, "model", withIcon(ICONS.model, modelName));
	return isCliproxyFast(ctx.model, fastReader)
		? `${model} ${theme.fg("warning", ICONS.fast)}`
		: model;
}

function thinkingColor(level: ThinkingLevel): ThemeColor {
	return `thinking${level.charAt(0).toUpperCase()}${level.slice(1)}`;
}

function renderThinking(level: ThinkingLevel, theme: Theme): string {
	return theme.fg(thinkingColor(level), withIcon(ICONS.thinking, level));
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
			withIcon(ICONS.branch, branch),
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
	theme: Theme,
	autoCompactEnabled: boolean,
): string | undefined {
	const contextUsage = ctx.getContextUsage?.();
	const contextWindow =
		contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
	if (!contextWindow) return undefined;

	// null is intentional after compaction: pre-compaction usage is not valid.
	const pct = contextUsage?.percent;
	const autoIcon = autoCompactEnabled ? ` ${ICONS.auto}` : "";
	const percentage = pct == null ? "?" : `${pct.toFixed(1)}%`;
	const text = `${percentage}/${formatTokens(contextWindow)}${autoIcon}`;
	const semantic =
		pct != null && pct > 90
			? "contextError"
			: pct != null && pct > 70
				? "contextWarn"
				: "context";
	return withIcon(ICONS.context, color(theme, semantic, text));
}

function formatLine(parts: (string | undefined)[]): string {
	const visibleParts = parts.filter((part): part is string => Boolean(part));
	if (visibleParts.length === 0) return "";
	return ` ${visibleParts.join(` ${SEPARATOR_COLOR}${POWERLINE_THIN_LEFT}${ANSI_RESET} `)}${ANSI_RESET} `;
}

function wrapLineParts(parts: (string | undefined)[], width: number): string[] {
	const visibleParts = parts.filter((part): part is string => Boolean(part));
	if (visibleParts.length === 0) return [];
	if (!width) return [formatLine(visibleParts)];

	const lines: string[] = [];
	let currentParts: string[] = [];

	for (const part of visibleParts) {
		const candidateParts = [...currentParts, part];
		if (displayLength(formatLine(candidateParts)) <= width) {
			currentParts = candidateParts;
			continue;
		}

		if (currentParts.length > 0) {
			lines.push(formatLine(currentParts));
			currentParts = [];
		}

		const standaloneLine = formatLine([part]);
		if (displayLength(standaloneLine) > width) {
			lines.push(...wrapTextWithAnsi(standaloneLine, width));
		} else {
			currentParts = [part];
		}
	}

	if (currentParts.length > 0) {
		lines.push(formatLine(currentParts));
	}

	return lines;
}

function sessionCwd(ctx: ExtensionContext): string {
	return resolve(ctx.sessionManager?.getCwd?.() ?? process.cwd());
}

function buildStatusLines(
	ctx: ExtensionContext,
	theme: Theme,
	layout: StatuslineLayout,
	git: GitStatus | undefined,
	providerUsageTargets: ProviderUsageTarget[],
	width: number,
	thinkingLevel: ThinkingLevel,
	fastReader: FastReader | undefined,
	autoCompactEnabled: boolean,
): string[] {
	// Width fallback may render sections twice; query Pi's context estimate once.
	const context = layout.some((row) => row.includes("context"))
		? renderContext(ctx, theme, autoCompactEnabled)
		: undefined;
	const renderSectionParts = (
		sections: StatuslineSection[],
		providerMode: ProviderUsageRenderMode,
	): (string | undefined)[] =>
		sections.map((section) => {
			switch (section) {
				case "model":
					return renderModel(ctx, theme, fastReader);
				case "thinking":
					return renderThinking(thinkingLevel, theme);
				case "git":
					return git ? renderGit(git, theme) : undefined;
				case "provider_usage":
					return renderProviderUsage(
						providerUsageTargets,
						theme,
						providerMode === "active",
						(text) => color(theme, "model", text),
						mappedProviderUsageFamily(ctx.model),
						ctx.model?.provider === "cliproxyapi",
					);
				case "context":
					return context;
				default:
					return undefined;
			}
		});

	const lines: string[] = [];
	for (const lineSections of layout) {
		const fullParts = renderSectionParts(lineSections, "full");
		const fullLine = formatLine(fullParts);
		const rowLines =
			displayLength(fullLine) <= width
				? fullLine
					? [fullLine]
					: []
				: wrapLineParts(renderSectionParts(lineSections, "active"), width);
		lines.push(...rowLines);
	}

	return lines;
}

function sanitizeStatus(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

const PROVIDER_DISCOVERY_INTERVAL_MS = 60_000;

export default function statusline(pi: ExtensionAPI): void {
	let currentCtx: ExtensionContext | null = null;
	let tuiRef: TuiLike | null = null;
	let thinkingLevel: ThinkingLevel = "off";
	let fastReader: FastReader | undefined;
	let disposeFooter: (() => void) | undefined;
	let refreshGit: (() => void) | undefined;
	let refreshProviders: ((rediscover?: boolean) => void) | undefined;
	const requestRender = () => tuiRef?.requestRender?.();
	pi.events.on(FAST_READER_EVENT, (value) => {
		fastReader =
			typeof value === "function" ? (value as FastReader) : undefined;
		requestRender();
	});
	pi.events.on(FAST_CHANGED_EVENT, requestRender);

	function install(ctx: ExtensionContext): void {
		disposeFooter?.();
		currentCtx = null;
		if (!ctx.hasUI || (ctx.mode !== undefined && ctx.mode !== "tui")) return;
		thinkingLevel = pi.getThinkingLevel?.() ?? thinkingLevel;

		ctx.ui.setFooter((tui, theme, data) => {
			currentCtx = ctx;
			tuiRef = tui;
			const layout = getStatuslineLayout(pi);
			const sections = layout.flat();
			let git: GitStatus | undefined;
			let targets: ProviderUsageTarget[] = [];
			let disposed = false;
			let discoveryId = 0;
			const onUpdate = () => {
				if (!disposed) requestRender();
			};
			const updateGit = () => {
				if (disposed || !currentCtx || !sections.includes("git")) return;
				git = getGitStatus(sessionCwd(currentCtx), data.getGitBranch(), () => {
					if (disposed) return;
					updateGit();
					onUpdate();
				});
			};
			const updateProviders = (rediscover = false) => {
				if (disposed || !currentCtx || !sections.includes("provider_usage"))
					return;
				const usageCtx = toProviderUsageContext(currentCtx);
				if (rediscover) {
					const id = ++discoveryId;
					invalidateProviderUsageDiscovery();
					void discoverProviderUsageTargetsAsync(usageCtx)
						.then((discovered) => {
							if (disposed || id !== discoveryId) return;
							targets = discovered;
							onUpdate();
							return refreshProviderUsage(usageCtx, targets, onUpdate);
						})
						.catch(() => {});
				} else {
					void refreshProviderUsage(usageCtx, targets, onUpdate).catch(
						() => {},
					);
				}
			};
			refreshGit = updateGit;
			refreshProviders = updateProviders;
			const unsubscribe = data.onBranchChange(() => {
				if (disposed) return;
				invalidateGit();
				updateGit();
				onUpdate();
			});
			updateGit();
			updateProviders(true);
			const gitTimer = sections.includes("git")
				? setInterval(updateGit, GIT_REFRESH_INTERVAL_MS)
				: undefined;
			// Recheck model/auth discovery even while idle. Usage fetches retain their
			// existing successful/failed-refresh TTLs and cross-process leases.
			const providerTimer = sections.includes("provider_usage")
				? setInterval(() => {
						updateProviders(true);
						onUpdate();
					}, PROVIDER_DISCOVERY_INTERVAL_MS)
				: undefined;
			gitTimer?.unref();
			providerTimer?.unref();
			const dispose = () => {
				if (disposed) return;
				disposed = true;
				if (gitTimer) clearInterval(gitTimer);
				if (providerTimer) clearInterval(providerTimer);
				unsubscribe();
				if (disposeFooter === dispose) {
					disposeFooter = undefined;
					refreshGit = undefined;
					refreshProviders = undefined;
					tuiRef = null;
					currentCtx = null;
				}
			};
			disposeFooter = dispose;
			return {
				dispose,
				// No cached themed strings; Pi owns scheduling after invalidation.
				invalidate() {},
				render(width: number): string[] {
					if (disposed || !currentCtx || width <= 0) return [];
					const extensionStatuses = data.getExtensionStatuses();
					const lines = buildStatusLines(
						currentCtx,
						theme,
						layout,
						git,
						targets,
						width,
						thinkingLevel,
						fastReader,
						pi.getSettings().compaction?.enabled ?? true,
					);
					const statuses = [...extensionStatuses.entries()]
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, text]) => sanitizeStatus(text))
						.filter(Boolean);
					if (statuses.length > 0) {
						lines.push(
							truncateToWidth(theme.fg("dim", statuses.join(" ")), width),
						);
					}
					return lines;
				},
			};
		});
	}

	pi.on("session_start", (_event, ctx) => install(ctx));
	pi.on("session_shutdown", () => {
		disposeFooter?.();
		currentCtx = null;
		fastReader = undefined;
	});
	const updateContext = (_event: unknown, ctx: ExtensionContext) => {
		if (!disposeFooter) return;
		currentCtx = ctx;
		requestRender();
	};
	pi.on("agent_start", updateContext);
	pi.on("input", updateContext);
	pi.on("session_compact", updateContext);
	pi.on("session_tree", updateContext);
	pi.on("message_end", updateContext);
	const updateUsage = (event: unknown, ctx: ExtensionContext) => {
		updateContext(event, ctx);
		refreshProviders?.();
	};
	pi.on("agent_end", updateUsage);
	pi.on("after_provider_response", updateUsage);
	pi.on("model_select", (event, ctx) => {
		updateContext(event, ctx);
		refreshProviders?.(true);
	});
	pi.on("thinking_level_select", (event, ctx) => {
		thinkingLevel = event.level ?? pi.getThinkingLevel?.() ?? thinkingLevel;
		updateContext(event, ctx);
	});
	pi.on("tool_result", (event, ctx) => {
		updateContext(event, ctx);
		if (
			event.toolName === "bash" ||
			event.toolName === "write" ||
			event.toolName === "edit"
		) {
			invalidateGit();
			refreshGit?.();
		}
	});
}
