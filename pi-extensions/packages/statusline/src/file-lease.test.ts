import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	acquireSharedFileLease,
	isLockCompromisedError,
	isLockContentionError,
} from "./file-lease";

const directories: string[] = [];

function tempLockPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "file-lease-test-"));
	directories.push(dir);
	return join(dir, "usage.refresh");
}

afterEach(() => {
	vi.restoreAllMocks();
	for (const dir of directories.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("file-lease", () => {
	test("retries ELOCKED contention until released and fails fast on non-contention errors", async () => {
		const lockPath = tempLockPath();
		const lockSpy = vi.spyOn(lockfile, "lock");

		// Non-contention errors (e.g. EACCES) must not spend the contention retry budget.
		lockSpy.mockRejectedValueOnce(
			Object.assign(new Error("permission denied"), { code: "EACCES" }),
		);
		await expect(
			acquireSharedFileLease(lockPath, {
				stale: 5_000,
				update: 1_000,
				retries: 50,
				retryMs: 50,
			}),
		).rejects.toMatchObject({ code: "EACCES" });
		expect(lockSpy).toHaveBeenCalledTimes(1);

		// Contention retries until the competing holder releases the real lock.
		lockSpy.mockRestore();
		const release = await lockfile.lock(lockPath, { realpath: false });
		setTimeout(() => {
			void release();
		}, 30);
		const lease = await acquireSharedFileLease(lockPath, {
			stale: 5_000,
			update: 1_000,
			retries: 20,
			retryMs: 10,
		});
		await lease.release();

		// Exhausted contention rejects with ELOCKED.
		const held = await lockfile.lock(lockPath, { realpath: false });
		try {
			await expect(
				acquireSharedFileLease(lockPath, {
					stale: 5_000,
					update: 1_000,
					retries: 2,
					retryMs: 5,
				}),
			).rejects.toSatisfy((error) => isLockContentionError(error));
		} finally {
			await held();
		}
	});

	test("release is a safe no-op after compromise even if assertOwned was not called", async () => {
		const lockPath = tempLockPath();
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

		const lease = await acquireSharedFileLease(lockPath, {
			stale: 5_000,
			update: 1_000,
			retries: 0,
			retryMs: 10,
		});
		lease.assertOwned();
		triggerCompromised(
			Object.assign(new Error("lock compromised"), { code: "ECOMPROMISED" }),
		);

		await expect(lease.release()).resolves.toBeUndefined();
		expect(innerRelease).not.toHaveBeenCalled();
		expect(() => lease.assertOwned()).toThrowError(
			expect.toSatisfy((error) => isLockCompromisedError(error)),
		);
	});
});
