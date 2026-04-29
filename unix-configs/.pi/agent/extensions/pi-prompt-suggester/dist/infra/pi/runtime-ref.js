export class RuntimeRef {
    currentContext;
    generationEpoch = 0;
    currentSuggestion;
    suggestionRevision = 0;
    lastTurnContext;
    lastBootstrappedLeafId;
    panelSuggestionStatus;
    panelUsageStatus;
    panelLogStatus;
    editorHistoryState = { entries: [], index: -1 };
    setContext(ctx) {
        this.currentContext = ctx;
    }
    getContext() {
        return this.currentContext;
    }
    bumpEpoch() {
        this.generationEpoch += 1;
        return this.generationEpoch;
    }
    getEpoch() {
        return this.generationEpoch;
    }
    setSuggestion(text) {
        this.currentSuggestion = text?.trim() || undefined;
        this.suggestionRevision += 1;
    }
    getSuggestion() {
        return this.currentSuggestion;
    }
    getSuggestionRevision() {
        return this.suggestionRevision;
    }
    setLastTurnContext(turn) {
        this.lastTurnContext = turn;
    }
    getLastTurnContext() {
        return this.lastTurnContext;
    }
    getLastBootstrappedLeafId() {
        return this.lastBootstrappedLeafId;
    }
    markBootstrappedLeafId(leafId) {
        this.lastBootstrappedLeafId = leafId;
    }
    setPanelSuggestionStatus(text) {
        this.panelSuggestionStatus = text?.trim() || undefined;
    }
    getPanelSuggestionStatus() {
        return this.panelSuggestionStatus;
    }
    setPanelUsageStatus(text) {
        this.panelUsageStatus = text?.trim() || undefined;
    }
    getPanelUsageStatus() {
        return this.panelUsageStatus;
    }
    setPanelLogStatus(status) {
        this.panelLogStatus = status;
    }
    getPanelLogStatus() {
        return this.panelLogStatus;
    }
    setEditorHistoryState(state) {
        const entries = state.entries.map((entry) => entry.trim()).filter(Boolean);
        const maxIndex = entries.length - 1;
        const index = entries.length === 0 ? -1 : Math.max(-1, Math.min(state.index, maxIndex));
        this.editorHistoryState = { entries, index };
    }
    getEditorHistoryState() {
        return {
            entries: [...this.editorHistoryState.entries],
            index: this.editorHistoryState.index,
        };
    }
}
