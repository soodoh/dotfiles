import { getConfiguredModelDisplay } from "./display.js";
export function createUiContext(params) {
    const { runtimeRef, config, variantStore, getSessionThinkingLevel } = params;
    return {
        getContext: () => runtimeRef.getContext(),
        getEpoch: () => runtimeRef.getEpoch(),
        getSuggestion: () => runtimeRef.getSuggestion(),
        setSuggestion: (text) => runtimeRef.setSuggestion(text),
        getPanelSuggestionStatus: () => runtimeRef.getPanelSuggestionStatus(),
        setPanelSuggestionStatus: (text) => runtimeRef.setPanelSuggestionStatus(text),
        getPanelUsageStatus: () => runtimeRef.getPanelUsageStatus(),
        setPanelUsageStatus: (text) => runtimeRef.setPanelUsageStatus(text),
        getPanelLogStatus: () => runtimeRef.getPanelLogStatus(),
        setPanelLogStatus: (status) => runtimeRef.setPanelLogStatus(status),
        getSuggesterModelDisplay: () => {
            const effectiveConfig = variantStore?.getEffectiveConfig(config) ?? config;
            return getConfiguredModelDisplay({
                ctx: runtimeRef.getContext(),
                configuredModel: effectiveConfig.inference.suggesterModel,
                configuredThinking: effectiveConfig.inference.suggesterThinking,
                getSessionThinkingLevel,
            });
        },
        get suggestionDisplayMode() {
            return config.suggestion.displayMode;
        },
        get ghostAcceptKeys() {
            return config.suggestion.ghostAcceptKeys;
        },
        get prefillOnlyWhenEditorEmpty() {
            return config.suggestion.prefillOnlyWhenEditorEmpty;
        },
        get showUsageInPanel() {
            return config.suggestion.showUsageInPanel;
        },
        get showPanelStatus() {
            return config.suggestion.showPanelStatus;
        },
    };
}
