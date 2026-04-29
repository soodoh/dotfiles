import test from "node:test";
import assert from "node:assert/strict";
import { renderTranscriptSteeringPrompt } from "../../dist/prompts/transcript-steering-template.js";

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
	assert.match(prompt, /You are the steering layer for an implementation session/i);
	assert.match(prompt, /You are NOT the implementation agent/i);
	assert.match(prompt, /draft the single message the user could send next to best steer the implementation agent/i);
	assert.match(prompt, /Optimize for usefulness, alignment, and leverage/i);
	assert.match(prompt, /You may steer by continuing, redirecting, simplifying, asking for verification, closing the loop, switching tracks, or asking a clarifying question/i);
});

test("renderTranscriptSteeringPrompt includes persistent preferences when provided", () => {
	const prompt = renderTranscriptSteeringPrompt({
		...baseContext,
		customInstruction: "Bias toward simplification.",
	});
	assert.match(prompt, /Persistent user preference:/);
	assert.match(prompt, /Bias toward simplification\./);
	assert.doesNotMatch(prompt, /Recent user corrections:/);
});
