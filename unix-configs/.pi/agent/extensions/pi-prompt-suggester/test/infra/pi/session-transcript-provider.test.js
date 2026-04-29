import test from "node:test";
import assert from "node:assert/strict";
import { PiSessionTranscriptProvider } from "../../../dist/infra/pi/session-transcript-provider.js";

test("PiSessionTranscriptProvider prefers the session manager's effective context", () => {
	const provider = new PiSessionTranscriptProvider({
		getContext() {
			return {
				sessionManager: {
					getLeafId() {
						return "leaf-1";
					},
					getBranch() {
						throw new Error("raw branch reconstruction should not be used when buildSessionContext is available");
					},
					getSessionId() {
						return "session-1";
					},
					buildSessionContext() {
						return {
							messages: [
								{ role: "user", timestamp: 1, content: [{ type: "text", text: "effective context" }] },
							],
							thinkingLevel: "high",
							model: null,
						};
					},
				},
				getSystemPrompt() {
					return "system prompt";
				},
				getContextUsage() {
					return { tokens: 1000, contextWindow: 10000, percent: 10 };
				},
			};
		},
	});

	const transcript = provider.getActiveTranscript();
	assert.equal(transcript?.systemPrompt, "system prompt");
	assert.equal(transcript?.messages.length, 1);
	assert.equal(transcript?.messages[0].content[0].text, "effective context");
	assert.equal(transcript?.contextUsagePercent, 10);
	assert.equal(transcript?.sessionId, "session-1");
});
