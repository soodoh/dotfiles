import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";

export const USAGE_SUCCESS_TTL_MS = 5 * 60_000;
export const USAGE_FAILURE_TTL_MS = 60_000;
export const USAGE_STALE_GRACE_MS = 3 * 60_000;
export const USAGE_STALE_MAX_MS = 15 * 60_000;

const DEFAULT_LEASE_STALE_MS = 20_000;
const DEFAULT_LEASE_UPDATE_MS = 5_000;
const DEFAULT_LEASE_RETRY_MS = 100;
const DEFAULT_LEASE_RETRIES = 550;

export type UsageCacheTiming = {
	fetchedAt?: number;
	lastAttemptAt?: number;
	state?: "ready" | "unknown" | "error" | "unsupported";
};

export type SharedFileLease = {
	assertOwned(): void;
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
): Promise<InternalLease> {
	const stale = options.stale ?? DEFAULT_LEASE_STALE_MS;
	const update = options.update ?? DEFAULT_LEASE_UPDATE_MS;
	const retries = options.retries ?? DEFAULT_LEASE_RETRIES;
	const retryMs = options.retryMs ?? DEFAULT_LEASE_RETRY_MS;
	mkdirSync(dirname(lockPath), { recursive: true });
	for (let attempt = 0; ; attempt++) {
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
			await waitForLeaseRetry(retryMs);
		}
	}
}

/** Write JSON atomically with 0o600 permissions only while the lease is still owned. */
export function writeAtomicJsonFile(
	path: string,
	data: unknown,
	lease: SharedFileLease,
): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.tmp`;
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

/** Coordinate a cross-process leased refresh with contention and compromise handling. */
export async function runLeasedRefresh<T>(
	lockPath: string,
	work: (lease: SharedFileLease) => Promise<T>,
	options: LeasedRefreshOptions = {},
): Promise<LeasedRefreshResult<T>> {
	let lease: InternalLease;
	try {
		lease = await acquireLease(lockPath, options);
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

/** Best-effort leased atomic JSON read-modify-write for shared disk snapshots. */
export async function updateLeasedJsonFile<T>(
	path: string,
	build: () => T,
	options: Pick<LeasedRefreshOptions, "retries"> = {},
): Promise<boolean> {
	const result = await runLeasedRefresh(
		path,
		async (lease) => {
			writeAtomicJsonFile(path, build(), lease);
			return true;
		},
		options,
	);
	return result.status === "ok";
}
