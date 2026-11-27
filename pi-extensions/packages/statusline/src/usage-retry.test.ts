import { describe, expect, test } from "vitest";
import { parseRetryAfterMs, retryUsageRequest } from "./usage-retry";

describe("parseRetryAfterMs", () => {
	test("parses numeric seconds and clamps negatives to zero", () => {
		expect(
			parseRetryAfterMs(
				new Response(null, { headers: { "retry-after": "3" } }),
			),
		).toBe(3000);
		expect(
			parseRetryAfterMs(
				new Response(null, { headers: { "retry-after": "-5" } }),
			),
		).toBe(0);
		expect(
			parseRetryAfterMs(
				new Response(null, { headers: { "retry-after": "1e308" } }),
			),
		).toBe(Number.MAX_SAFE_INTEGER);
	});

	test("parses HTTP-date timestamps against an injected clock", () => {
		const now = Date.UTC(2026, 0, 1, 0, 0, 0);
		const future = new Date(now + 12_000).toUTCString();
		const past = new Date(now - 5_000).toUTCString();
		expect(
			parseRetryAfterMs(
				new Response(null, { headers: { "retry-after": future } }),
				() => now,
			),
		).toBe(12_000);
		expect(
			parseRetryAfterMs(
				new Response(null, { headers: { "retry-after": past } }),
				() => now,
			),
		).toBe(0);
		expect(
			parseRetryAfterMs(
				new Response(null, { headers: { "retry-after": "not-a-date" } }),
				() => now,
			),
		).toBeUndefined();
	});
});

describe("retryUsageRequest", () => {
	test("applies separate transient and throttle backoff schedules with injected seams", async () => {
		const delays: number[] = [];
		const responses = [503, 429, 200];
		let calls = 0;

		const result = await retryUsageRequest(
			async () => {
				calls++;
				return { status: responses.shift() ?? 200 };
			},
			{
				maxAttempts: 3,
				transientBaseMs: 100,
				throttleBaseMs: 500,
				maxDelayMs: 800,
				statusOf: (res) => res.status,
				random: () => 0.5,
				sleep: async (ms) => {
					delays.push(ms);
				},
			},
		);

		expect(result).toEqual({ status: 200 });
		expect(calls).toBe(3);
		// Attempt 0 (503): 0.5 * min(800, 100 * 2^0) = 50
		// Attempt 1 (429): 0.5 * min(800, 500 * 2^1) = 400 (capped at maxDelayMs)
		expect(delays).toEqual([50, 400]);
	});

	test("honors server Retry-After delay and bails when it exceeds maxDelayMs", async () => {
		const delays: number[] = [];
		const seq = [
			new Response(null, { status: 429, headers: { "retry-after": "2" } }),
			new Response(null, { status: 429, headers: { "retry-after": "30" } }),
		];
		const result = await retryUsageRequest(
			async () => seq.shift() ?? new Response(null, { status: 200 }),
			{
				maxAttempts: 3,
				transientBaseMs: 50,
				throttleBaseMs: 500,
				maxDelayMs: 5_000,
				statusOf: (res) => res.status,
				serverDelayMs: parseRetryAfterMs,
				sleep: async (ms) => {
					delays.push(ms);
				},
			},
		);

		expect(result.status).toBe(429);
		expect(delays).toEqual([2_000]);
	});

	test("stops before sleeping when delay would exceed the deadline", async () => {
		const delays: number[] = [];
		let clock = 1_000;
		let attempts = 0;

		const result = await retryUsageRequest(
			async () => {
				attempts++;
				clock += 200;
				return { status: 503 };
			},
			{
				maxAttempts: 4,
				transientBaseMs: 500,
				throttleBaseMs: 1000,
				maxDelayMs: 5000,
				deadlineMs: 1_400,
				statusOf: (res) => res.status,
				now: () => clock,
				random: () => 1,
				sleep: async (ms) => {
					delays.push(ms);
				},
			},
		);

		expect(result).toEqual({ status: 503 });
		expect(attempts).toBe(1);
		expect(delays).toEqual([]);
	});

	test("respects shouldRetryError for thrown failures", async () => {
		const delays: number[] = [];
		class RetryableError extends Error {}
		let attempts = 0;

		await expect(
			retryUsageRequest(
				async () => {
					attempts++;
					if (attempts === 1) throw new RetryableError("transient");
					throw new Error("permanent");
				},
				{
					maxAttempts: 3,
					transientBaseMs: 100,
					throttleBaseMs: 500,
					maxDelayMs: 1000,
					statusOf: () => undefined,
					shouldRetryError: (error) => error instanceof RetryableError,
					random: () => 0.5,
					sleep: async (ms) => {
						delays.push(ms);
					},
				},
			),
		).rejects.toThrow("permanent");

		expect(attempts).toBe(2);
		expect(delays).toEqual([50]);
	});

	test("clamps negative serverDelayMs, falls back on non-finite values, and notifies onRetryResult", async () => {
		const delays: number[] = [];
		const retried: number[] = [];
		const seq = [
			{ id: 1, status: 429, serverDelay: -250 },
			{ id: 2, status: 503, serverDelay: Number.NaN },
			{ id: 3, status: 200, serverDelay: undefined },
		];

		const result = await retryUsageRequest(
			async () =>
				seq.shift() ?? { id: 99, status: 200, serverDelay: undefined },
			{
				maxAttempts: 3,
				transientBaseMs: 100,
				throttleBaseMs: 500,
				maxDelayMs: 1_000,
				statusOf: (res) => res.status,
				serverDelayMs: (res) => res.serverDelay,
				onRetryResult: (res) => {
					retried.push(res.id);
				},
				random: () => 0.5,
				sleep: async (ms) => {
					delays.push(ms);
				},
			},
		);

		expect(result.id).toBe(3);
		// Attempt 0 (-250): clamped to 0
		// Attempt 1 (NaN -> fallback 503 backoff): 0.5 * (100 * 2^1) = 100
		expect(delays).toEqual([0, 100]);
		expect(retried).toEqual([1, 2]);
	});

	test("propagates onRetryResult and sleep failures without treating them as request errors", async () => {
		const delays: number[] = [];
		let attempts = 0;

		await expect(
			retryUsageRequest(
				async () => {
					attempts++;
					return { status: 503 };
				},
				{
					maxAttempts: 3,
					transientBaseMs: 50,
					throttleBaseMs: 500,
					maxDelayMs: 1_000,
					statusOf: (res) => res.status,
					onRetryResult: () => {
						throw new Error("cleanup boom");
					},
					sleep: async (ms) => {
						delays.push(ms);
					},
				},
			),
		).rejects.toThrow("cleanup boom");
		expect(attempts).toBe(1);
		expect(delays).toEqual([]);

		attempts = 0;
		await expect(
			retryUsageRequest(
				async () => {
					attempts++;
					return { status: 503 };
				},
				{
					maxAttempts: 3,
					transientBaseMs: 50,
					throttleBaseMs: 500,
					maxDelayMs: 1_000,
					statusOf: (res) => res.status,
					sleep: async (ms) => {
						delays.push(ms);
						throw new Error("sleep aborted");
					},
				},
			),
		).rejects.toThrow("sleep aborted");
		expect(attempts).toBe(1);
		expect(delays).toHaveLength(1);
	});
});
