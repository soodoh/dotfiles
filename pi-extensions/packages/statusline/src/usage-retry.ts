export const RETRYABLE_USAGE_STATUS_CODES = new Set([
	408, 429, 500, 502, 503, 504,
]);

export type RetryBackoffOptions = {
	status?: number;
	transientBaseMs: number;
	throttleBaseMs: number;
	maxDelayMs: number;
};

export function usageRetryDelayMs(
	retry: number,
	options: RetryBackoffOptions,
): number {
	const baseDelay =
		options.status === 429 ? options.throttleBaseMs : options.transientBaseMs;
	const backoff = Math.min(options.maxDelayMs, baseDelay * 2 ** retry);
	return Math.random() * backoff;
}

export async function waitForRetry(delayMs: number): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}
