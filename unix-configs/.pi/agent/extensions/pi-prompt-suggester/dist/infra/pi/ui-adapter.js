import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { formatTokens } from "./display.js";
import { getSuggestionStatusText, usesGhostEditor, usesWidgetSuggestion } from "./suggestion-display-mode.js";
export const WIDGET_ACCEPT_SHORTCUT_LABEL = "F2 accepts";
function formatUsage(usage, suggesterModelDisplay) {
    const combinedInput = usage.suggester.inputTokens + usage.seeder.inputTokens;
    const combinedOutput = usage.suggester.outputTokens + usage.seeder.outputTokens;
    const combinedCacheRead = usage.suggester.cacheReadTokens + usage.seeder.cacheReadTokens;
    const combinedCost = usage.suggester.costTotal + usage.seeder.costTotal;
    const suffix = suggesterModelDisplay ? `, suggester: ${suggesterModelDisplay}` : "";
    return `suggester usage: ↑${formatTokens(combinedInput)} ↓${formatTokens(combinedOutput)} R${formatTokens(combinedCacheRead)} $${combinedCost.toFixed(3)} (${usage.suggester.calls} sugg, ${usage.seeder.calls} seed)${suffix}`;
}
function formatPanelLog(ctx, status) {
    const theme = ctx.ui.theme;
    if (status.level === "error")
        return theme.fg("error", status.text);
    if (status.level === "warn")
        return theme.fg("warning", status.text);
    if (status.level === "debug")
        return theme.fg("dim", status.text);
    return theme.fg("muted", status.text);
}
export function refreshSuggesterUi(runtime) {
    const ctx = runtime.getContext();
    if (!ctx?.hasUI)
        return;
    ctx.ui.setStatus("suggester", undefined);
    ctx.ui.setStatus("suggester-events", undefined);
    ctx.ui.setStatus("suggester-usage", undefined);
    const widgetMode = usesWidgetSuggestion(runtime.suggestionDisplayMode);
    const suggestionText = widgetMode ? runtime.getSuggestion() : undefined;
    const suggestionStatus = runtime.showPanelStatus && widgetMode ? runtime.getPanelSuggestionStatus() : undefined;
    const suggestionHint = suggestionText ? themeHintText(widgetMode) : undefined;
    const usageStatus = runtime.showUsageInPanel ? runtime.getPanelUsageStatus() : undefined;
    const logStatus = runtime.getPanelLogStatus();
    if (!suggestionText && !suggestionStatus && !logStatus && !usageStatus) {
        ctx.ui.setWidget("suggester-panel", undefined);
        return;
    }
    ctx.ui.setWidget("suggester-panel", (_tui, theme) => ({
        invalidate() { },
        render(width) {
            const lines = [];
            if (suggestionText) {
                const sourceLines = suggestionText.split("\n");
                for (let index = 0; index < sourceLines.length; index += 1) {
                    const prefix = index === 0 ? "✦ " : "  ";
                    const wrapped = wrapTextWithAnsi(theme.fg("accent", `${prefix}${sourceLines[index] ?? ""}`), Math.max(10, width));
                    for (const wrappedLine of wrapped.length > 0 ? wrapped : [theme.fg("accent", prefix.trimEnd())]) {
                        const truncated = truncateToWidth(wrappedLine, Math.max(10, width), "", true);
                        const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
                        lines.push(truncated + pad);
                    }
                }
            }
            const parts = [];
            if (suggestionStatus)
                parts.push(theme.fg("accent", suggestionStatus));
            if (suggestionHint)
                parts.push(theme.fg("muted", suggestionHint));
            if (logStatus)
                parts.push(formatPanelLog(ctx, logStatus));
            const line = parts.join(" · ");
            if (line) {
                const truncated = truncateToWidth(line, Math.max(10, width), "", true);
                const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
                lines.push(truncated + pad);
            }
            if (usageStatus) {
                const truncated = truncateToWidth(theme.fg("dim", usageStatus), Math.max(10, width), "", true);
                const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
                lines.push(truncated + pad);
            }
            return lines.length > 0 ? lines : [" ".repeat(Math.max(1, width))];
        },
    }), { placement: "belowEditor" });
}
function themeHintText(widgetMode) {
    return widgetMode ? WIDGET_ACCEPT_SHORTCUT_LABEL : undefined;
}
export function acceptWidgetSuggestion(runtime) {
    const ctx = runtime.getContext();
    if (!ctx?.hasUI || !usesWidgetSuggestion(runtime.suggestionDisplayMode))
        return "unavailable";
    const suggestion = runtime.getSuggestion();
    if (!suggestion)
        return "missing-suggestion";
    const editorText = ctx.ui.getEditorText();
    if (editorText.length > 0 && !suggestion.startsWith(editorText))
        return "mismatch";
    ctx.ui.setEditorText(suggestion);
    runtime.setSuggestion(undefined);
    runtime.setPanelSuggestionStatus(undefined);
    refreshSuggesterUi(runtime);
    return "accepted";
}
export class PiSuggestionSink {
    runtime;
    constructor(runtime) {
        this.runtime = runtime;
    }
    async showSuggestion(text, options) {
        if (options?.generationId !== undefined && options.generationId !== this.runtime.getEpoch())
            return;
        const ctx = this.runtime.getContext();
        if (!ctx?.hasUI)
            return;
        const editorText = ctx.ui.getEditorText();
        const trimmedEditorText = editorText.trim();
        const isMultilineSuggestion = text.includes("\n");
        const prefixCompatible = !editorText.includes("\n") && text.startsWith(editorText);
        const canGhostInEditor = usesGhostEditor(this.runtime.suggestionDisplayMode) && (isMultilineSuggestion
            ? trimmedEditorText.length === 0
            : this.runtime.prefillOnlyWhenEditorEmpty
                ? trimmedEditorText.length === 0
                : trimmedEditorText.length === 0 || prefixCompatible);
        this.runtime.setSuggestion(text);
        this.runtime.setPanelSuggestionStatus(getSuggestionStatusText({
            displayMode: this.runtime.suggestionDisplayMode,
            restored: options?.restore,
            canGhostInEditor,
            ghostAcceptKeys: this.runtime.ghostAcceptKeys,
        }));
        refreshSuggesterUi(this.runtime);
    }
    async clearSuggestion(options) {
        if (options?.generationId !== undefined && options.generationId !== this.runtime.getEpoch())
            return;
        this.runtime.setSuggestion(undefined);
        this.runtime.setPanelSuggestionStatus(undefined);
        refreshSuggesterUi(this.runtime);
    }
    async setUsage(usage) {
        const ctx = this.runtime.getContext();
        if (!ctx?.hasUI)
            return;
        if (usage.suggester.calls <= 0 && usage.seeder.calls <= 0) {
            this.runtime.setPanelUsageStatus(undefined);
            refreshSuggesterUi(this.runtime);
            return;
        }
        this.runtime.setPanelUsageStatus(formatUsage(usage, this.runtime.getSuggesterModelDisplay()));
        refreshSuggesterUi(this.runtime);
    }
}
