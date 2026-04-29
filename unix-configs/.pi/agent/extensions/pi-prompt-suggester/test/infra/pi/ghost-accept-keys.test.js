import test from "node:test";
import assert from "node:assert/strict";
import {
	formatGhostAcceptKeys,
	matchesGhostAcceptKey,
	normalizeGhostAcceptKeys,
} from "../../../dist/infra/pi/ghost-accept-keys.js";

test("normalizeGhostAcceptKeys preserves enter", () => {
	assert.deepEqual(normalizeGhostAcceptKeys(["enter"]), ["enter"]);
	assert.deepEqual(normalizeGhostAcceptKeys(["space", "right", "enter"]), ["space", "right", "enter"]);
});

test("matchesGhostAcceptKey recognizes enter input", () => {
	assert.equal(matchesGhostAcceptKey("\r", ["enter"]), true);
	assert.equal(matchesGhostAcceptKey("\n", ["enter"]), true);
	assert.equal(matchesGhostAcceptKey("\r", ["space"]), false);
});

test("formatGhostAcceptKeys labels enter", () => {
	assert.equal(formatGhostAcceptKeys(["space", "right", "enter"]), "Space/Right/Enter");
});
