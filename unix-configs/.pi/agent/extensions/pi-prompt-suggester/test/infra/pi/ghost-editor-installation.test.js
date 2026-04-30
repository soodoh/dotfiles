import assert from "node:assert/strict";
import test from "node:test";
import { getGhostEditorSyncAction } from "../../../dist/infra/pi/ghost-editor-installation.js";

function context(id) {
	return { id };
}

test("ghost editor installs when no installation exists", () => {
	assert.equal(
		getGhostEditorSyncAction({
			state: undefined,
			context: context("a"),
			sessionFile: "/tmp/session.json",
		}),
		"install",
	);
});

test("ghost editor stays installed while the same context owns the same session", () => {
	const ctx = context("same");
	assert.equal(
		getGhostEditorSyncAction({
			state: { context: ctx, sessionFile: "/tmp/session.json" },
			context: ctx,
			sessionFile: "/tmp/session.json",
		}),
		"noop",
	);
});

test("ghost editor reinstalls when a fresh context takes over the same session", () => {
	assert.equal(
		getGhostEditorSyncAction({
			state: { context: context("old"), sessionFile: "/tmp/session.json" },
			context: context("new"),
			sessionFile: "/tmp/session.json",
		}),
		"install",
	);
});

test("ghost editor reinstalls for a different session", () => {
	const ctx = context("same");
	assert.equal(
		getGhostEditorSyncAction({
			state: { context: ctx, sessionFile: "/tmp/old-session.json" },
			context: ctx,
			sessionFile: "/tmp/new-session.json",
		}),
		"install",
	);
});
