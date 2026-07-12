import { expect, test } from "vitest";
import { TranscriptPromptContextBuilder } from "../../src/app/services/transcript-prompt-context-builder";
import type { PromptSuggesterConfig } from "../../src/config/types";

const baseConfig: PromptSuggesterConfig = {
	schemaVersion: 8,
	seed: { maxDiffChars: 3000 },
	reseed: {
		enabled: true,
		checkOnSessionStart: true,
		checkAfterEveryTurn: true,
		turnCheckInterval: 10,
	},
	suggestion: {
		noSuggestionToken: "[no suggestion]",
		customInstruction: "Prefer terse confirmations.",
		fastPathContinueOnError: true,
		ghostAcceptKeys: ["right"],
		ghostAcceptAndSendKeys: ["enter"],
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
	steering: {
		historyWindow: 20,
		acceptedThreshold: 0.82,
		maxChangedExamples: 2,
	},
	logging: { level: "info" },
	inference: {
		seederModel: "session-default",
		suggesterModel: ["session-default"],
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
					{
						role: "user",
						timestamp: 1,
						content: [{ type: "text", text: "fix the tests" }],
					},
					{
						role: "assistant",
						api: "openai-responses",
						provider: "openai",
						model: "gpt-5",
						usage: {
							input: 1,
							output: 1,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 2,
							cost: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
								total: 0,
							},
						},
						stopReason: "stop",
						timestamp: 2,
						content: [{ type: "text", text: "I can do that." }],
					},
				],
			};
		},
	});

	const context = builder.build(null, {
		recentChanged: [
			{
				suggestedPrompt: "Yes.",
				actualUserPrompt: "Write tests first.",
				classification: "changed_course",
				similarity: 0.2,
				timestamp: "2026-03-15T00:00:00.000Z",
				turnId: "1",
			},
			{
				suggestedPrompt: "Proceed.",
				actualUserPrompt: "Use pnpm.",
				classification: "changed_course",
				similarity: 0.1,
				timestamp: "2026-03-15T00:01:00.000Z",
				turnId: "2",
			},
			{
				suggestedPrompt: "Ship it.",
				actualUserPrompt: "No, add tests.",
				classification: "changed_course",
				similarity: 0.1,
				timestamp: "2026-03-15T00:02:00.000Z",
				turnId: "3",
			},
		],
	});

	expect(context.systemPrompt).toBe("system prompt");
	expect(context.sessionId).toBe("session-123");
	expect(context.contextUsagePercent).toBe(42);
	expect(context.transcriptMessageCount).toBe(2);
	const firstContent = context.transcriptMessages[0].content[0];
	expect(
		typeof firstContent === "object" && firstContent.type === "text"
			? firstContent.text
			: "",
	).toBe("fix the tests");
	expect(context.transcriptCharCount > 0).toBe(true);
	expect(context.recentChanged.length).toBe(2);
	expect(context.customInstruction).toBe("Prefer terse confirmations.");
	expect(context.noSuggestionToken).toBe("[no suggestion]");
});

test("TranscriptPromptContextBuilder applies transcript message cap to most recent messages", () => {
	const builder = new TranscriptPromptContextBuilder(
		{
			...baseConfig,
			suggestion: { ...baseConfig.suggestion, transcriptMaxMessages: 2 },
		},
		{
			getActiveTranscript() {
				return {
					systemPrompt: "system prompt",
					messages: [
						{ role: "user", timestamp: 1, content: "oldest" },
						{ role: "user", timestamp: 2, content: "middle" },
						{ role: "user", timestamp: 3, content: "newest" },
					],
				};
			},
		},
	);

	const context = builder.build(null, { recentChanged: [] });

	expect(context.transcriptMessageCount).toBe(2);
	expect(context.transcriptMessages.map((message) => message.content)).toEqual([
		"middle",
		"newest",
	]);
});

test("TranscriptPromptContextBuilder trims oldest messages to fit transcript char cap", () => {
	const builder = new TranscriptPromptContextBuilder(
		{
			...baseConfig,
			suggestion: { ...baseConfig.suggestion, transcriptMaxChars: 9 },
		},
		{
			getActiveTranscript() {
				return {
					systemPrompt: "system prompt",
					messages: [
						{ role: "user", timestamp: 1, content: "aaaaa" },
						{ role: "user", timestamp: 2, content: "bbbb" },
						{ role: "user", timestamp: 3, content: "ccccc" },
					],
				};
			},
		},
	);

	const context = builder.build(null, { recentChanged: [] });

	expect(context.transcriptMessageCount).toBe(2);
	expect(context.transcriptCharCount).toBe(9);
	expect(context.transcriptMessages.map((message) => message.content)).toEqual([
		"bbbb",
		"ccccc",
	]);
});

test("TranscriptPromptContextBuilder truncates newest single message to fit char cap", () => {
	const builder = new TranscriptPromptContextBuilder(
		{
			...baseConfig,
			suggestion: { ...baseConfig.suggestion, transcriptMaxChars: 3 },
		},
		{
			getActiveTranscript() {
				return {
					systemPrompt: "system prompt",
					messages: [
						{ role: "user", timestamp: 1, content: "old" },
						{ role: "user", timestamp: 2, content: "toolong" },
					],
				};
			},
		},
	);

	const context = builder.build(null, { recentChanged: [] });

	expect(context.transcriptMessageCount).toBe(1);
	expect(context.transcriptCharCount).toBe(3);
	expect(context.transcriptMessages.map((message) => message.content)).toEqual([
		"too",
	]);
});

test("TranscriptPromptContextBuilder throws when transcript is unavailable", () => {
	const builder = new TranscriptPromptContextBuilder(baseConfig, {
		getActiveTranscript() {
			return undefined;
		},
	});

	expect(() => builder.build(null, { recentChanged: [] })).toThrow(
		/No active session transcript available/,
	);
});
