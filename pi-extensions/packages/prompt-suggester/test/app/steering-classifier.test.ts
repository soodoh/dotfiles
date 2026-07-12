import { expect, test } from "vitest";
import { SteeringClassifier } from "../../src/app/services/steering-classifier";
import type { PromptSuggesterConfig } from "../../src/config/types";

const config: PromptSuggesterConfig = {
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

const classifier = new SteeringClassifier(config);

test("SteeringClassifier detects exact matches", () => {
	const result = classifier.classify(
		"Fix the failing tests",
		"Fix the failing tests",
	);

	expect(result.classification).toBe("accepted_exact");
	expect(result.similarity).toBe(1);
});

test("SteeringClassifier treats minor edits as accepted edits", () => {
	const result = classifier.classify(
		"Fix the failing tests in the workflows package",
		"Please fix the failing tests in the workflows package",
	);

	expect(result.classification).toBe("accepted_edited");
	expect(result.similarity).toBeGreaterThanOrEqual(
		config.steering.acceptedThreshold,
	);
});

test("SteeringClassifier detects changed course", () => {
	const result = classifier.classify(
		"Fix the failing tests in the workflows package",
		"Add a new statusline theme option",
	);

	expect(result.classification).toBe("changed_course");
	expect(result.similarity).toBeLessThan(config.steering.acceptedThreshold);
});

test("SteeringClassifier normalizes whitespace and punctuation", () => {
	const result = classifier.classify(
		"Fix   the failing tests!",
		" fix the failing tests ",
	);

	expect(result.classification).toBe("accepted_exact");
	expect(result.similarity).toBe(1);
});

test("SteeringClassifier bounds long prompt similarity work", () => {
	const longSuggested = `${"keep going ".repeat(5000)}finish with tests`;
	const longActual = `${"keep going ".repeat(5000)}finish with tests please`;

	const startedAt = Date.now();
	const result = classifier.classify(longSuggested, longActual);

	expect(Date.now() - startedAt).toBeLessThan(1000);
	expect(result.classification).toBe("accepted_edited");
	expect(result.similarity).toBeGreaterThanOrEqual(
		config.steering.acceptedThreshold,
	);
});
