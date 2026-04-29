export class UserSubmitOrchestrator {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async handle(ctx) {
        if (ctx.source === "extension")
            return;
        const state = await this.deps.stateStore.load();
        await this.deps.suggestionSink.clearSuggestion();
        if (!state.lastSuggestion)
            return;
        if (!ctx.userPrompt.trim())
            return;
        const nowIso = this.deps.clock.nowIso();
        const result = this.deps.steeringClassifier.classify(state.lastSuggestion.text, ctx.userPrompt);
        const steeringHistory = [
            ...state.steeringHistory,
            {
                turnId: state.lastSuggestion.turnId,
                suggestedPrompt: state.lastSuggestion.text,
                actualUserPrompt: ctx.userPrompt,
                classification: result.classification,
                similarity: result.similarity,
                timestamp: nowIso,
            },
        ].slice(-this.deps.historyWindow);
        await this.deps.stateStore.save({
            ...state,
            lastSuggestion: undefined,
            pendingNextTurnObservation: {
                suggestionTurnId: state.lastSuggestion.turnId,
                suggestionShownAt: state.lastSuggestion.shownAt,
                userPromptSubmittedAt: nowIso,
                variantName: state.lastSuggestion.variantName,
                strategy: state.lastSuggestion.strategy,
                requestedStrategy: state.lastSuggestion.requestedStrategy,
            },
            steeringHistory,
        });
        this.deps.logger.info("steering.recorded", {
            classification: result.classification,
            similarity: result.similarity,
            variantName: state.lastSuggestion.variantName,
            strategy: state.lastSuggestion.strategy,
            requestedStrategy: state.lastSuggestion.requestedStrategy,
        });
    }
}
