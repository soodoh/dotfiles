import {
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";

export const USAGE_SUCCESS_TTL_MS = 5 * 60_000;
export const USAGE_FAILURE_TTL_MS = 60_000;
export const USAGE_STALE_GRACE_MS = 3 * 60_000;
export const USAGE_STALE_MAX_MS = 15 * 60_000;

const DEFAULT_LEASE_STALE_MS = 20_000;
const DEFAULT_LEASE_UPDATE_MS = 5_000;
const DEFAULT_LEASE_RETRY_MS = 100;
const DEFAULT_LEASE_RETRIES = 550;
const SAFE_REFRESH_KEY = /^[A-Za-z0-9_-]+$/;

export type UsageCacheTiming = {
	fetchedAt?: number;
	lastAttemptAt?: number;
	state?: "ready" | "unknown" | "error" | "unsupported";
};

export type SharedFileLease = {
	assertOwned(): void;
};

export type SharedCacheLease<T> = SharedFileLease & {
	read(): T | undefined;
	write(value: T): void;
};

export type SharedKeyedCacheLease<T> = SharedFileLease & {
	readonly path: string;
	read(): T | undefined;
	update(
		build: (disk: T | undefined) => T,
		options?: Pick<LeasedRefreshOptions, "retries">,
	): Promise<boolean>;
};

export type LeasedRefreshOptions = {
	stale?: number;
	update?: number;
	retries?: number;
	retryMs?: number;
	onReleaseError?: (error: unknown) => void;
};

export type LeasedRefreshResult<T> =
	| { status: "ok"; value: T }
	| { status: "contended" }
	| { status: "compromised"; error: Error }
	| { status: "error"; phase: "acquire" | "work"; error: unknown };

export type SharedUsageCacheOptions<T> = {
	filename: string;
	envOverride: string;
	env?: NodeJS.ProcessEnv;
	parse: (raw: unknown) => T | undefined;
	serialize?: (value: T) => unknown;
};

export type SharedSnapshotCache<T> = {
	path(): string;
	read(): T | undefined;
	runLeasedRefresh<R>(
		work: (lease: SharedCacheLease<T>) => Promise<R>,
		options?: LeasedRefreshOptions,
	): Promise<LeasedRefreshResult<R>>;
};

export type SharedKeyedCache<T> = {
	path(): string;
	read(): T | undefined;
	update(
		build: (disk: T | undefined) => T,
		options?: Pick<LeasedRefreshOptions, "retries">,
	): Promise<boolean>;
	runKeyedRefresh<R>(
		key: string,
		work: (lease: SharedKeyedCacheLease<T>) => Promise<R>,
		options?: LeasedRefreshOptions,
	): Promise<LeasedRefreshResult<R>>;
};

/** Failed attempts retry sooner; a successful value's age is measured from its fetch. */
export function isUsageCacheFresh(
	entry: UsageCacheTiming | undefined,
	now = Date.now(),
): boolean {
	if (!entry?.lastAttemptAt) return false;
	const ttl =
		entry.state === "unknown" || entry.state === "error"
			? USAGE_FAILURE_TTL_MS
			: USAGE_SUCCESS_TTL_MS;
	return now - entry.lastAttemptAt < ttl;
}

/** Routine refreshes get a warning grace period; failures warn immediately without extending expiry. */
export function usageSnapshotFreshness(
	entry: UsageCacheTiming | undefined,
	now = Date.now(),
): "fresh" | "stale" | "expired" {
	const fetchedAt =
		entry?.fetchedAt ??
		(entry?.state === "ready" ? entry.lastAttemptAt : undefined);
	if (!fetchedAt || now - fetchedAt > USAGE_STALE_MAX_MS) return "expired";
	if (
		entry?.state === "error" ||
		entry?.state === "unknown" ||
		now - fetchedAt > USAGE_SUCCESS_TTL_MS + USAGE_STALE_GRACE_MS
	)
		return "stale";
	return "fresh";
}

function hasErrorCode(error: unknown, code: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === code
	);
}

function isLockContentionError(error: unknown): boolean {
	return hasErrorCode(error, "ELOCKED");
}

function isLockCompromisedError(error: unknown): boolean {
	return hasErrorCode(error, "ECOMPROMISED");
}

function waitForLeaseRetry(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

type InternalLease = SharedFileLease & {
	release(): Promise<void>;
};

async function acquireLease(
	lockPath: string,
	options: LeasedRefreshOptions,
	parentLease?: SharedFileLease,
): Promise<InternalLease> {
	const stale = options.stale ?? DEFAULT_LEASE_STALE_MS;
	const update = options.update ?? DEFAULT_LEASE_UPDATE_MS;
	const retries = options.retries ?? DEFAULT_LEASE_RETRIES;
	const retryMs = options.retryMs ?? DEFAULT_LEASE_RETRY_MS;
	mkdirSync(dirname(lockPath), { recursive: true });
	for (let attempt = 0; ; attempt++) {
		parentLease?.assertOwned();
		let compromisedError: Error | undefined;
		try {
			const release = await lockfile.lock(lockPath, {
				realpath: false,
				stale,
				update,
				retries: 0,
				onCompromised: (error) => {
					compromisedError = error;
				},
			});
			let released = false;
			return {
				assertOwned() {
					if (compromisedError) throw compromisedError;
					if (released) {
						throw new Error("Shared cache lease has already been released");
					}
				},
				async release() {
					if (released || compromisedError) return;
					released = true;
					await release();
				},
			};
		} catch (error) {
			if (!isLockContentionError(error) || attempt >= retries) {
				throw error;
			}
			parentLease?.assertOwned();
			await waitForLeaseRetry(retryMs);
		}
	}
}

let tempWriteSequence = 0;

function writeAtomicJsonFile(
	path: string,
	data: unknown,
	lease: SharedFileLease,
): void {
	lease.assertOwned();
	mkdirSync(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${++tempWriteSequence}.tmp`;
	try {
		writeFileSync(temporaryPath, `${JSON.stringify(data)}\n`, { mode: 0o600 });
		lease.assertOwned();
		renameSync(temporaryPath, path);
	} finally {
		try {
			unlinkSync(temporaryPath);
		} catch {
			// Renamed or already cleaned up.
		}
	}
}

async function runLeasedWork<T>(
	lockPath: string,
	work: (lease: SharedFileLease) => Promise<T>,
	options: LeasedRefreshOptions = {},
	parentLease?: SharedFileLease,
): Promise<LeasedRefreshResult<T>> {
	let lease: InternalLease;
	try {
		lease = await acquireLease(lockPath, options, parentLease);
	} catch (error) {
		if (isLockContentionError(error)) return { status: "contended" };
		return { status: "error", phase: "acquire", error };
	}

	try {
		lease.assertOwned();
		const value = await work(lease);
		return { status: "ok", value };
	} catch (error) {
		if (isLockCompromisedError(error)) {
			return {
				status: "compromised",
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
		return { status: "error", phase: "work", error };
	} finally {
		try {
			await lease.release();
		} catch (error) {
			options.onReleaseError?.(error);
		}
	}
}

function createCacheStorage<T>(options: SharedUsageCacheOptions<T>) {
	const serialize = options.serialize ?? ((value: T) => value);

	function resolvePath(): string {
		const source = options.env ?? process.env;
		return (
			source[options.envOverride] ||
			join(
				source.XDG_CACHE_HOME || join(homedir(), ".cache"),
				"pi",
				options.filename,
			)
		);
	}

	function readAt(path: string): T | undefined {
		try {
			const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
			return options.parse(parsed);
		} catch {
			return undefined;
		}
	}

	function read(): T | undefined {
		return readAt(resolvePath());
	}

	return { resolvePath, readAt, read, serialize };
}

/** Ephemeral cross-process single-writer snapshot cache backed by XDG paths, 0o600 atomic writes, and a refresh lease. */
export function createSharedSnapshotCache<T>(
	options: SharedUsageCacheOptions<T>,
): SharedSnapshotCache<T> {
	const storage = createCacheStorage(options);

	return {
		path: storage.resolvePath,
		read: storage.read,
		runLeasedRefresh(work, refreshOptions = {}) {
			const cachePath = storage.resolvePath();
			return runLeasedWork(
				`${cachePath}.refresh`,
				(lease) =>
					work({
						assertOwned: () => lease.assertOwned(),
						read: () => {
							lease.assertOwned();
							return storage.readAt(cachePath);
						},
						write(value) {
							writeAtomicJsonFile(cachePath, storage.serialize(value), lease);
						},
					}),
				refreshOptions,
			);
		},
	};
}

/** Ephemeral cross-process multi-key cache with per-key refresh leases and file-locked read-modify-write merges. */
export function createSharedKeyedCache<T>(
	options: SharedUsageCacheOptions<T>,
): SharedKeyedCache<T> {
	const storage = createCacheStorage(options);

	async function updateAt(
		cachePath: string,
		build: (disk: T | undefined) => T,
		updateOptions: Pick<LeasedRefreshOptions, "retries"> = {},
		parentLease?: SharedFileLease,
	): Promise<boolean> {
		parentLease?.assertOwned();
		const result = await runLeasedWork(
			cachePath,
			async (fileLease) => {
				const writeLease: SharedFileLease = parentLease
					? {
							assertOwned() {
								parentLease.assertOwned();
								fileLease.assertOwned();
							},
						}
					: fileLease;
				writeLease.assertOwned();
				const next = build(storage.readAt(cachePath));
				writeAtomicJsonFile(cachePath, storage.serialize(next), writeLease);
				return true;
			},
			updateOptions,
			parentLease,
		);
		parentLease?.assertOwned();
		return result.status === "ok";
	}

	return {
		path: storage.resolvePath,
		read: storage.read,
		update(build, updateOptions = {}) {
			return updateAt(storage.resolvePath(), build, updateOptions);
		},
		async runKeyedRefresh(key, work, refreshOptions = {}) {
			if (!SAFE_REFRESH_KEY.test(key)) {
				throw new RangeError(
					`Invalid refresh lease key: ${JSON.stringify(key)}`,
				);
			}
			const cachePath = storage.resolvePath();
			return runLeasedWork(
				`${cachePath}.refresh-${key}`,
				(lease) =>
					work({
						path: cachePath,
						assertOwned: () => lease.assertOwned(),
						read: () => {
							lease.assertOwned();
							return storage.readAt(cachePath);
						},
						update: (build, updateOptions = {}) =>
							updateAt(cachePath, build, updateOptions, lease),
					}),
				refreshOptions,
			);
		},
	};
}
