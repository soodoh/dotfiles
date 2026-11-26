export const RETRYABLE_USAGE_STATUS_CODES = new Set([
	408, 429, 500, 502, 503, 504,
]);

export type RetryUsageRequestOptions<T> = {
	maxAttempts: number;
	transientBaseMs: number;
	throttleBaseMs: number;
	maxDelayMs: number;
	statusOf: (result: T) => number | undefined;
	serverDelayMs?: (result: T) => number | undefined;
	deadlineMs?: number;
	shouldRetryError?: (error: unknown) => boolean;
};

function retryDelayMs(
	retry: number,
	options: Pick<
		RetryUsageRequestOptions<unknown>,
		"transientBaseMs" | "throttleBaseMs" | "maxDelayMs"
	>,
	status?: number,
): number {
	const baseDelay =
		status === 429 ? options.throttleBaseMs : options.transientBaseMs;
	const backoff = Math.min(options.maxDelayMs, baseDelay * 2 ** retry);
	return Math.random() * backoff;
}

function waitForRetry(delayMs: number): Promise<void> {
	return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function exceedsDeadline(
	deadlineMs: number | undefined,
	delayMs: number,
): boolean {
	return deadlineMs !== undefined && deadlineMs - performance.now() <= delayMs;
}

/** Execute a usage request with jittered exponential backoff for transient errors and throttles. */
export async function retryUsageRequest<T>(
	execute: () => Promise<T>,
	options: RetryUsageRequestOptions<T>,
): Promise<T> {
	for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
		const isLastAttempt = attempt === options.maxAttempts - 1;
		try {
			const result = await execute();
			const status = options.statusOf(result);
			if (
				isLastAttempt ||
				status === undefined ||
				!RETRYABLE_USAGE_STATUS_CODES.has(status)
			) {
				return result;
			}
			const serverDelay = options.serverDelayMs?.(result);
			let delay: number;
			if (serverDelay !== undefined) {
				if (serverDelay > options.maxDelayMs) return result;
				delay = serverDelay;
			} else {
				delay = retryDelayMs(attempt, options, status);
			}
			if (exceedsDeadline(options.deadlineMs, delay)) return result;
			await waitForRetry(delay);
		} catch (error) {
			if (
				isLastAttempt ||
				(options.shouldRetryError && !options.shouldRetryError(error))
			) {
				throw error;
			}
			const delay = retryDelayMs(attempt, options);
			if (exceedsDeadline(options.deadlineMs, delay)) throw error;
			await waitForRetry(delay);
		}
	}
	throw new Error("Usage retry attempts exhausted");
}
