import assert from "node:assert/strict";
import test from "node:test";
import { getConfiguredModelDisplay } from "../../../dist/infra/pi/display.js";

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
	assert.equal(
		getConfiguredModelDisplay({
			ctx,
			configuredModel: "anthropic/claude-sonnet",
			configuredThinking: "high",
			getSessionThinkingLevel: () => "low",
		}),
		"(anthropic) claude-sonnet • high",
	);
});

test("getConfiguredModelDisplay falls back to session thinking and ambiguous bare model id", () => {
	assert.equal(
		getConfiguredModelDisplay({
			ctx,
			configuredModel: "gpt-5",
			configuredThinking: "session-default",
			getSessionThinkingLevel: () => "off",
		}),
		"(openai) gpt-5 • thinking off",
	);
});
