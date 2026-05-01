import assert from "node:assert/strict";
import test from "node:test";
import {
	matchesGhostAcceptKey,
	normalizeGhostAcceptAndSendKeys,
} from "../../../dist/infra/pi/ghost-accept-keys.js";

test("normalizeGhostAcceptAndSendKeys defaults to enter", () => {
	assert.deepEqual(normalizeGhostAcceptAndSendKeys(undefined), ["enter"]);
	assert.deepEqual(normalizeGhostAcceptAndSendKeys(["space"]), ["space"]);
});

test("matchesGhostAcceptKey recognizes enter input", () => {
	assert.equal(matchesGhostAcceptKey("\r", ["enter"]), true);
	assert.equal(matchesGhostAcceptKey("\n", ["enter"]), true);
	assert.equal(matchesGhostAcceptKey("\r", ["space"]), false);
});
