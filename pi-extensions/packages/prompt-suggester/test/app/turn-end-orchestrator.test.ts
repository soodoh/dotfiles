import { expect, test } from "vitest";
import { TurnEndOrchestrator } from "../../src/app/orchestrators/turn-end";
import type { PromptSuggesterConfig } from "../../src/config/types";
import {
	INITIAL_RUNTIME_STATE,
	type RuntimeState,
} from "../../src/domain/state";
import type { SuggestionUsage } from "../../src/domain/suggestion";

type UsageCall = { kind: "suggester" | "seeder"; usage: SuggestionUsage };
type LogEvent = {
	level: string;
	message: string;
	meta?: Record<string, unknown>;
};

function createConfig(): PromptSuggesterConfig {
	return {
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
			strategy: "transcript-steering",
			transcriptMaxContextPercent: 70,
			transcriptMaxMessages: 120,
			transcriptMaxChars: 120000,
			transcriptRolloutPercent: 100,
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
	};
}

test("TurnEndOrchestrator records usage and persists transcript-steering suggestion metadata", async () => {
	let savedState: RuntimeState | undefined;
	const usageCalls: UsageCall[] = [];
	const shown: string[] = [];
	const logEvents: LogEvent[] = [];
	const baseState: RuntimeState = {
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
		seedStore: {
			async load() {
				return null;
			},
		},
		stateStore: {
			async load() {
				return baseState;
			},
			async save(state) {
				savedState = state;
			},
			async recordUsage(kind, usage) {
				usageCalls.push({ kind, usage });
			},
		},
		stalenessChecker: {
			async check() {
				return { stale: false, trigger: undefined };
			},
		},
		reseedRunner: { async trigger() {} },
		suggestionEngine: {
			async suggest() {
				return {
					kind: "suggestion",
					text: "Go ahead.",
					usage: {
						inputTokens: 10,
						outputTokens: 3,
						cacheReadTokens: 9,
						cacheWriteTokens: 1,
						totalTokens: 13,
						costTotal: 0.02,
					},
					metadata: {
						requestedStrategy: "transcript-steering",
						strategy: "transcript-steering",
						transcriptMessageCount: 12,
						transcriptCharCount: 400,
					},
				};
			},
		},
		suggestionSink: {
			async showSuggestion(text) {
				shown.push(text);
				return true;
			},
			async clearSuggestion() {
				return true;
			},
			async setUsage() {},
		},
		logger: {
			debug(message, meta) {
				logEvents.push({ level: "debug", message, meta });
			},
			info(message, meta) {
				logEvents.push({ level: "info", message, meta });
			},
			warn(message, meta) {
				logEvents.push({ level: "warn", message, meta });
			},
			error(message, meta) {
				logEvents.push({ level: "error", message, meta });
			},
		},
		checkForStaleness: false,
	});

	await orchestrator.handle({
		turnId: "turn-2",
		sourceLeafId: "leaf-2",
		assistantText: "Done.",
		assistantUsage: {
			inputTokens: 20,
			outputTokens: 5,
			cacheReadTokens: 18,
			cacheWriteTokens: 0,
			totalTokens: 25,
			costTotal: 0.03,
		},
		status: "success",
		occurredAt: "2026-03-15T00:02:00.000Z",
		recentUserPrompts: ["Run it"],
		toolSignals: [],
		touchedFiles: [],
		unresolvedQuestions: [],
	});

	expect(shown).toEqual(["Go ahead."]);
	expect(usageCalls.length).toBe(1);
	expect(usageCalls[0].kind).toBe("suggester");
	if (!savedState?.lastSuggestion) {
		throw new Error("expected state with last suggestion to be saved");
	}
	expect(savedState.lastSuggestion.variantName).toBe("default");
	expect(savedState.lastSuggestion.strategy).toBe("transcript-steering");
	expect(savedState.lastSuggestion.requestedStrategy).toBe(
		"transcript-steering",
	);
	expect(savedState.pendingNextTurnObservation).toBe(undefined);
	expect(
		logEvents.some(
			(entry) => entry.message === "suggestion.next_turn.cache_observed",
		),
	).toBe(true);
	expect(
		logEvents.some(
			(entry) =>
				entry.message === "suggestion.generated" &&
				entry.meta?.variantName === "default",
		),
	).toBe(true);
});
test("TurnEndOrchestrator does not persist stale generation suggestions", async () => {
	let saved = false;
	const usageCalls: UsageCall[] = [];
	const orchestrator = new TurnEndOrchestrator({
		config: createConfig(),
		seedStore: {
			async load() {
				return null;
			},
		},
		stateStore: {
			async load() {
				return INITIAL_RUNTIME_STATE;
			},
			async save() {
				saved = true;
			},
			async recordUsage(kind, usage) {
				usageCalls.push({ kind, usage });
			},
		},
		stalenessChecker: {
			async check() {
				return { stale: false, trigger: undefined };
			},
		},
		reseedRunner: { async trigger() {} },
		suggestionEngine: {
			async suggest() {
				return {
					kind: "suggestion",
					text: "Stale suggestion",
					usage: {
						inputTokens: 1,
						outputTokens: 1,
						cacheReadTokens: 0,
						cacheWriteTokens: 0,
						totalTokens: 2,
						costTotal: 0,
					},
					metadata: {
						requestedStrategy: "transcript-steering",
						strategy: "transcript-steering",
					},
				};
			},
		},
		suggestionSink: {
			async showSuggestion() {
				return false;
			},
			async clearSuggestion() {
				return false;
			},
			async setUsage() {},
		},
		logger: {
			debug() {},
			info() {},
			warn() {},
			error() {},
		},
		checkForStaleness: false,
	});

	await orchestrator.handle({
		turnId: "turn-stale",
		sourceLeafId: "leaf-stale",
		assistantText: "Done.",
		status: "success",
		occurredAt: "2026-03-15T00:02:00.000Z",
		recentUserPrompts: ["Run it"],
		toolSignals: [],
		touchedFiles: [],
		unresolvedQuestions: [],
	});

	expect(saved).toBe(false);
	expect(usageCalls).toHaveLength(1);
});
