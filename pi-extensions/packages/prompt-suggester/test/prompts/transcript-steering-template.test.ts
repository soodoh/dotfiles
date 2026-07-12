import { expect, test } from "vitest";
import { renderTranscriptSteeringPrompt } from "../../src/prompts/transcript-steering-template";

const baseContext = {
	systemPrompt: "system prompt",
	transcriptMessages: [],
	transcriptMessageCount: 2,
	transcriptCharCount: 100,
	contextUsagePercent: 30,
	sessionId: "session-1",
	intentSeed: null,
	recentChanged: [],
	customInstruction: "",
	noSuggestionToken: "[no suggestion]",
	maxSuggestionChars: 160,
};

test("renderTranscriptSteeringPrompt frames transcript mode as steering", () => {
	const prompt = renderTranscriptSteeringPrompt(baseContext);
	expect(prompt).toMatch(
		/You are the steering layer for an implementation session/i,
	);
	expect(prompt).toMatch(/You are NOT the implementation agent/i);
	expect(prompt).toMatch(
		/draft the single message the user could send next to best steer the implementation agent/i,
	);
	expect(prompt).toMatch(/Optimize for usefulness, alignment, and leverage/i);
	expect(prompt).toMatch(
		/You may steer by continuing, redirecting, simplifying, asking for verification, closing the loop, switching tracks, or asking a clarifying question/i,
	);
});

test("renderTranscriptSteeringPrompt includes persistent preferences when provided", () => {
	const prompt = renderTranscriptSteeringPrompt({
		...baseContext,
		customInstruction: "Bias toward simplification.",
	});
	expect(prompt).toMatch(/Persistent user preference:/);
	expect(prompt).toMatch(/Bias toward simplification\./);
	expect(prompt).not.toMatch(/Recent user corrections:/);
});
