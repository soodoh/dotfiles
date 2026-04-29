import test from "node:test";
import assert from "node:assert/strict";
import {
	formatGhostAcceptAndSendKeys,
	formatGhostAcceptKeys,
	matchesGhostAcceptKey,
	normalizeGhostAcceptAndSendKeys,
	normalizeGhostAcceptKeys,
} from "../../../dist/infra/pi/ghost-accept-keys.js";

test("normalizeGhostAcceptKeys defaults to right and preserves configured keys", () => {
	assert.deepEqual(normalizeGhostAcceptKeys(undefined), ["right"]);
	assert.deepEqual(normalizeGhostAcceptKeys(["enter"]), ["enter"]);
	assert.deepEqual(normalizeGhostAcceptKeys(["space", "right", "enter"]), ["space", "right", "enter"]);
});

test("normalizeGhostAcceptAndSendKeys defaults to enter", () => {
	assert.deepEqual(normalizeGhostAcceptAndSendKeys(undefined), ["enter"]);
	assert.deepEqual(normalizeGhostAcceptAndSendKeys(["space"]), ["space"]);
});

test("matchesGhostAcceptKey recognizes enter input", () => {
	assert.equal(matchesGhostAcceptKey("\r", ["enter"]), true);
	assert.equal(matchesGhostAcceptKey("\n", ["enter"]), true);
	assert.equal(matchesGhostAcceptKey("\r", ["space"]), false);
});

test("formatGhostAcceptKeys labels configured keys", () => {
	assert.equal(formatGhostAcceptKeys(undefined), "Right");
	assert.equal(formatGhostAcceptKeys(["space", "right", "enter"]), "Space/Right/Enter");
});

test("formatGhostAcceptAndSendKeys defaults to Enter", () => {
	assert.equal(formatGhostAcceptAndSendKeys(undefined), "Enter");
	assert.equal(formatGhostAcceptAndSendKeys(["space", "enter"]), "Space/Enter");
});
