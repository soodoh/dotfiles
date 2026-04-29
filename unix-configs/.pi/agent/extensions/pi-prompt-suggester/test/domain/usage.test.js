import test from "node:test";
import assert from "node:assert/strict";
import { addUsageStats, accumulateUsage, createEmptyUsage, emptyUsageStats, normalizeUsageStats } from "../../dist/domain/usage.js";

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

	assert.deepEqual(addUsageStats(current, usage), {
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

	assert.deepEqual(accumulateUsage(first, second), {
		inputTokens: 14,
		outputTokens: 14,
		cacheReadTokens: 2,
		cacheWriteTokens: 1,
		totalTokens: 31,
		costTotal: 0.03,
	});
	assert.deepEqual(accumulateUsage(createEmptyUsage(), undefined), createEmptyUsage());
});

test("normalizeUsageStats falls back to zeros for missing data", () => {
	assert.deepEqual(normalizeUsageStats(undefined), {
		...emptyUsageStats(),
		last: undefined,
	});
	assert.deepEqual(normalizeUsageStats({ inputTokens: 3, calls: 2 }), {
		calls: 2,
		inputTokens: 3,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		costTotal: 0,
		last: undefined,
	});
});
