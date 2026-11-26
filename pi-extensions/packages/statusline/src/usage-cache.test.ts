import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	createSharedKeyedCache,
	createSharedSnapshotCache,
	isUsageCacheFresh,
	usageSnapshotFreshness,
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

describe("Shared usage cache path, leases, and atomic persistence", () => {
	test("resolves env override ahead of XDG_CACHE_HOME and returns undefined for missing or malformed files", () => {
		const dir = tempDir();
		const xdgCache = createSharedSnapshotCache<{ count: number }>({
			filename: "sample.json",
			envOverride: "TEST_USAGE_CACHE_PATH",
			env: { XDG_CACHE_HOME: dir },
			parse: (raw) =>
				typeof raw === "object" &&
				raw !== null &&
				"count" in raw &&
				typeof raw.count === "number"
					? { count: raw.count }
					: undefined,
		});
		expect(xdgCache.path()).toBe(join(dir, "pi", "sample.json"));
		expect(xdgCache.read()).toBeUndefined();

		const overridePath = join(dir, "custom.json");
		const overrideCache = createSharedKeyedCache<{ count: number }>({
			filename: "sample.json",
			envOverride: "TEST_USAGE_CACHE_PATH",
			env: { XDG_CACHE_HOME: dir, TEST_USAGE_CACHE_PATH: overridePath },
			parse: (raw) =>
				typeof raw === "object" &&
				raw !== null &&
				"count" in raw &&
				typeof raw.count === "number"
					? { count: raw.count }
					: undefined,
		});
		expect(overrideCache.path()).toBe(overridePath);

		const emptyEnvCache = createSharedSnapshotCache<{ count: number }>({
			filename: "sample.json",
			envOverride: "TEST_USAGE_CACHE_PATH",
			env: { XDG_CACHE_HOME: "", TEST_USAGE_CACHE_PATH: "" },
			parse: () => undefined,
		});
		expect(emptyEnvCache.path()).toBe(
			join(homedir(), ".cache", "pi", "sample.json"),
		);
	});

	test("retries ELOCKED contention until released, returns contended when exhausted, and fails fast on EACCES", async () => {
		const dir = tempDir();
		const cachePath = join(dir, "usage.json");
		const cache = createSharedSnapshotCache<unknown>({
			filename: "usage.json",
			envOverride: "TEST_USAGE_CACHE_PATH",
			env: { TEST_USAGE_CACHE_PATH: cachePath },
			parse: (raw) => raw,
		});
		const lockPath = `${cachePath}.refresh`;
		const lockSpy = vi.spyOn(lockfile, "lock");

		// Non-contention errors (e.g. EACCES) must not spend the contention retry budget.
		lockSpy.mockRejectedValueOnce(
			Object.assign(new Error("permission denied"), { code: "EACCES" }),
		);
		const failed = await cache.runLeasedRefresh(async () => "never", {
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
		const acquired = await cache.runLeasedRefresh(async () => "updated", {
			stale: 5_000,
			update: 1_000,
			retries: 20,
			retryMs: 10,
		});
		expect(acquired).toEqual({ status: "ok", value: "updated" });

		// Exhausted contention reports contended without throwing.
		const held = await lockfile.lock(lockPath, { realpath: false });
		try {
			const contended = await cache.runLeasedRefresh(async () => "never", {
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

	test("writes 0o600 JSON atomically, merges via update, and refuses overwrite on compromise", async () => {
		const dir = tempDir();
		const keyedPath = join(dir, "keyed.json");
		const keyedCache = createSharedKeyedCache<{ ok: boolean; count: number }>({
			filename: "keyed.json",
			envOverride: "TEST_USAGE_CACHE_PATH",
			env: { TEST_USAGE_CACHE_PATH: keyedPath },
			parse: (raw) =>
				typeof raw === "object" && raw !== null
					? (raw as { ok: boolean; count: number })
					: undefined,
		});

		expect(
			await keyedCache.update((disk) => ({
				ok: true,
				count: (disk?.count ?? 0) + 1,
			})),
		).toBe(true);
		expect(keyedCache.read()).toEqual({ ok: true, count: 1 });
		expect(
			await keyedCache.update((disk) => ({
				ok: true,
				count: (disk?.count ?? 0) + 1,
			})),
		).toBe(true);
		expect(keyedCache.read()).toEqual({ ok: true, count: 2 });
		expect(statSync(keyedPath).mode & 0o777).toBe(0o600);
		expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual(
			[],
		);

		const snapshotPath = join(dir, "snapshot.json");
		const snapshotCache = createSharedSnapshotCache<{
			ok: boolean;
			count: number;
		}>({
			filename: "snapshot.json",
			envOverride: "TEST_USAGE_CACHE_PATH",
			env: { TEST_USAGE_CACHE_PATH: snapshotPath },
			parse: (raw) =>
				typeof raw === "object" && raw !== null
					? (raw as { ok: boolean; count: number })
					: undefined,
		});
		expect(
			await snapshotCache.runLeasedRefresh(async (lease) => {
				lease.write({ ok: true, count: 2 });
			}),
		).toEqual({ status: "ok", value: undefined });

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
		const result = await snapshotCache.runLeasedRefresh(
			async (lease) => {
				triggerCompromised(
					Object.assign(new Error("lock compromised"), {
						code: "ECOMPROMISED",
					}),
				);
				lease.write({ ok: false, count: 999 });
				return "never";
			},
			{ retries: 0, onReleaseError },
		);

		expect(result.status).toBe("compromised");
		expect(innerRelease).not.toHaveBeenCalled();
		expect(onReleaseError).not.toHaveBeenCalled();
		expect(snapshotCache.read()).toEqual({ ok: true, count: 2 });
		expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual(
			[],
		);
	});

	test("binds lease.read and lease.write to the path locked at runLeasedRefresh entry", async () => {
		const dir = tempDir();
		const firstPath = join(dir, "first.json");
		const secondPath = join(dir, "second.json");
		const env: NodeJS.ProcessEnv = { TEST_USAGE_CACHE_PATH: firstPath };
		const cache = createSharedSnapshotCache<{ count: number }>({
			filename: "snapshot.json",
			envOverride: "TEST_USAGE_CACHE_PATH",
			env,
			parse: (raw) =>
				typeof raw === "object" &&
				raw !== null &&
				"count" in raw &&
				typeof raw.count === "number"
					? { count: raw.count }
					: undefined,
		});
		expect(
			await cache.runLeasedRefresh(async (lease) => {
				lease.write({ count: 3 });
			}),
		).toEqual({ status: "ok", value: undefined });

		const result = await cache.runLeasedRefresh(async (lease) => {
			env.TEST_USAGE_CACHE_PATH = secondPath;
			const previous = lease.read();
			lease.write({ count: (previous?.count ?? 0) + 4 });
			return previous?.count;
		});

		expect(result).toEqual({ status: "ok", value: 3 });
		expect(JSON.parse(readFileSync(firstPath, "utf8"))).toEqual({ count: 7 });
		expect(existsSync(secondPath)).toBe(false);
	});

	test("runKeyedRefresh isolates leases per key without exposing direct file writes", async () => {
		const dir = tempDir();
		const cachePath = join(dir, "multi.json");
		const cache = createSharedKeyedCache<unknown>({
			filename: "multi.json",
			envOverride: "TEST_USAGE_CACHE_PATH",
			env: { TEST_USAGE_CACHE_PATH: cachePath },
			parse: (raw) => raw,
		});
		const held = await lockfile.lock(`${cachePath}.refresh-alpha`, {
			realpath: false,
		});
		try {
			const sameKey = await cache.runKeyedRefresh(
				"alpha",
				async () => "never",
				{ retries: 1, retryMs: 5 },
			);
			expect(sameKey).toEqual({ status: "contended" });

			const otherKey = await cache.runKeyedRefresh(
				"beta",
				async (lease) => {
					lease.assertOwned();
					expect("write" in lease).toBe(false);
					return "ok";
				},
				{ retries: 0 },
			);
			expect(otherKey).toEqual({ status: "ok", value: "ok" });
		} finally {
			await held();
		}

		for (const invalidKey of ["", "../escape", "nested/key", "bad key"]) {
			await expect(
				cache.runKeyedRefresh(invalidKey, async () => "never", { retries: 0 }),
			).rejects.toThrow(RangeError);
		}
	});

	test("rejects retained lease reads and writes after runLeasedRefresh releases the lock", async () => {
		const dir = tempDir();
		const cachePath = join(dir, "released.json");
		const cache = createSharedSnapshotCache<{ count: number }>({
			filename: "released.json",
			envOverride: "TEST_USAGE_CACHE_PATH",
			env: { TEST_USAGE_CACHE_PATH: cachePath },
			parse: (raw) =>
				typeof raw === "object" &&
				raw !== null &&
				"count" in raw &&
				typeof raw.count === "number"
					? { count: raw.count }
					: undefined,
		});

		let retainedLease:
			| {
					assertOwned(): void;
					read(): { count: number } | undefined;
					write(value: { count: number }): void;
			  }
			| undefined;
		const result = await cache.runLeasedRefresh(async (lease) => {
			lease.write({ count: 1 });
			retainedLease = lease;
		});
		expect(result).toEqual({ status: "ok", value: undefined });
		expect(() => retainedLease?.assertOwned()).toThrow(/already been released/);
		expect(() => retainedLease?.read()).toThrow(/already been released/);
		expect(() => retainedLease?.write({ count: 2 })).toThrow(
			/already been released/,
		);
		expect(cache.read()).toEqual({ count: 1 });
	});

	test("binds keyed lease read/update to entry path and aborts merge on refresh-lease compromise or release", async () => {
		const dir = tempDir();
		const firstPath = join(dir, "keyed-first.json");
		const secondPath = join(dir, "keyed-second.json");
		const env: NodeJS.ProcessEnv = { TEST_USAGE_CACHE_PATH: firstPath };
		const cache = createSharedKeyedCache<{ count: number }>({
			filename: "keyed.json",
			envOverride: "TEST_USAGE_CACHE_PATH",
			env,
			parse: (raw) =>
				typeof raw === "object" &&
				raw !== null &&
				"count" in raw &&
				typeof raw.count === "number"
					? { count: raw.count }
					: undefined,
		});
		expect(await cache.update(() => ({ count: 2 }))).toBe(true);

		let retainedKeyedLease:
			| {
					assertOwned(): void;
					read(): { count: number } | undefined;
					update(
						build: (disk: { count: number } | undefined) => { count: number },
					): Promise<boolean>;
			  }
			| undefined;
		const moved = await cache.runKeyedRefresh("alpha", async (lease) => {
			expect(lease.path).toBe(firstPath);
			env.TEST_USAGE_CACHE_PATH = secondPath;
			const previous = lease.read();
			expect(previous).toEqual({ count: 2 });
			expect(
				await lease.update((disk) => ({ count: (disk?.count ?? 0) + 5 })),
			).toBe(true);
			retainedKeyedLease = lease;
			return previous?.count;
		});
		expect(moved).toEqual({ status: "ok", value: 2 });
		expect(JSON.parse(readFileSync(firstPath, "utf8"))).toEqual({ count: 7 });
		expect(existsSync(secondPath)).toBe(false);
		expect(() => retainedKeyedLease?.read()).toThrow(/already been released/);
		await expect(
			retainedKeyedLease?.update(() => ({ count: 99 })),
		).rejects.toThrow(/already been released/);

		// Compromising the keyed refresh lease while waiting for the file lock must abort the write and report compromised.
		env.TEST_USAGE_CACHE_PATH = firstPath;
		let triggerCompromised!: (error: Error) => void;
		const originalLock = lockfile.lock.bind(lockfile);
		const lockSpy = vi.spyOn(lockfile, "lock");
		lockSpy.mockImplementationOnce(async (_file, options) => {
			triggerCompromised = options?.onCompromised ?? (() => {});
			return async () => {};
		});
		lockSpy.mockImplementationOnce(async (file, options) => {
			triggerCompromised(
				Object.assign(new Error("keyed lock compromised"), {
					code: "ECOMPROMISED",
				}),
			);
			return originalLock(file, options);
		});

		const compromised = await cache.runKeyedRefresh(
			"alpha",
			async (lease) => {
				await lease.update(() => ({ count: 999 }));
				return "never";
			},
			{ retries: 0 },
		);
		expect(compromised.status).toBe("compromised");
		expect(JSON.parse(readFileSync(firstPath, "utf8"))).toEqual({ count: 7 });

		// Compromising the keyed refresh lease during inner file-lock contention must still report compromised.
		let triggerContendedCompromise!: (error: Error) => void;
		lockSpy.mockImplementationOnce(async (_file, options) => {
			triggerContendedCompromise = options?.onCompromised ?? (() => {});
			return async () => {};
		});
		lockSpy.mockImplementationOnce(async () => {
			triggerContendedCompromise(
				Object.assign(new Error("keyed lock compromised while contended"), {
					code: "ECOMPROMISED",
				}),
			);
			throw Object.assign(new Error("file locked"), { code: "ELOCKED" });
		});

		const contendedCompromised = await cache.runKeyedRefresh(
			"alpha",
			async (lease) => {
				await lease.update(() => ({ count: 888 }), { retries: 5 });
				return "never";
			},
			{ retries: 0 },
		);
		expect(contendedCompromised.status).toBe("compromised");
		expect(JSON.parse(readFileSync(firstPath, "utf8"))).toEqual({ count: 7 });
	});
});
