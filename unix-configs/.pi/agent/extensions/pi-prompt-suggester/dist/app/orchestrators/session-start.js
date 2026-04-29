export class SessionStartOrchestrator {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async handle() {
        const state = await this.deps.stateStore.load();
        await this.deps.suggestionSink.setUsage({
            suggester: state.suggestionUsage,
            seeder: state.seederUsage,
        });
        if (state.lastSuggestion) {
            await this.deps.suggestionSink.showSuggestion(state.lastSuggestion.text, { restore: true });
        }
        if (!this.deps.checkForStaleness)
            return;
        const seed = await this.deps.seedStore.load();
        const staleness = await this.deps.stalenessChecker.check(seed);
        this.deps.logger.debug("stale.check.completed", {
            stale: staleness.stale,
            reason: staleness.trigger?.reason,
        });
        if (state.turnsSinceLastStalenessCheck !== 0) {
            await this.deps.stateStore.save({
                ...state,
                turnsSinceLastStalenessCheck: 0,
            });
        }
        if (staleness.stale && staleness.trigger) {
            void this.deps.reseedRunner.trigger(staleness.trigger);
        }
    }
}
