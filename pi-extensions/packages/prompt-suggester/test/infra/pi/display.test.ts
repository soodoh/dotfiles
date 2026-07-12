import { expect, test } from "vitest";
import { getConfiguredModelDisplay } from "../../../src/infra/pi/display";

const ctx = {
	model: { provider: "openai", id: "gpt-5" },
	modelRegistry: {
		getAll() {
			return [
				{ provider: "openai", id: "gpt-5" },
				{ provider: "anthropic", id: "gpt-5" },
				{ provider: "anthropic", id: "claude-sonnet" },
			];
		},
	},
};

test("getConfiguredModelDisplay uses configured provider/model and thinking", () => {
	expect(
		getConfiguredModelDisplay({
			ctx,
			configuredModel: ["anthropic/claude-sonnet"],
			configuredThinking: "high",
			getSessionThinkingLevel: () => "low",
		}),
	).toBe("(anthropic) claude-sonnet • high");
});

test("getConfiguredModelDisplay falls back to session thinking and ambiguous bare model id", () => {
	expect(
		getConfiguredModelDisplay({
			ctx,
			configuredModel: ["gpt-5"],
			configuredThinking: "session-default",
			getSessionThinkingLevel: () => "off",
		}),
	).toBe("(openai) gpt-5 • thinking off");
});

test("getConfiguredModelDisplay uses first available configured model", () => {
	expect(
		getConfiguredModelDisplay({
			ctx,
			configuredModel: ["missing/model", "anthropic/claude-sonnet"],
			configuredThinking: "medium",
			getSessionThinkingLevel: () => "off",
		}),
	).toBe("(anthropic) claude-sonnet • medium");
});
