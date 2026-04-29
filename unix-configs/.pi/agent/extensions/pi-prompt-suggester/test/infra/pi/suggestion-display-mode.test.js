import test from "node:test";
import assert from "node:assert/strict";
import {
	getSuggestionStatusText,
	isSuggestionDisplayMode,
	usesGhostEditor,
	usesWidgetSuggestion,
} from "../../../dist/infra/pi/suggestion-display-mode.js";

test("suggestion display mode helpers distinguish ghost and widget modes", () => {
	assert.equal(isSuggestionDisplayMode("ghost"), true);
	assert.equal(isSuggestionDisplayMode("widget"), true);
	assert.equal(isSuggestionDisplayMode("overlay"), false);
	assert.equal(usesGhostEditor("ghost"), true);
	assert.equal(usesGhostEditor("widget"), false);
	assert.equal(usesWidgetSuggestion("ghost"), false);
	assert.equal(usesWidgetSuggestion("widget"), true);
});

test("getSuggestionStatusText keeps ghost hints out of widget mode", () => {
	assert.equal(
		getSuggestionStatusText({ displayMode: "ghost", canGhostInEditor: true }),
		"prompt suggestion · Right accepts · Enter sends",
	);
	assert.equal(
		getSuggestionStatusText({
			displayMode: "ghost",
			canGhostInEditor: true,
			ghostAcceptKeys: ["space", "right"],
			ghostAcceptAndSendKeys: ["enter"],
		}),
		"prompt suggestion · Space/Right accepts · Enter sends",
	);
	assert.equal(
		getSuggestionStatusText({ displayMode: "ghost", canGhostInEditor: false, restored: true }),
		"restored prompt suggestion · ghost hidden",
	);
	assert.equal(
		getSuggestionStatusText({ displayMode: "widget", canGhostInEditor: false }),
		"prompt suggestion",
	);
});
