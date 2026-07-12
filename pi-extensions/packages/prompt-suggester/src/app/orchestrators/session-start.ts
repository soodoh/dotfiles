import type { Logger } from "../ports/logger";
import type { SeedStore } from "../ports/seed-store";
import type { StateStore } from "../ports/state-store";
import type { StalenessChecker } from "../services/staleness-checker";
import type { ReseedRunner } from "./reseed-runner";
import type { SuggestionSink } from "./turn-end";

interface SessionStartOrchestratorDeps {
	seedStore: Pick<SeedStore, "load">;
	stateStore: StateStore;
	stalenessChecker: Pick<StalenessChecker, "check">;
	reseedRunner: Pick<ReseedRunner, "trigger">;
	suggestionSink: SuggestionSink;
	logger: Logger;
	checkForStaleness: boolean;
}

export class SessionStartOrchestrator {
	public constructor(private readonly deps: SessionStartOrchestratorDeps) {}

	public async handle(): Promise<void> {
		const state = await this.deps.stateStore.load();
		await this.deps.suggestionSink.setUsage({
			suggester: state.suggestionUsage,
			seeder: state.seederUsage,
		});
		if (state.lastSuggestion) {
			await this.deps.suggestionSink.showSuggestion(state.lastSuggestion.text, {
				restore: true,
			});
		}

		if (!this.deps.checkForStaleness) return;
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
