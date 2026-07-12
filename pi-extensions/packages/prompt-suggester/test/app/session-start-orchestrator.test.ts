import { describe, expect, test, vi } from "vitest";
import { SessionStartOrchestrator } from "../../src/app/orchestrators/session-start";
import type { ReseedTrigger } from "../../src/domain/seed";
import {
	INITIAL_RUNTIME_STATE,
	type RuntimeState,
} from "../../src/domain/state";

function logger() {
	return {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

describe("SessionStartOrchestrator", () => {
	test("restores usage and last suggestion without staleness checks", async () => {
		const state: RuntimeState = {
			...INITIAL_RUNTIME_STATE,
			lastSuggestion: {
				text: "Continue by running tests.",
				shownAt: "2026-05-01T00:00:00.000Z",
				turnId: "turn-1",
				sourceLeafId: "leaf-1",
			},
		};
		const setUsage = vi.fn(async () => undefined);
		const showSuggestion = vi.fn(async () => true);
		const seedLoad = vi.fn(async () => null);
		const orchestrator = new SessionStartOrchestrator({
			seedStore: { load: seedLoad },
			stateStore: {
				async load() {
					return state;
				},
				async save() {},
				async recordUsage() {},
			},
			stalenessChecker: {
				async check() {
					return { stale: false };
				},
			},
			reseedRunner: { trigger: vi.fn(async () => undefined) },
			suggestionSink: {
				setUsage,
				showSuggestion,
				async clearSuggestion() {
					return true;
				},
			},
			logger: logger(),
			checkForStaleness: false,
		});

		await orchestrator.handle();

		expect(setUsage).toHaveBeenCalledWith({
			suggester: state.suggestionUsage,
			seeder: state.seederUsage,
		});
		expect(showSuggestion).toHaveBeenCalledWith("Continue by running tests.", {
			restore: true,
		});
		expect(seedLoad).not.toHaveBeenCalled();
	});

	test("resets staleness check counter and triggers reseed when stale", async () => {
		let savedState: RuntimeState | undefined;
		const trigger: ReseedTrigger = {
			reason: "manual",
			changedFiles: ["README.md"],
		};
		const reseedTrigger = vi.fn(async () => undefined);
		const state: RuntimeState = {
			...INITIAL_RUNTIME_STATE,
			turnsSinceLastStalenessCheck: 3,
		};
		const orchestrator = new SessionStartOrchestrator({
			seedStore: {
				async load() {
					return null;
				},
			},
			stateStore: {
				async load() {
					return state;
				},
				async save(nextState) {
					savedState = nextState;
				},
				async recordUsage() {},
			},
			stalenessChecker: {
				async check() {
					return { stale: true, trigger };
				},
			},
			reseedRunner: { trigger: reseedTrigger },
			suggestionSink: {
				async setUsage() {},
				async showSuggestion() {
					return true;
				},
				async clearSuggestion() {
					return true;
				},
			},
			logger: logger(),
			checkForStaleness: true,
		});

		await orchestrator.handle();

		expect(savedState?.turnsSinceLastStalenessCheck).toBe(0);
		expect(reseedTrigger).toHaveBeenCalledWith(trigger);
	});
});
