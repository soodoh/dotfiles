import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	isUsageCacheFresh,
	runLeasedRefresh,
	updateLeasedJsonFile,
	usageSnapshotFreshness,
	writeAtomicJsonFile,
} from "./usage-cache";

const directories: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "usage-cache-test-"));
	directories.push(dir);
	return dir;
}

afterEach(() => {
	vi.restoreAllMocks();
	for (const dir of directories.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("usage-cache freshness policy", () => {
	test.each([
		[5 * 60_000, "fresh"],
		[5 * 60_000 + 1, "fresh"],
		[8 * 60_000, "fresh"],
		[8 * 60_000 + 1, "stale"],
	] as const)(
		"refreshes without warning until the grace period ends at age %i",
		(age, freshness) => {
			const fetchedAt = 1_000_000;
			const entry = {
				fetchedAt,
				lastAttemptAt: fetchedAt,
				state: "ready" as const,
			};
			const now = fetchedAt + age;
			expect(isUsageCacheFresh(entry, now)).toBe(false);
			expect(usageSnapshotFreshness(entry, now)).toBe(freshness);
		},
	);

	test.each(["error", "unknown"] as const)(
		"warns immediately after an %s refresh, even with a recent snapshot",
		(state) => {
			const now = 1_000_000;
			expect(
				usageSnapshotFreshness(
					{ fetchedAt: now - 30_000, lastAttemptAt: now, state },
					now,
				),
			).toBe("stale");
		},
	);

	test("a recent refresh attempt cannot extend the snapshot's display lifetime", () => {
		const now = 1_000_000;
		expect(
			usageSnapshotFreshness(
				{
					fetchedAt: now - 15 * 60_000 - 1,
					lastAttemptAt: now,
					state: "ready",
				},
				now,
			),
		).toBe("expired");
	});

	test("applies one refresh and stale-value policy to all usage sources", () => {
		const now = Date.now();
		const entry = {
			fetchedAt: now - 6 * 60_000,
			lastAttemptAt: now - 30_000,
			state: "error" as const,
		};
		expect(isUsageCacheFresh(entry, now)).toBe(true);
		expect(isUsageCacheFresh(entry, now + 31_000)).toBe(false);
		expect(usageSnapshotFreshness(entry, now)).toBe("stale");
		expect(usageSnapshotFreshness(entry, now + 10 * 60_000)).toBe("expired");
		expect(
			usageSnapshotFreshness({ ...entry, fetchedAt: now, state: "ready" }, now),
		).toBe("fresh");
	});
});

describe("usage-cache leased atomic persistence", () => {
	test("retries ELOCKED contention until released, returns contended when exhausted, and fails fast on EACCES", async () => {
		const dir = tempDir();
		const lockPath = join(dir, "usage.refresh");
		const lockSpy = vi.spyOn(lockfile, "lock");

		// Non-contention errors (e.g. EACCES) must not spend the contention retry budget.
		lockSpy.mockRejectedValueOnce(
			Object.assign(new Error("permission denied"), { code: "EACCES" }),
		);
		const failed = await runLeasedRefresh(lockPath, async () => "never", {
			stale: 5_000,
			update: 1_000,
			retries: 50,
			retryMs: 50,
		});
		expect(failed).toMatchObject({
			status: "error",
			phase: "acquire",
			error: { code: "EACCES" },
		});
		expect(lockSpy).toHaveBeenCalledTimes(1);

		// Contention retries until the competing holder releases the real lock.
		lockSpy.mockRestore();
		const release = await lockfile.lock(lockPath, { realpath: false });
		setTimeout(() => {
			void release();
		}, 30);
		const acquired = await runLeasedRefresh(lockPath, async () => "updated", {
			stale: 5_000,
			update: 1_000,
			retries: 20,
			retryMs: 10,
		});
		expect(acquired).toEqual({ status: "ok", value: "updated" });

		// Exhausted contention reports contended without throwing.
		const held = await lockfile.lock(lockPath, { realpath: false });
		try {
			const contended = await runLeasedRefresh(lockPath, async () => "never", {
				stale: 5_000,
				update: 1_000,
				retries: 2,
				retryMs: 5,
			});
			expect(contended).toEqual({ status: "contended" });
		} finally {
			await held();
		}
	});

	test("writes 0o600 JSON atomically and cleans up temp files without overwriting on compromise", async () => {
		const dir = tempDir();
		const cachePath = join(dir, "snapshot.json");
		expect(
			await updateLeasedJsonFile(cachePath, () => ({ ok: true, count: 1 })),
		).toBe(true);
		expect(JSON.parse(readFileSync(cachePath, "utf8"))).toEqual({
			ok: true,
			count: 1,
		});
		expect(statSync(cachePath).mode & 0o777).toBe(0o600);
		expect(existsSync(`${cachePath}.${process.pid}.tmp`)).toBe(false);

		let triggerCompromised!: (error: Error) => void;
		const innerRelease = vi.fn(async () => {
			throw Object.assign(new Error("Lock is already released"), {
				code: "ERELEASED",
			});
		});
		vi.spyOn(lockfile, "lock").mockImplementationOnce(async (_path, opts) => {
			triggerCompromised = opts?.onCompromised as (error: Error) => void;
			return innerRelease;
		});

		const onReleaseError = vi.fn();
		const result = await runLeasedRefresh(
			`${cachePath}.refresh`,
			async (lease) => {
				triggerCompromised(
					Object.assign(new Error("lock compromised"), {
						code: "ECOMPROMISED",
					}),
				);
				writeAtomicJsonFile(cachePath, { ok: false, count: 999 }, lease);
				return "never";
			},
			{ retries: 0, onReleaseError },
		);

		expect(result.status).toBe("compromised");
		expect(innerRelease).not.toHaveBeenCalled();
		expect(onReleaseError).not.toHaveBeenCalled();
		expect(JSON.parse(readFileSync(cachePath, "utf8"))).toEqual({
			ok: true,
			count: 1,
		});
		expect(existsSync(`${cachePath}.${process.pid}.tmp`)).toBe(false);
	});
});
