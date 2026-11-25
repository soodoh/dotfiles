import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";

export type SharedFileLease = {
	assertOwned(): void;
	release(): Promise<void>;
};

export type SharedFileLeaseOptions = {
	stale: number;
	update: number;
	retries: number;
	retryMs: number;
};

function hasErrorCode(error: unknown, code: string): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === code
	);
}

export function isLockContentionError(error: unknown): boolean {
	return hasErrorCode(error, "ELOCKED");
}

export function isLockCompromisedError(error: unknown): boolean {
	return hasErrorCode(error, "ECOMPROMISED");
}

function waitForLeaseRetry(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function acquireSharedFileLease(
	lockPath: string,
	options: SharedFileLeaseOptions,
): Promise<SharedFileLease> {
	mkdirSync(dirname(lockPath), { recursive: true });
	for (let attempt = 0; ; attempt++) {
		let compromisedError: Error | undefined;
		try {
			const release = await lockfile.lock(lockPath, {
				realpath: false,
				stale: options.stale,
				update: options.update,
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
			if (!isLockContentionError(error) || attempt >= options.retries) {
				throw error;
			}
			await waitForLeaseRetry(options.retryMs);
		}
	}
}
