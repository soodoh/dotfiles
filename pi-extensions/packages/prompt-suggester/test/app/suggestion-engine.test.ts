import type { Message } from "@mariozechner/pi-ai";
import { expect, test } from "vitest";
import type { ModelClient } from "../../src/app/ports/model-client";
import type { SessionTranscriptProvider } from "../../src/app/ports/session-transcript";
import { PromptContextBuilder } from "../../src/app/services/prompt-context-builder";
import { SuggestionEngine } from "../../src/app/services/suggestion-engine";
import { TranscriptPromptContextBuilder } from "../../src/app/services/transcript-prompt-context-builder";
import type {
	PromptSuggesterConfig,
	SuggestionConfig,
} from "../../src/config/types";
import type { TurnContext } from "../../src/domain/suggestion";

type ConfigOverrides = Omit<Partial<PromptSuggesterConfig>, "suggestion"> & {
	suggestion?: Partial<SuggestionConfig>;
};

function createConfig(overrides: ConfigOverrides = {}): PromptSuggesterConfig {
	return {
		schemaVersion: 8,
		seed: { maxDiffChars: 3000 },
		reseed: {
			enabled: true,
			checkOnSessionStart: true,
			checkAfterEveryTurn: true,
			turnCheckInterval: 10,
		},
		steering: {
			historyWindow: 20,
			acceptedThreshold: 0.82,
			maxChangedExamples: 3,
		},
		logging: { level: "info" },
		inference: {
			seederModel: "session-default",
			suggesterModel: ["session-default"],
			seederThinking: "session-default",
			suggesterThinking: "session-default",
		},
		...overrides,
		suggestion: {
			noSuggestionToken: "[no suggestion]",
			customInstruction: "",
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
			...overrides.suggestion,
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
} satisfies TurnContext;

function createModelClient(
	generateSuggestion: ModelClient["generateSuggestion"],
): ModelClient {
	return {
		async generateSeed() {
			throw new Error("seed generation is not used by these tests");
		},
		generateSuggestion,
	};
}

function createTranscriptBuilder(
	config: PromptSuggesterConfig,
	overrides: {
		contextUsagePercent?: number;
		messages?: Message[];
		systemPrompt?: string;
	} = {},
): TranscriptPromptContextBuilder {
	const transcriptProvider: SessionTranscriptProvider = {
		getActiveTranscript() {
			return {
				systemPrompt: overrides.systemPrompt ?? "system",
				messages: overrides.messages ?? [
					{
						role: "user",
						timestamp: 1,
						content: "Fix the tests",
					},
				],
				contextUsagePercent: overrides.contextUsagePercent,
			};
		},
	};
	return new TranscriptPromptContextBuilder(config, transcriptProvider);
}

function createEngine(
	config: PromptSuggesterConfig,
	generateSuggestion: ModelClient["generateSuggestion"],
	transcriptPromptContextBuilder?: TranscriptPromptContextBuilder,
): SuggestionEngine {
	return new SuggestionEngine({
		config,
		modelClient: createModelClient(generateSuggestion),
		promptContextBuilder: new PromptContextBuilder(config),
		transcriptPromptContextBuilder,
	});
}

test("SuggestionEngine uses transcript-steering mode when eligible", async () => {
	const config = createConfig({
		suggestion: { strategy: "transcript-steering" },
	});
	const calls: Parameters<ModelClient["generateSuggestion"]>[0][] = [];
	const engine = createEngine(
		config,
		async (context) => {
			calls.push(context);
			return {
				text: "Go ahead.",
				usage: {
					inputTokens: 1,
					outputTokens: 1,
					cacheReadTokens: 5,
					cacheWriteTokens: 0,
					totalTokens: 2,
					costTotal: 0.01,
				},
			};
		},
		createTranscriptBuilder(config, { contextUsagePercent: 30 }),
	);

	const result = await engine.suggest(turn, null, { recentChanged: [] });
	expect(result.kind).toBe("suggestion");
	expect(result.metadata).toMatchObject({
		strategy: "transcript-steering",
		requestedStrategy: "transcript-steering",
	});
	expect("transcriptMessages" in calls[0]).toBe(true);
});

test("SuggestionEngine falls back to compact mode when transcript guardrails reject the run", async () => {
	const config = createConfig({
		suggestion: {
			strategy: "transcript-steering",
			transcriptMaxContextPercent: 50,
		},
	});
	const calls: Parameters<ModelClient["generateSuggestion"]>[0][] = [];
	const engine = createEngine(
		config,
		async (context) => {
			calls.push(context);
			return { text: "Continue.", usage: undefined };
		},
		createTranscriptBuilder(config, { contextUsagePercent: 80 }),
	);

	const result = await engine.suggest(turn, null, { recentChanged: [] });
	expect(result.kind).toBe("suggestion");
	expect(result.metadata).toMatchObject({
		strategy: "compact",
		fallbackReason: "transcript_context_limit",
	});
	expect("transcriptMessages" in calls[0]).toBe(false);
});

test("SuggestionEngine ignores transcript message and char counts when context usage is acceptable", async () => {
	const config = createConfig({
		suggestion: {
			strategy: "transcript-steering",
			transcriptMaxContextPercent: 70,
			transcriptMaxMessages: 10,
			transcriptMaxChars: 100,
		},
	});
	const calls: Parameters<ModelClient["generateSuggestion"]>[0][] = [];
	const engine = createEngine(
		config,
		async (context) => {
			calls.push(context);
			return {
				text: "Zoom out and check the broader goal.",
				usage: undefined,
			};
		},
		createTranscriptBuilder(config, {
			contextUsagePercent: 40,
			messages: Array.from({ length: 500 }, () => ({
				role: "user",
				timestamp: 1,
				content: "large transcript entry",
			})),
		}),
	);

	const result = await engine.suggest(turn, null, { recentChanged: [] });
	expect(result.kind).toBe("suggestion");
	expect(result.metadata).toMatchObject({ strategy: "transcript-steering" });
	expect(result.metadata?.fallbackReason).toBe(undefined);
	expect(calls.length).toBe(1);
	expect("transcriptMessages" in calls[0]).toBe(true);
});

test("SuggestionEngine falls back to compact mode when transcript rollout samples out", async () => {
	const config = createConfig({
		suggestion: {
			strategy: "transcript-steering",
			transcriptRolloutPercent: 0,
		},
	});
	const calls: Parameters<ModelClient["generateSuggestion"]>[0][] = [];
	const engine = createEngine(
		config,
		async (context) => {
			calls.push(context);
			return { text: "Continue.", usage: undefined };
		},
		createTranscriptBuilder(config, { systemPrompt: "should not be read" }),
	);

	const result = await engine.suggest({ ...turn, turnId: "" }, null, {
		recentChanged: [],
	});
	expect(result.kind).toBe("suggestion");
	expect(result.metadata).toMatchObject({
		strategy: "compact",
		sampledOut: true,
		fallbackReason: "transcript_rollout_skip",
	});
	expect(calls.length).toBe(1);
});

test("SuggestionEngine returns continue for failed turns when fast path is enabled", async () => {
	const config = createConfig();
	const engine = createEngine(config, async () => {
		throw new Error("fast path should not call the model");
	});

	const result = await engine.suggest({ ...turn, status: "error" }, null, {
		recentChanged: [],
	});
	expect(result).toEqual({
		kind: "suggestion",
		text: "continue",
		metadata: {
			requestedStrategy: "compact",
			strategy: "compact",
			fallbackReason: "fast_path_continue",
		},
	});
});

test("SuggestionEngine falls back to compact mode when transcript context building fails", async () => {
	const config = createConfig({
		suggestion: { strategy: "transcript-steering" },
	});
	const transcriptProvider: SessionTranscriptProvider = {
		getActiveTranscript() {
			return undefined;
		},
	};
	const calls: Parameters<ModelClient["generateSuggestion"]>[0][] = [];
	const engine = createEngine(
		config,
		async (context) => {
			calls.push(context);
			return { text: "Use compact context.", usage: undefined };
		},
		new TranscriptPromptContextBuilder(config, transcriptProvider),
	);

	const result = await engine.suggest(turn, null, { recentChanged: [] });
	expect(result.kind).toBe("suggestion");
	expect(result.metadata).toMatchObject({
		strategy: "compact",
		fallbackReason:
			"transcript_error:No active session transcript available for transcript-steering suggestion mode",
	});
	expect(calls.length).toBe(1);
	expect("transcriptMessages" in calls[0]).toBe(false);
});

test("SuggestionEngine trims and truncates model output", async () => {
	const config = createConfig({ suggestion: { maxSuggestionChars: 12 } });
	const engine = createEngine(config, async () => ({
		text: "  first line\r\n\r\n\r\nsecond line  ",
		usage: undefined,
	}));

	const result = await engine.suggest(turn, null, { recentChanged: [] });
	expect(result.kind).toBe("suggestion");
	expect(result.text).toBe("first line");
});

test("SuggestionEngine treats empty model output as no_suggestion", async () => {
	const config = createConfig();
	const engine = createEngine(config, async () => ({
		text: "   ",
		usage: undefined,
	}));

	const result = await engine.suggest(turn, null, { recentChanged: [] });
	expect(result.kind).toBe("no_suggestion");
	expect(result.text).toBe("[no suggestion]");
});
