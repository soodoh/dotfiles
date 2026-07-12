import path from "node:path";
import { describe, expect, test } from "vitest";
import type { SessionReadableManager } from "../../../src/infra/pi/session-state-types";
import {
	createSessionStorageContext,
	stateFilePath,
} from "../../../src/infra/pi/session-storage-context";

function manager(sessionId: string): SessionReadableManager {
	return {
		getBranch: () => [],
		getEntries: () => [],
		getSessionFile: () => "/tmp/session.jsonl",
		getSessionId: () => sessionId,
		getLeafId: () => "leaf",
		getCwd: () => "/tmp/project",
	};
}

describe("session storage keys", () => {
	test("session ids with the same normalized form do not collide", () => {
		const first = createSessionStorageContext("/state", manager("a/b"));
		const second = createSessionStorageContext("/state", manager("a?b"));

		expect(first.sessionId).not.toBe(second.sessionId);
		expect(path.basename(first.sessionId)).toMatch(/^a_b-/);
		expect(path.basename(second.sessionId)).toMatch(/^a_b-/);
	});

	test("interaction keys with the same normalized form do not collide", () => {
		const first = stateFilePath("/state/interaction", "leaf/1");
		const second = stateFilePath("/state/interaction", "leaf?1");

		expect(first).not.toBe(second);
		expect(path.basename(first)).toMatch(/^leaf_1-.*\.json$/);
		expect(path.basename(second)).toMatch(/^leaf_1-.*\.json$/);
	});
});
