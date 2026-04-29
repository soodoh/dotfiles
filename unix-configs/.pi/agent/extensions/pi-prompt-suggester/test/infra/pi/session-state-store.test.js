import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { access, mkdtemp } from "node:fs/promises";
import { SessionStateStore } from "../../../dist/infra/pi/session-state-store.js";
import { INITIAL_RUNTIME_STATE } from "../../../dist/domain/state.js";

function createInMemorySessionManager() {
	return {
		getBranch() {
			return [];
		},
		getEntries() {
			return [];
		},
		getSessionFile() {
			return undefined;
		},
		getSessionId() {
			return "test/session";
		},
		getLeafId() {
			return "leaf-1";
		},
		getCwd() {
			return process.cwd();
		},
	};
}

function createPersistentSessionManager(cwd) {
	return {
		getBranch() {
			return [{ id: "root-entry" }, { id: "leaf-1" }];
		},
		getEntries() {
			return [];
		},
		getSessionFile() {
			return path.join(cwd, ".pi", "session.json");
		},
		getSessionId() {
			return "test/session";
		},
		getLeafId() {
			return "leaf-1";
		},
		getCwd() {
			return cwd;
		},
	};
}

test("SessionStateStore persists save/usage state for in-memory sessions", async () => {
	const store = new SessionStateStore("/unused/state-dir", () => createInMemorySessionManager());
	await store.save({
		...INITIAL_RUNTIME_STATE,
		lastSuggestion: {
			text: "Go ahead.",
			shownAt: "2026-03-13T12:00:00.000Z",
			turnId: "turn-1",
			sourceLeafId: "leaf-1",
		},
	});
	await store.recordUsage("suggester", {
		inputTokens: 10,
		outputTokens: 5,
		cacheReadTokens: 1,
		cacheWriteTokens: 0,
		totalTokens: 16,
		costTotal: 0.02,
	});

	const state = await store.load();
	assert.equal(state.lastSuggestion?.text, "Go ahead.");
	assert.equal(state.suggestionUsage.calls, 1);
	assert.equal(state.suggestionUsage.inputTokens, 10);
	assert.equal(state.seederUsage.calls, 0);
});

test("SessionStateStore writes persistent files under the provided project state directory", async () => {
	const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-suggester-session-cwd-"));
	const projectStateDir = await mkdtemp(path.join(os.tmpdir(), "pi-suggester-session-state-"));
	const sessionManager = createPersistentSessionManager(cwd);
	const store = new SessionStateStore(projectStateDir, () => sessionManager);

	await store.save({
		...INITIAL_RUNTIME_STATE,
		lastSuggestion: {
			text: "Persist me",
			shownAt: "2026-03-13T12:00:00.000Z",
			turnId: "turn-1",
			sourceLeafId: "leaf-1",
		},
	});
	await store.recordUsage("suggester", {
		inputTokens: 3,
		outputTokens: 2,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 5,
		costTotal: 0.01,
	});

	const interactionPath = path.join(projectStateDir, "sessions", "test_session", "interaction", "leaf-1.json");
	const usagePath = path.join(projectStateDir, "sessions", "test_session", "usage.json");
	const metaPath = path.join(projectStateDir, "sessions", "test_session", "meta.json");

	await access(interactionPath);
	await access(usagePath);
	await access(metaPath);

	const state = await store.load();
	assert.equal(state.lastSuggestion?.text, "Persist me");
	assert.equal(state.suggestionUsage.calls, 1);
});
