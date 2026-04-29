import test from "node:test";
import assert from "node:assert/strict";
import { TurnEndOrchestrator } from "../../dist/app/orchestrators/turn-end.js";
import { INITIAL_RUNTIME_STATE } from "../../dist/domain/state.js";

function createConfig() {
	return {
		schemaVersion: 7,
		seed: { maxDiffChars: 3000 },
		reseed: { enabled: true, checkOnSessionStart: true, checkAfterEveryTurn: true, turnCheckInterval: 10 },
		suggestion: {
			noSuggestionToken: "[no suggestion]",
			customInstruction: "",
			fastPathContinueOnError: true,
			displayMode: "ghost",
			maxAssistantTurnChars: 100000,
			maxRecentUserPrompts: 20,
			maxRecentUserPromptChars: 500,
			maxToolSignals: 8,
			maxToolSignalChars: 240,
			maxTouchedFiles: 8,
			maxUnresolvedQuestions: 6,
			maxAbortContextChars: 280,
			maxSuggestionChars: 200,
			prefillOnlyWhenEditorEmpty: true,
			strategy: "transcript-steering",
			transcriptMaxContextPercent: 70,
			transcriptMaxMessages: 120,
			transcriptMaxChars: 120000,
			transcriptRolloutPercent: 100,
		},
		steering: { historyWindow: 20, acceptedThreshold: 0.82, maxChangedExamples: 3 },
		logging: { level: "info" },
		inference: {
			seederModel: "session-default",
			suggesterModel: "session-default",
			seederThinking: "session-default",
			suggesterThinking: "session-default",
		},
	};
}

test("TurnEndOrchestrator records usage and persists transcript-steering suggestion metadata", async () => {
	let savedState;
	const usageCalls = [];
	const shown = [];
	const logEvents = [];
	const baseState = {
		...INITIAL_RUNTIME_STATE,
		pendingNextTurnObservation: {
			suggestionTurnId: "prev-turn",
			suggestionShownAt: "2026-03-15T00:00:00.000Z",
			userPromptSubmittedAt: "2026-03-15T00:01:00.000Z",
			variantName: "experiment",
			strategy: "transcript-steering",
			requestedStrategy: "transcript-steering",
		},
	};
	const orchestrator = new TurnEndOrchestrator({
		config: createConfig(),
		seedStore: { async load() { return null; } },
		stateStore: {
			async load() { return baseState; },
			async save(state) { savedState = state; },
			async recordUsage(kind, usage) { usageCalls.push({ kind, usage }); },
		},
		stalenessChecker: { async check() { return { stale: false, trigger: undefined }; } },
		reseedRunner: { async trigger() {} },
		suggestionEngine: {
			async suggest() {
				return {
					kind: "suggestion",
					text: "Go ahead.",
					usage: { inputTokens: 10, outputTokens: 3, cacheReadTokens: 9, cacheWriteTokens: 1, totalTokens: 13, costTotal: 0.02 },
					metadata: { requestedStrategy: "transcript-steering", strategy: "transcript-steering", transcriptMessageCount: 12, transcriptCharCount: 400 },
				};
			},
		},
		suggestionSink: {
			async showSuggestion(text) { shown.push(text); },
			async clearSuggestion() {},
			async setUsage() {},
		},
		logger: {
			debug(message, meta) { logEvents.push({ level: "debug", message, meta }); },
			info(message, meta) { logEvents.push({ level: "info", message, meta }); },
			warn(message, meta) { logEvents.push({ level: "warn", message, meta }); },
			error(message, meta) { logEvents.push({ level: "error", message, meta }); },
		},
		checkForStaleness: false,
		variantStore: {
			getActiveVariantName() { return "experiment"; },
			getEffectiveConfig() { return createConfig(); },
		},
	});

	await orchestrator.handle({
		turnId: "turn-2",
		sourceLeafId: "leaf-2",
		assistantText: "Done.",
		assistantUsage: { inputTokens: 20, outputTokens: 5, cacheReadTokens: 18, cacheWriteTokens: 0, totalTokens: 25, costTotal: 0.03 },
		status: "success",
		occurredAt: "2026-03-15T00:02:00.000Z",
		recentUserPrompts: ["Run it"],
		toolSignals: [],
		touchedFiles: [],
		unresolvedQuestions: [],
	});

	assert.deepEqual(shown, ["Go ahead."]);
	assert.equal(usageCalls.length, 1);
	assert.equal(usageCalls[0].kind, "suggester");
	assert.equal(savedState.lastSuggestion.variantName, "experiment");
	assert.equal(savedState.lastSuggestion.strategy, "transcript-steering");
	assert.equal(savedState.lastSuggestion.requestedStrategy, "transcript-steering");
	assert.equal(savedState.pendingNextTurnObservation, undefined);
	assert.equal(logEvents.some((entry) => entry.message === "suggestion.next_turn.cache_observed"), true);
	assert.equal(logEvents.some((entry) => entry.message === "suggestion.generated" && entry.meta.variantName === "experiment"), true);
});
