import test from "node:test";
import assert from "node:assert/strict";
import { getGhostEditorSyncAction } from "../../../dist/infra/pi/ghost-editor-installation.js";

function context(id) {
	return { id };
}

test("ghost editor installs when ghost mode is active and no installation exists", () => {
	assert.equal(
		getGhostEditorSyncAction({ state: undefined, context: context("a"), displayMode: "ghost", sessionFile: "/tmp/session.json" }),
		"install",
	);
});

test("ghost editor stays installed while the same context owns the same session", () => {
	const ctx = context("same");
	assert.equal(
		getGhostEditorSyncAction({
			state: { context: ctx, sessionFile: "/tmp/session.json" },
			context: ctx,
			displayMode: "ghost",
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
			displayMode: "ghost",
			sessionFile: "/tmp/session.json",
		}),
		"install",
	);
});

test("ghost editor uninstalls when switching to widget mode", () => {
	const ctx = context("same");
	assert.equal(
		getGhostEditorSyncAction({
			state: { context: ctx, sessionFile: "/tmp/session.json" },
			context: ctx,
			displayMode: "widget",
			sessionFile: "/tmp/session.json",
		}),
		"uninstall",
	);
});

test("ghost editor reinstalls when ghost mode is active for a different session", () => {
	const ctx = context("same");
	assert.equal(
		getGhostEditorSyncAction({
			state: { context: ctx, sessionFile: "/tmp/old-session.json" },
			context: ctx,
			displayMode: "ghost",
			sessionFile: "/tmp/new-session.json",
		}),
		"install",
	);
});
