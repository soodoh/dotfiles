import { formatGhostAcceptKeys } from "./ghost-accept-keys.js";
export function isSuggestionDisplayMode(value) {
    return value === "ghost" || value === "widget";
}
export function usesGhostEditor(displayMode) {
    return displayMode === "ghost";
}
export function usesWidgetSuggestion(displayMode) {
    return displayMode === "widget";
}
export function getSuggestionStatusText(params) {
    const statusLabel = params.restored ? "restored prompt suggestion" : "prompt suggestion";
    if (!usesGhostEditor(params.displayMode))
        return statusLabel;
    return `${statusLabel}${params.canGhostInEditor ? ` · ${formatGhostAcceptKeys(params.ghostAcceptKeys)} accepts` : " · ghost hidden"}`;
}
