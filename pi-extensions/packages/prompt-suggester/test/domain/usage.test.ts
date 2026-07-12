import { expect, test } from "vitest";
import {
	accumulateUsage,
	addUsageStats,
	createEmptyUsage,
	emptyUsageStats,
	normalizeUsageStats,
} from "../../src/domain/usage";

test("addUsageStats increments counters and keeps last usage", () => {
	const current = emptyUsageStats();
	const usage = {
		inputTokens: 11,
		outputTokens: 7,
		cacheReadTokens: 3,
		cacheWriteTokens: 2,
		totalTokens: 23,
		costTotal: 0.12,
	};

	expect(addUsageStats(current, usage)).toEqual({
		calls: 1,
		inputTokens: 11,
		outputTokens: 7,
		cacheReadTokens: 3,
		cacheWriteTokens: 2,
		totalTokens: 23,
		costTotal: 0.12,
		last: usage,
	});
});

test("accumulateUsage combines multiple usage objects", () => {
	const first = {
		inputTokens: 10,
		outputTokens: 5,
		cacheReadTokens: 0,
		cacheWriteTokens: 1,
		totalTokens: 16,
		costTotal: 0.01,
	};
	const second = {
		inputTokens: 4,
		outputTokens: 9,
		cacheReadTokens: 2,
		cacheWriteTokens: 0,
		totalTokens: 15,
		costTotal: 0.02,
	};

	expect(accumulateUsage(first, second)).toEqual({
		inputTokens: 14,
		outputTokens: 14,
		cacheReadTokens: 2,
		cacheWriteTokens: 1,
		totalTokens: 31,
		costTotal: 0.03,
	});
	expect(accumulateUsage(createEmptyUsage(), undefined)).toEqual(
		createEmptyUsage(),
	);
});

test("usage accumulation sanitizes non-finite and negative values", () => {
	const malformed = {
		inputTokens: Number.NaN,
		outputTokens: Number.POSITIVE_INFINITY,
		cacheReadTokens: -1,
		cacheWriteTokens: 4,
		totalTokens: Number.NEGATIVE_INFINITY,
		costTotal: -0.01,
	};

	expect(addUsageStats(emptyUsageStats(), malformed)).toMatchObject({
		calls: 1,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 4,
		totalTokens: 0,
		costTotal: 0,
		last: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 4,
			totalTokens: 0,
			costTotal: 0,
		},
	});
	expect(accumulateUsage(createEmptyUsage(), malformed)).toEqual({
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 4,
		totalTokens: 0,
		costTotal: 0,
	});
});

test("normalizeUsageStats falls back to zeros for missing data", () => {
	expect(normalizeUsageStats(undefined)).toEqual({
		...emptyUsageStats(),
		last: undefined,
	});
	expect(normalizeUsageStats({ inputTokens: 3, calls: 2 })).toEqual({
		calls: 2,
		inputTokens: 3,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		costTotal: 0,
		last: undefined,
	});
	expect(normalizeUsageStats({ outputTokens: 5 })).toEqual({
		calls: 0,
		inputTokens: 0,
		outputTokens: 5,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		costTotal: 0,
		last: undefined,
	});
});

test("normalizeUsageStats rejects non-finite and negative persisted numbers", () => {
	expect(
		normalizeUsageStats({
			calls: Number.NaN,
			inputTokens: Number.POSITIVE_INFINITY,
			outputTokens: -1,
			cacheReadTokens: 4,
			cacheWriteTokens: "5",
			totalTokens: null,
			costTotal: -0.1,
			last: {
				inputTokens: Number.NEGATIVE_INFINITY,
				outputTokens: 2,
				cacheReadTokens: -3,
				cacheWriteTokens: 1,
				totalTokens: Number.NaN,
				costTotal: 0.25,
			},
		}),
	).toEqual({
		calls: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 4,
		cacheWriteTokens: 5,
		totalTokens: 0,
		costTotal: 0,
		last: {
			inputTokens: 0,
			outputTokens: 2,
			cacheReadTokens: 0,
			cacheWriteTokens: 1,
			totalTokens: 0,
			costTotal: 0.25,
		},
	});
});
