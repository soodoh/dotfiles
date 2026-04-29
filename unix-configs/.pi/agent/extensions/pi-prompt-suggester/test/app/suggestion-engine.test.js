import test from "node:test";
import assert from "node:assert/strict";
import { SuggestionEngine } from "../../dist/app/services/suggestion-engine.js";

function createConfig(overrides = {}) {
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
				showUsageInPanel: true,
				showPanelStatus: true,
				strategy: "compact",
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
		...overrides,
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
				showUsageInPanel: true,
				showPanelStatus: true,
				strategy: "compact",
			transcriptMaxContextPercent: 70,
			transcriptMaxMessages: 120,
			transcriptMaxChars: 120000,
			transcriptRolloutPercent: 100,
			...(overrides.suggestion ?? {}),
		},
	};
}

const turn = {
	turnId: "turn-1",
	sourceLeafId: "leaf-1",
	assistantText: "I can do that.",
	status: "success",
	occurredAt: "2026-03-15T00:00:00.000Z",
	recentUserPrompts: ["Fix the tests"],
	toolSignals: [],
	touchedFiles: [],
	unresolvedQuestions: [],
};

test("SuggestionEngine uses transcript-steering mode when eligible", async () => {
	const calls = [];
	const engine = new SuggestionEngine({
		config: createConfig({ suggestion: { strategy: "transcript-steering" } }),
		modelClient: {
			async generateSuggestion(context) {
				calls.push(context);
				return { text: "Go ahead.", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 5, cacheWriteTokens: 0, totalTokens: 2, costTotal: 0.01 } };
			},
		},
		promptContextBuilder: {
			build() {
				return { latestAssistantTurn: "compact", turnStatus: "success", intentSeed: null, recentUserPrompts: [], toolSignals: [], touchedFiles: [], unresolvedQuestions: [], recentChanged: [], customInstruction: "", noSuggestionToken: "[no suggestion]", maxSuggestionChars: 200 };
			},
		},
		transcriptPromptContextBuilder: {
			build() {
				return {
					systemPrompt: "system",
					transcriptMessages: [{ role: "user", timestamp: 1, content: [{ type: "text", text: "Fix the tests" }] }],
					transcriptMessageCount: 1,
					transcriptCharCount: 20,
					contextUsagePercent: 30,
					intentSeed: null,
					recentChanged: [],
					customInstruction: "",
					noSuggestionToken: "[no suggestion]",
					maxSuggestionChars: 200,
				};
			},
		},
	});

	const result = await engine.suggest(turn, null, { recentChanged: [] });
	assert.equal(result.kind, "suggestion");
	assert.equal(result.metadata.strategy, "transcript-steering");
	assert.equal(result.metadata.requestedStrategy, "transcript-steering");
	assert.equal("transcriptMessages" in calls[0], true);
});

test("SuggestionEngine falls back to compact mode when transcript guardrails reject the run", async () => {
	const calls = [];
	const engine = new SuggestionEngine({
		config: createConfig({ suggestion: { strategy: "transcript-steering", transcriptMaxContextPercent: 50 } }),
		modelClient: {
			async generateSuggestion(context) {
				calls.push(context);
				return { text: "Continue.", usage: undefined };
			},
		},
		promptContextBuilder: {
			build() {
				return { latestAssistantTurn: "compact", turnStatus: "success", intentSeed: null, recentUserPrompts: [], toolSignals: [], touchedFiles: [], unresolvedQuestions: [], recentChanged: [], customInstruction: "", noSuggestionToken: "[no suggestion]", maxSuggestionChars: 200 };
			},
		},
		transcriptPromptContextBuilder: {
			build() {
				return {
					systemPrompt: "system",
					transcriptMessages: [],
					transcriptMessageCount: 1,
					transcriptCharCount: 20,
					contextUsagePercent: 80,
					intentSeed: null,
					recentChanged: [],
					customInstruction: "",
					noSuggestionToken: "[no suggestion]",
					maxSuggestionChars: 200,
				};
			},
		},
	});

	const result = await engine.suggest(turn, null, { recentChanged: [] });
	assert.equal(result.kind, "suggestion");
	assert.equal(result.metadata.strategy, "compact");
	assert.equal(result.metadata.fallbackReason, "transcript_context_limit");
	assert.equal("transcriptMessages" in calls[0], false);
});

test("SuggestionEngine ignores transcript message and char counts when context usage is acceptable", async () => {
	const calls = [];
	const engine = new SuggestionEngine({
		config: createConfig({
			suggestion: {
				strategy: "transcript-steering",
				transcriptMaxContextPercent: 70,
				transcriptMaxMessages: 10,
				transcriptMaxChars: 100,
			},
		}),
		modelClient: {
			async generateSuggestion(context) {
				calls.push(context);
				return { text: "Zoom out and check the broader goal.", usage: undefined };
			},
		},
		promptContextBuilder: {
			build() {
				return { latestAssistantTurn: "compact", turnStatus: "success", intentSeed: null, recentUserPrompts: [], toolSignals: [], touchedFiles: [], unresolvedQuestions: [], recentChanged: [], customInstruction: "", noSuggestionToken: "[no suggestion]", maxSuggestionChars: 200 };
			},
		},
		transcriptPromptContextBuilder: {
			build() {
				return {
					systemPrompt: "system",
					transcriptMessages: [],
					transcriptMessageCount: 500,
					transcriptCharCount: 999999,
					contextUsagePercent: 40,
					intentSeed: null,
					recentChanged: [],
					customInstruction: "",
					noSuggestionToken: "[no suggestion]",
					maxSuggestionChars: 200,
				};
			},
		},
	});

	const result = await engine.suggest(turn, null, { recentChanged: [] });
	assert.equal(result.kind, "suggestion");
	assert.equal(result.metadata.strategy, "transcript-steering");
	assert.equal(result.metadata.fallbackReason, undefined);
	assert.equal(calls.length, 1);
	assert.equal("transcriptMessages" in calls[0], true);
});

test("SuggestionEngine falls back to compact mode when transcript rollout samples out", async () => {
	const calls = [];
	const engine = new SuggestionEngine({
		config: createConfig({ suggestion: { strategy: "transcript-steering", transcriptRolloutPercent: 0 } }),
		modelClient: {
			async generateSuggestion(context) {
				calls.push(context);
				return { text: "Continue.", usage: undefined };
			},
		},
		promptContextBuilder: {
			build() {
				return { latestAssistantTurn: "compact", turnStatus: "success", intentSeed: null, recentUserPrompts: [], toolSignals: [], touchedFiles: [], unresolvedQuestions: [], recentChanged: [], customInstruction: "", noSuggestionToken: "[no suggestion]", maxSuggestionChars: 200 };
			},
		},
		transcriptPromptContextBuilder: {
			build() {
				throw new Error("should not be used when rollout is zero");
			},
		},
	});

	const result = await engine.suggest(turn, null, { recentChanged: [] });
	assert.equal(result.kind, "suggestion");
	assert.equal(result.metadata.strategy, "compact");
	assert.equal(result.metadata.sampledOut, true);
	assert.equal(result.metadata.fallbackReason, "transcript_rollout_skip");
	assert.equal(calls.length, 1);
});

test("SuggestionEngine treats empty model output as no_suggestion", async () => {
	const engine = new SuggestionEngine({
		config: createConfig(),
		modelClient: {
			async generateSuggestion() {
				return { text: "   ", usage: undefined };
			},
		},
		promptContextBuilder: {
			build() {
				return {
					latestAssistantTurn: "compact",
					turnStatus: "success",
					intentSeed: null,
					recentUserPrompts: [],
					toolSignals: [],
					touchedFiles: [],
					unresolvedQuestions: [],
					recentChanged: [],
					customInstruction: "",
					noSuggestionToken: "[no suggestion]",
					maxSuggestionChars: 200,
				};
			},
		},
	});

	const result = await engine.suggest(turn, null, { recentChanged: [] });
	assert.equal(result.kind, "no_suggestion");
	assert.equal(result.text, "[no suggestion]");
});
