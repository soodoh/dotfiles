import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { SuggestionSink } from "../../app/orchestrators/turn-end.js";
import type { SuggestionUsageStats } from "../../domain/state.js";
import { formatTokens } from "./display.js";
import {
	formatGhostAcceptAndSendKeys,
	formatGhostAcceptKeys,
} from "./ghost-accept-keys.js";
import type { UiContextLike } from "./ui-context.js";

function formatUsage(
	usage: { suggester: SuggestionUsageStats; seeder: SuggestionUsageStats },
	suggesterModelDisplay: string | undefined,
): string {
	const combinedInput = usage.suggester.inputTokens + usage.seeder.inputTokens;
	const combinedOutput =
		usage.suggester.outputTokens + usage.seeder.outputTokens;
	const combinedCacheRead =
		usage.suggester.cacheReadTokens + usage.seeder.cacheReadTokens;
	const combinedCost = usage.suggester.costTotal + usage.seeder.costTotal;
	const suffix = suggesterModelDisplay
		? `, suggester: ${suggesterModelDisplay}`
		: "";
	return `suggester usage: ↑${formatTokens(combinedInput)} ↓${formatTokens(combinedOutput)} R${formatTokens(combinedCacheRead)} $${combinedCost.toFixed(3)} (${usage.suggester.calls} sugg, ${usage.seeder.calls} seed)${suffix}`;
}

function formatPanelLog(
	theme: ExtensionContext["ui"]["theme"],
	status: { level: "debug" | "info" | "warn" | "error"; text: string },
): string {
	if (status.level === "error") return theme.fg("error", status.text);
	if (status.level === "warn") return theme.fg("warning", status.text);
	if (status.level === "debug") return theme.fg("dim", status.text);
	return theme.fg("muted", status.text);
}

function getActiveUiContext(
	runtime: UiContextLike,
): ExtensionContext | undefined {
	const ctx = runtime.getContext();
	try {
		return ctx?.hasUI ? ctx : undefined;
	} catch {
		return undefined;
	}
}

function getGhostSuggestionStatus(params: {
	restored?: boolean;
	canGhostInEditor: boolean;
	ghostAcceptKeys: UiContextLike["ghostAcceptKeys"];
	ghostAcceptAndSendKeys: UiContextLike["ghostAcceptAndSendKeys"];
}): string {
	const statusLabel = params.restored
		? "restored prompt suggestion"
		: "prompt suggestion";
	if (!params.canGhostInEditor) return `${statusLabel} · ghost hidden`;
	return `${statusLabel} · ${formatGhostAcceptKeys(params.ghostAcceptKeys)} accepts · ${formatGhostAcceptAndSendKeys(params.ghostAcceptAndSendKeys)} sends`;
}

export function refreshSuggesterUi(runtime: UiContextLike): void {
	const ctx = getActiveUiContext(runtime);
	if (!ctx) return;

	ctx.ui.setStatus("suggester", undefined);
	ctx.ui.setStatus("suggester-events", undefined);
	ctx.ui.setStatus("suggester-usage", undefined);

	const suggestionStatus = runtime.showPanelStatus
		? runtime.getPanelSuggestionStatus()
		: undefined;
	const usageStatus = runtime.showUsageInPanel
		? runtime.getPanelUsageStatus()
		: undefined;
	const logStatus = runtime.getPanelLogStatus();
	if (!suggestionStatus && !logStatus && !usageStatus) {
		ctx.ui.setWidget("suggester-panel", undefined);
		return;
	}

	ctx.ui.setWidget(
		"suggester-panel",
		(_tui, theme) => ({
			invalidate() {},
			render(width: number): string[] {
				const lines: string[] = [];
				const parts: string[] = [];
				if (suggestionStatus) parts.push(theme.fg("accent", suggestionStatus));
				if (logStatus) parts.push(formatPanelLog(theme, logStatus));
				const line = parts.join(" · ");
				if (line) {
					const truncated = truncateToWidth(
						line,
						Math.max(10, width),
						"",
						true,
					);
					const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
					lines.push(truncated + pad);
				}
				if (usageStatus) {
					const truncated = truncateToWidth(
						theme.fg("dim", usageStatus),
						Math.max(10, width),
						"",
						true,
					);
					const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
					lines.push(truncated + pad);
				}
				return lines.length > 0 ? lines : [" ".repeat(Math.max(1, width))];
			},
		}),
		{ placement: "belowEditor" },
	);
}

export class PiSuggestionSink implements SuggestionSink {
	public constructor(private readonly runtime: UiContextLike) {}

	public async showSuggestion(
		text: string,
		options?: { restore?: boolean; generationId?: number },
	): Promise<void> {
		if (
			options?.generationId !== undefined &&
			options.generationId !== this.runtime.getEpoch()
		)
			return;
		const ctx = getActiveUiContext(this.runtime);
		if (!ctx) return;

		const editorText = ctx.ui.getEditorText();
		const trimmedEditorText = editorText.trim();
		const isMultilineSuggestion = text.includes("\n");
		const prefixCompatible =
			!editorText.includes("\n") && text.startsWith(editorText);
		const canGhostInEditor = isMultilineSuggestion
			? trimmedEditorText.length === 0
			: this.runtime.prefillOnlyWhenEditorEmpty
				? trimmedEditorText.length === 0
				: trimmedEditorText.length === 0 || prefixCompatible;

		this.runtime.setSuggestion(text);
		this.runtime.setPanelSuggestionStatus(
			getGhostSuggestionStatus({
				restored: options?.restore,
				canGhostInEditor,
				ghostAcceptKeys: this.runtime.ghostAcceptKeys,
				ghostAcceptAndSendKeys: this.runtime.ghostAcceptAndSendKeys,
			}),
		);
		refreshSuggesterUi(this.runtime);
	}

	public async clearSuggestion(options?: {
		generationId?: number;
	}): Promise<void> {
		if (
			options?.generationId !== undefined &&
			options.generationId !== this.runtime.getEpoch()
		)
			return;
		this.runtime.setSuggestion(undefined);
		this.runtime.setPanelSuggestionStatus(undefined);
		refreshSuggesterUi(this.runtime);
	}

	public async setUsage(usage: {
		suggester: SuggestionUsageStats;
		seeder: SuggestionUsageStats;
	}): Promise<void> {
		const ctx = getActiveUiContext(this.runtime);
		if (!ctx) return;
		if (usage.suggester.calls <= 0 && usage.seeder.calls <= 0) {
			this.runtime.setPanelUsageStatus(undefined);
			refreshSuggesterUi(this.runtime);
			return;
		}
		this.runtime.setPanelUsageStatus(
			formatUsage(usage, this.runtime.getSuggesterModelDisplay()),
		);
		refreshSuggesterUi(this.runtime);
	}
}
