import { expect, test } from "vitest";
import { PiSessionTranscriptProvider } from "../../../src/infra/pi/session-transcript-provider";

test("PiSessionTranscriptProvider prefers the session manager's effective context", () => {
	const provider = new PiSessionTranscriptProvider({
		getContext() {
			return {
				sessionManager: {
					getLeafId() {
						return "leaf-1";
					},
					getBranch() {
						throw new Error(
							"raw branch reconstruction should not be used when buildSessionContext is available",
						);
					},
					getSessionId() {
						return "session-1";
					},
					buildSessionContext() {
						return {
							messages: [
								{
									role: "user",
									timestamp: 1,
									content: [{ type: "text", text: "effective context" }],
								},
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
	expect(transcript?.systemPrompt).toBe("system prompt");
	expect(transcript?.messages.length).toBe(1);
	const content = transcript?.messages[0].content[0];
	expect(
		typeof content === "object" && content.type === "text" ? content.text : "",
	).toBe("effective context");
	expect(transcript?.contextUsagePercent).toBe(10);
	expect(transcript?.sessionId).toBe("session-1");
});
