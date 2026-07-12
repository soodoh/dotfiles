import { expect, test } from "vitest";
import type { SuggestionPromptContext } from "../../src/app/services/prompt-context-builder";
import { renderSuggestionPrompt } from "../../src/prompts/suggestion-template";

const baseContext: SuggestionPromptContext = {
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
	expect(prompt.includes("Additional user preference:")).toBe(false);
});

test("renderSuggestionPrompt uses low-meta next-user-message framing", () => {
	const prompt = renderSuggestionPrompt(baseContext);
	expect(prompt).toMatch(
		/Write the next message the user would most likely send/i,
	);
	expect(prompt).toMatch(/Do not describe the instructions you were given/i);
	expect(prompt).toMatch(/prefer affirmation only/i);
});

test("renderSuggestionPrompt includes quiet preference block when present", () => {
	const prompt = renderSuggestionPrompt({
		...baseContext,
		customInstruction: "Keep replies extremely terse.",
	});
	expect(prompt).toMatch(/Additional user preference:/);
	expect(prompt).not.toMatch(/CustomSuggesterInstruction:/);
	expect(prompt).toMatch(/Keep replies extremely terse\./);
});
