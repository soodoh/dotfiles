import test from "node:test";
import assert from "node:assert/strict";
import { renderSuggestionPrompt } from "../../dist/prompts/suggestion-template.js";

const baseContext = {
	turnStatus: "success",
	abortContextNote: undefined,
	intentSeed: null,
	recentUserPrompts: ["fix the failing tests"],
	toolSignals: ["edited src/index.ts"],
	touchedFiles: ["src/index.ts"],
	unresolvedQuestions: [],
	recentChanged: [],
	latestAssistantTurn: "I can fix the failing tests and then commit.",
	maxSuggestionChars: 200,
	noSuggestionToken: "[no suggestion]",
	customInstruction: "",
};

test("renderSuggestionPrompt omits preference block when blank", () => {
	const prompt = renderSuggestionPrompt(baseContext);
	assert.equal(prompt.includes("Additional user preference:"), false);
});

test("renderSuggestionPrompt uses low-meta next-user-message framing", () => {
	const prompt = renderSuggestionPrompt(baseContext);
	assert.match(prompt, /Write the next message the user would most likely send/i);
	assert.match(prompt, /Do not describe the instructions you were given/i);
	assert.match(prompt, /prefer affirmation only/i);
});

test("renderSuggestionPrompt includes quiet preference block when present", () => {
	const prompt = renderSuggestionPrompt({
		...baseContext,
		customInstruction: "Keep replies extremely terse.",
	});
	assert.match(prompt, /Additional user preference:/);
	assert.doesNotMatch(prompt, /CustomSuggesterInstruction:/);
	assert.match(prompt, /Keep replies extremely terse\./);
});
