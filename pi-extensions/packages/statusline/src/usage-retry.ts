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
	onRetryResult?: (result: T) => void | Promise<void>;
	deadlineMs?: number;
	shouldRetryError?: (error: unknown) => boolean;
	now?: () => number;
	sleep?: (delayMs: number) => Promise<void>;
	random?: () => number;
};

export function parseRetryAfterMs(
	response: Pick<Response, "headers">,
	nowMs: () => number = Date.now,
): number | undefined {
	const value = response.headers.get("retry-after")?.trim();
	if (!value) return undefined;

	const seconds = Number(value);
	if (Number.isFinite(seconds)) {
		if (seconds <= 0) return 0;
		const ms = seconds * 1000;
		return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
	}

	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp)
		? Math.max(0, timestamp - nowMs())
		: undefined;
}

function defaultSleep(delayMs: number): Promise<void> {
	return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

function retryDelayMs(
	retry: number,
	options: Pick<
		RetryUsageRequestOptions<unknown>,
		"transientBaseMs" | "throttleBaseMs" | "maxDelayMs" | "random"
	>,
	status?: number,
): number {
	const baseDelay =
		status === 429 ? options.throttleBaseMs : options.transientBaseMs;
	const backoff = Math.min(options.maxDelayMs, baseDelay * 2 ** retry);
	return (options.random ?? Math.random)() * backoff;
}

function exceedsDeadline(
	deadlineMs: number | undefined,
	delayMs: number,
	now: () => number,
): boolean {
	return deadlineMs !== undefined && deadlineMs - now() <= delayMs;
}

/** Execute a usage request with jittered exponential backoff for transient errors and throttles. */
export async function retryUsageRequest<T>(
	execute: () => Promise<T>,
	options: RetryUsageRequestOptions<T>,
): Promise<T> {
	const now = options.now ?? (() => performance.now());
	const sleep = options.sleep ?? defaultSleep;

	for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
		const isLastAttempt = attempt === options.maxAttempts - 1;
		let result: T;
		try {
			result = await execute();
		} catch (error) {
			if (
				isLastAttempt ||
				(options.shouldRetryError && !options.shouldRetryError(error))
			) {
				throw error;
			}
			const delay = retryDelayMs(attempt, options);
			if (exceedsDeadline(options.deadlineMs, delay, now)) throw error;
			await sleep(delay);
			continue;
		}
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
		if (serverDelay !== undefined && Number.isFinite(serverDelay)) {
			const clampedDelay = Math.max(0, serverDelay);
			if (clampedDelay > options.maxDelayMs) return result;
			delay = clampedDelay;
		} else {
			delay = retryDelayMs(attempt, options, status);
		}
		if (exceedsDeadline(options.deadlineMs, delay, now)) return result;
		await options.onRetryResult?.(result);
		await sleep(delay);
	}
	throw new Error("Usage retry attempts exhausted");
}
