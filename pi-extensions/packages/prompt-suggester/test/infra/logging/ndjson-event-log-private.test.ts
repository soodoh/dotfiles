import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { NdjsonEventLog } from "../../../src/infra/logging/ndjson-event-log";

test("NdjsonEventLog writes event logs with private permissions", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "pi-suggester-events-"));
	const filePath = path.join(dir, "logs", "events.ndjson");
	const log = new NdjsonEventLog(filePath);

	await log.append({
		at: "2026-05-01T00:00:00.000Z",
		level: "info",
		message: "test.event",
	});

	expect((await stat(path.dirname(filePath))).mode & 0o777).toBe(0o700);
	expect((await stat(filePath)).mode & 0o777).toBe(0o600);
});

test("NdjsonEventLog recovers the write queue after an append failure", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "pi-suggester-events-"));
	const filePath = path.join(dir, "logs", "events.ndjson");
	await mkdir(path.dirname(filePath), { recursive: true });
	await mkdir(filePath);
	const log = new NdjsonEventLog(filePath);

	await expect(
		log.append({
			at: "2026-05-01T00:00:00.000Z",
			level: "info",
			message: "test.failure",
		}),
	).rejects.toThrow();

	await rm(filePath, { recursive: true, force: true });
	await log.append({
		at: "2026-05-01T00:00:01.000Z",
		level: "info",
		message: "test.recovered",
	});

	expect((await stat(filePath)).isFile()).toBe(true);
});
