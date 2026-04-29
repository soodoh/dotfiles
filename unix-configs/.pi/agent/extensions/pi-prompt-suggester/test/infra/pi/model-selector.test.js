import test from "node:test";
import assert from "node:assert/strict";
import { buildModelSelectionItems } from "../../../dist/infra/pi/commands/model-selector.js";

const models = [
	{ provider: "openai", id: "gpt-5", name: "GPT-5" },
	{ provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4" },
	{ provider: "google", id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
];

test("buildModelSelectionItems prepends special options and keeps the current model near the top", () => {
	const items = buildModelSelectionItems(models, "google/gemini-2.5-pro", [
		{ value: "session-default", description: "Use the current session model" },
	]);

	assert.deepEqual(
		items.map((item) => item.value),
		["session-default", "google/gemini-2.5-pro", "anthropic/claude-sonnet-4", "openai/gpt-5"],
	);
	assert.match(items[1].description ?? "", /current setting/);
});

test("buildModelSelectionItems also recognizes a bare current model id", () => {
	const items = buildModelSelectionItems(models, "gpt-5");
	assert.equal(items[0].value, "openai/gpt-5");
	assert.match(items[0].description ?? "", /current setting/);
});
