import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { ReseedRunner } from "../../src/app/orchestrators/reseed-runner";
import { SessionStartOrchestrator } from "../../src/app/orchestrators/session-start";
import { TurnEndOrchestrator } from "../../src/app/orchestrators/turn-end";
import { UserSubmitOrchestrator } from "../../src/app/orchestrators/user-submit";
import { createAppComposition } from "../../src/composition/root";
import { NdjsonEventLog } from "../../src/infra/logging/ndjson-event-log";
import { RuntimeRef } from "../../src/infra/pi/runtime-ref";
import { SessionStateStore } from "../../src/infra/pi/session-state-store";
import { JsonSeedStore } from "../../src/infra/storage/json-seed-store";

const tempDirs: string[] = [];

async function tempDir(name: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), `${name}-`));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

describe("createAppComposition", () => {
	test("wires production stores, event log, runtime ref, and orchestrators", async () => {
		const cwd = await tempDir("pi-suggester-composition");
		const composition = await createAppComposition(
			{ getThinkingLevel: () => "medium" },
			cwd,
		);

		expect(composition.config.schemaVersion).toBeGreaterThan(0);
		expect(composition.runtimeRef).toBeInstanceOf(RuntimeRef);
		expect(composition.stores.seedStore).toBeInstanceOf(JsonSeedStore);
		expect(composition.stores.stateStore).toBeInstanceOf(SessionStateStore);
		expect(composition.eventLog).toBeInstanceOf(NdjsonEventLog);
		expect(composition.orchestrators.sessionStart).toBeInstanceOf(
			SessionStartOrchestrator,
		);
		expect(composition.orchestrators.agentEnd).toBeInstanceOf(
			TurnEndOrchestrator,
		);
		expect(composition.orchestrators.userSubmit).toBeInstanceOf(
			UserSubmitOrchestrator,
		);
		expect(composition.orchestrators.reseedRunner).toBeInstanceOf(ReseedRunner);
	});
});
