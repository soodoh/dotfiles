import { describe, expect, test, vi } from "vitest";
import { UserSubmitOrchestrator } from "../../src/app/orchestrators/user-submit";
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

describe("UserSubmitOrchestrator", () => {
	test("clears suggestion and records steering when a user submits a prompt", async () => {
		let savedState: RuntimeState | undefined;
		const clearSuggestion = vi.fn(async () => true);
		const state: RuntimeState = {
			...INITIAL_RUNTIME_STATE,
			lastSuggestion: {
				text: "Run the focused tests.",
				shownAt: "2026-05-01T00:00:00.000Z",
				turnId: "suggestion-turn",
				sourceLeafId: "leaf-1",
				variantName: "default",
				strategy: "transcript-steering",
				requestedStrategy: "transcript-steering",
			},
		};
		const orchestrator = new UserSubmitOrchestrator({
			stateStore: {
				async load() {
					return state;
				},
				async save(nextState) {
					savedState = nextState;
				},
				async recordUsage() {},
			},
			steeringClassifier: {
				classify() {
					return { classification: "accepted_edited", similarity: 0.9 };
				},
			},
			clock: { nowIso: () => "2026-05-01T00:01:00.000Z" },
			logger: logger(),
			suggestionSink: {
				async setUsage() {},
				async showSuggestion() {
					return true;
				},
				clearSuggestion,
			},
			historyWindow: 5,
		});

		await orchestrator.handle({
			turnId: "input-turn",
			userPrompt: "Run tests now.",
			source: "interactive",
		});

		expect(clearSuggestion).toHaveBeenCalled();
		expect(savedState?.lastSuggestion).toBeUndefined();
		expect(savedState?.pendingNextTurnObservation).toMatchObject({
			suggestionTurnId: "suggestion-turn",
			userPromptSubmittedAt: "2026-05-01T00:01:00.000Z",
		});
		expect(savedState?.steeringHistory).toHaveLength(1);
		expect(savedState?.steeringHistory[0]).toMatchObject({
			turnId: "suggestion-turn",
			actualUserPrompt: "Run tests now.",
			classification: "accepted_edited",
			similarity: 0.9,
		});
	});

	test("ignores extension-originated submissions", async () => {
		const load = vi.fn(async () => INITIAL_RUNTIME_STATE);
		const clearSuggestion = vi.fn(async () => true);
		const orchestrator = new UserSubmitOrchestrator({
			stateStore: { load, async save() {}, async recordUsage() {} },
			steeringClassifier: {
				classify() {
					return { classification: "changed_course", similarity: 0 };
				},
			},
			clock: { nowIso: () => "2026-05-01T00:01:00.000Z" },
			logger: logger(),
			suggestionSink: {
				async setUsage() {},
				async showSuggestion() {
					return true;
				},
				clearSuggestion,
			},
			historyWindow: 5,
		});

		await orchestrator.handle({
			turnId: "input-turn",
			userPrompt: "anything",
			source: "extension",
		});

		expect(load).not.toHaveBeenCalled();
		expect(clearSuggestion).not.toHaveBeenCalled();
	});
});
