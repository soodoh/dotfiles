import test from "node:test";
import assert from "node:assert/strict";
import { TranscriptPromptContextBuilder } from "../../dist/app/services/transcript-prompt-context-builder.js";

const baseConfig = {
	schemaVersion: 7,
	seed: { maxDiffChars: 3000 },
	reseed: { enabled: true, checkOnSessionStart: true, checkAfterEveryTurn: true, turnCheckInterval: 10 },
	suggestion: {
		noSuggestionToken: "[no suggestion]",
		customInstruction: "Prefer terse confirmations.",
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
		strategy: "compact",
		transcriptMaxContextPercent: 70,
		transcriptMaxMessages: 120,
		transcriptMaxChars: 120000,
		transcriptRolloutPercent: 100,
	},
	steering: { historyWindow: 20, acceptedThreshold: 0.82, maxChangedExamples: 2 },
	logging: { level: "info" },
	inference: {
		seederModel: "session-default",
		suggesterModel: "session-default",
		seederThinking: "session-default",
		suggesterThinking: "session-default",
	},
};

test("TranscriptPromptContextBuilder preserves transcript metadata and slices changed examples", () => {
	const builder = new TranscriptPromptContextBuilder(baseConfig, {
		getActiveTranscript() {
			return {
				systemPrompt: "system prompt",
				sessionId: "session-123",
				contextUsagePercent: 42,
				messages: [
					{ role: "user", timestamp: 1, content: [{ type: "text", text: "fix the tests" }] },
					{
						role: "assistant",
						api: "openai-responses",
						provider: "openai",
						model: "gpt-5",
						usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
						stopReason: "stop",
						timestamp: 2,
						content: [{ type: "text", text: "I can do that." }],
					},
				],
			};
		},
	});

	const context = builder.build(
		null,
		{
			recentChanged: [
				{ suggestedPrompt: "Yes.", actualUserPrompt: "Write tests first.", classification: "changed_course", similarity: 0.2, timestamp: "2026-03-15T00:00:00.000Z", turnId: "1" },
				{ suggestedPrompt: "Proceed.", actualUserPrompt: "Use pnpm.", classification: "changed_course", similarity: 0.1, timestamp: "2026-03-15T00:01:00.000Z", turnId: "2" },
				{ suggestedPrompt: "Ship it.", actualUserPrompt: "No, add tests.", classification: "changed_course", similarity: 0.1, timestamp: "2026-03-15T00:02:00.000Z", turnId: "3" },
			],
		},
	);

	assert.equal(context.systemPrompt, "system prompt");
	assert.equal(context.sessionId, "session-123");
	assert.equal(context.contextUsagePercent, 42);
	assert.equal(context.transcriptMessageCount, 2);
	assert.equal(context.transcriptMessages[0].content[0].text, "fix the tests");
	assert.equal(context.transcriptCharCount > 0, true);
	assert.equal(context.recentChanged.length, 2);
	assert.equal(context.customInstruction, "Prefer terse confirmations.");
	assert.equal(context.noSuggestionToken, "[no suggestion]");
});

test("TranscriptPromptContextBuilder throws when transcript is unavailable", () => {
	const builder = new TranscriptPromptContextBuilder(baseConfig, {
		getActiveTranscript() {
			return undefined;
		},
	});

	assert.throws(() => builder.build(null, { recentChanged: [] }), /No active session transcript available/);
});
