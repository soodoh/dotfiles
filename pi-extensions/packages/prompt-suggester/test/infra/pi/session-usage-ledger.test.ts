import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { SessionStorageContext } from "../../../src/infra/pi/session-state-types";

const tempDirs: string[] = [];

async function tempDir(name: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), `${name}-`));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	vi.doUnmock("../../../src/infra/storage/atomic-write");
	vi.resetModules();
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

test("SessionUsageLedger continues queued usage writes after a failed write", async () => {
	const dir = await tempDir("pi-suggester-usage-ledger");
	const usageFile = join(dir, "usage.json");
	const context = {
		sessionId: "session-1",
		sessionFile: join(dir, "session.jsonl"),
		storageDir: dir,
		interactionDir: join(dir, "interactions"),
		usageFile,
		metaFile: join(dir, "meta.json"),
		lookupKeys: ["leaf-1"],
		currentKey: "leaf-1",
		persistent: true,
	} satisfies Extract<SessionStorageContext, { persistent: true }>;
	let failFirstWrite: (() => void) | undefined;
	let firstWriteStarted: (() => void) | undefined;
	const firstWriteSeen = new Promise<void>((resolve) => {
		firstWriteStarted = resolve;
	});
	let writeCount = 0;
	vi.doMock("../../../src/infra/storage/atomic-write", () => ({
		atomicWriteJson: async (filePath: string, payload: unknown) => {
			writeCount += 1;
			if (writeCount === 1) {
				firstWriteStarted?.();
				await new Promise<void>((_resolve, reject) => {
					failFirstWrite = () => reject(new Error("first write failed"));
				});
				return;
			}
			await mkdir(join(filePath, ".."), { recursive: true });
			await writeFile(filePath, JSON.stringify(payload), "utf8");
		},
	}));
	const { SessionUsageLedger } = await import(
		"../../../src/infra/pi/session-usage-ledger"
	);
	const ledger = new SessionUsageLedger();

	const first = ledger.record(context, "suggester", {
		inputTokens: 1,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 1,
		costTotal: 0,
	});
	await firstWriteSeen;
	const second = ledger.record(context, "seeder", {
		inputTokens: 2,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 2,
		costTotal: 0,
	});
	failFirstWrite?.();

	await expect(first).rejects.toThrow(/first write failed/);
	await expect(second).resolves.toBeUndefined();
	expect(writeCount).toBe(2);
	expect(JSON.parse(await readFile(usageFile, "utf8"))).toMatchObject({
		suggestionUsage: { calls: 0 },
		seederUsage: { calls: 1, inputTokens: 2, totalTokens: 2 },
	});
});
