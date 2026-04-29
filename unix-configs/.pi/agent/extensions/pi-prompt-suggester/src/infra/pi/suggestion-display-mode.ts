import type { GhostAcceptKey, SuggestionDisplayMode } from "../../config/types.js";
import { formatGhostAcceptKeys } from "./ghost-accept-keys.js";

export function isSuggestionDisplayMode(value: string): value is SuggestionDisplayMode {
	return value === "ghost" || value === "widget";
}

export function usesGhostEditor(displayMode: SuggestionDisplayMode): boolean {
	return displayMode === "ghost";
}

export function usesWidgetSuggestion(displayMode: SuggestionDisplayMode): boolean {
	return displayMode === "widget";
}

export function getSuggestionStatusText(params: {
	displayMode: SuggestionDisplayMode;
	restored?: boolean;
	canGhostInEditor: boolean;
	ghostAcceptKeys?: readonly GhostAcceptKey[];
}): string {
	const statusLabel = params.restored ? "restored prompt suggestion" : "prompt suggestion";
	if (!usesGhostEditor(params.displayMode)) return statusLabel;
	return `${statusLabel}${params.canGhostInEditor ? ` · ${formatGhostAcceptKeys(params.ghostAcceptKeys)} accepts` : " · ghost hidden"}`;
}
