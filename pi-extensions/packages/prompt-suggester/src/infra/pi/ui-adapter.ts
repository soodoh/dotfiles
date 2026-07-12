import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { SuggestionSink } from "../../app/orchestrators/turn-end";
import type { SuggestionUsageStats } from "../../domain/state";
import type { UiContextLike } from "./ui-context";

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

export function refreshSuggesterUi(runtime: UiContextLike): void {
	const ctx = getActiveUiContext(runtime);
	if (!ctx) return;

	ctx.ui.setStatus("suggester", undefined);
	ctx.ui.setStatus("suggester-events", undefined);
	ctx.ui.setStatus("suggester-usage", undefined);

	const logStatus = runtime.getPanelLogStatus();
	if (!logStatus) {
		ctx.ui.setWidget("suggester-panel", undefined);
		return;
	}

	ctx.ui.setWidget(
		"suggester-panel",
		(_tui, theme) => ({
			invalidate() {},
			render(width: number): string[] {
				const line = formatPanelLog(theme, logStatus);
				const truncated = truncateToWidth(line, Math.max(10, width), "", true);
				const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
				return [truncated + pad];
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
	): Promise<boolean> {
		if (
			options?.generationId !== undefined &&
			options.generationId !== this.runtime.getEpoch()
		) {
			return false;
		}
		if (!getActiveUiContext(this.runtime)) return false;

		this.runtime.setSuggestion(text);
		this.runtime.setPanelSuggestionStatus(undefined);
		refreshSuggesterUi(this.runtime);
		return true;
	}

	public async clearSuggestion(options?: {
		generationId?: number;
	}): Promise<boolean> {
		if (
			options?.generationId !== undefined &&
			options.generationId !== this.runtime.getEpoch()
		) {
			return false;
		}
		this.runtime.setSuggestion(undefined);
		this.runtime.setPanelSuggestionStatus(undefined);
		refreshSuggesterUi(this.runtime);
		return true;
	}

	public async setUsage(_usage: {
		suggester: SuggestionUsageStats;
		seeder: SuggestionUsageStats;
	}): Promise<void> {
		this.runtime.setPanelUsageStatus(undefined);
		refreshSuggesterUi(this.runtime);
	}
}
