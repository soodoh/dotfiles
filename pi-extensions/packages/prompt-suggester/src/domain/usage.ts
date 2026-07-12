import type { SuggestionUsageStats } from "./state";
import type { SuggestionUsage } from "./suggestion";

export function createEmptyUsage(): SuggestionUsage {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		costTotal: 0,
	};
}

export function emptyUsageStats(): SuggestionUsageStats {
	return {
		calls: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		costTotal: 0,
	};
}

export function normalizeSuggestionUsage(
	usage: SuggestionUsage,
): SuggestionUsage {
	return {
		inputTokens: normalizeFiniteNonNegativeNumber(usage.inputTokens),
		outputTokens: normalizeFiniteNonNegativeNumber(usage.outputTokens),
		cacheReadTokens: normalizeFiniteNonNegativeNumber(usage.cacheReadTokens),
		cacheWriteTokens: normalizeFiniteNonNegativeNumber(usage.cacheWriteTokens),
		totalTokens: normalizeFiniteNonNegativeNumber(usage.totalTokens),
		costTotal: normalizeFiniteNonNegativeNumber(usage.costTotal),
	};
}

export function addUsageStats(
	current: SuggestionUsageStats,
	usage: SuggestionUsage,
): SuggestionUsageStats {
	const normalized = normalizeSuggestionUsage(usage);
	return {
		calls: current.calls + 1,
		inputTokens: current.inputTokens + normalized.inputTokens,
		outputTokens: current.outputTokens + normalized.outputTokens,
		cacheReadTokens: current.cacheReadTokens + normalized.cacheReadTokens,
		cacheWriteTokens: current.cacheWriteTokens + normalized.cacheWriteTokens,
		totalTokens: current.totalTokens + normalized.totalTokens,
		costTotal: current.costTotal + normalized.costTotal,
		last: normalized,
	};
}

export function accumulateUsage(
	current: SuggestionUsage,
	usage: SuggestionUsage | undefined,
): SuggestionUsage {
	if (!usage) return current;
	const normalizedCurrent = normalizeSuggestionUsage(current);
	const normalizedUsage = normalizeSuggestionUsage(usage);
	return {
		inputTokens: normalizedCurrent.inputTokens + normalizedUsage.inputTokens,
		outputTokens: normalizedCurrent.outputTokens + normalizedUsage.outputTokens,
		cacheReadTokens:
			normalizedCurrent.cacheReadTokens + normalizedUsage.cacheReadTokens,
		cacheWriteTokens:
			normalizedCurrent.cacheWriteTokens + normalizedUsage.cacheWriteTokens,
		totalTokens: normalizedCurrent.totalTokens + normalizedUsage.totalTokens,
		costTotal: normalizedCurrent.costTotal + normalizedUsage.costTotal,
	};
}

export function cloneUsageStats(
	stats: SuggestionUsageStats,
): SuggestionUsageStats {
	return {
		calls: stats.calls,
		inputTokens: stats.inputTokens,
		outputTokens: stats.outputTokens,
		cacheReadTokens: stats.cacheReadTokens,
		cacheWriteTokens: stats.cacheWriteTokens,
		totalTokens: stats.totalTokens,
		costTotal: stats.costTotal,
		last: stats.last ? { ...stats.last } : undefined,
	};
}

function isObjectRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === "object" && value !== null;
}

export function normalizeFiniteNonNegativeNumber(
	value: unknown,
	fallback = 0,
): number {
	const numeric = typeof value === "number" ? value : Number(value ?? fallback);
	return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

function normalizeUsage(raw: unknown, fallback: SuggestionUsageStats) {
	return isObjectRecord(raw) ? raw : fallback;
}

function normalizeLastUsage(raw: unknown): SuggestionUsage | undefined {
	if (!isObjectRecord(raw)) return undefined;
	return {
		inputTokens: normalizeFiniteNonNegativeNumber(raw.inputTokens),
		outputTokens: normalizeFiniteNonNegativeNumber(raw.outputTokens),
		cacheReadTokens: normalizeFiniteNonNegativeNumber(raw.cacheReadTokens),
		cacheWriteTokens: normalizeFiniteNonNegativeNumber(raw.cacheWriteTokens),
		totalTokens: normalizeFiniteNonNegativeNumber(raw.totalTokens),
		costTotal: normalizeFiniteNonNegativeNumber(raw.costTotal),
	};
}

export function normalizeUsageStats(
	raw: unknown,
	fallback: SuggestionUsageStats = emptyUsageStats(),
): SuggestionUsageStats {
	const usage = normalizeUsage(raw, fallback);
	return {
		calls: normalizeFiniteNonNegativeNumber(usage.calls),
		inputTokens: normalizeFiniteNonNegativeNumber(usage.inputTokens),
		outputTokens: normalizeFiniteNonNegativeNumber(usage.outputTokens),
		cacheReadTokens: normalizeFiniteNonNegativeNumber(usage.cacheReadTokens),
		cacheWriteTokens: normalizeFiniteNonNegativeNumber(usage.cacheWriteTokens),
		totalTokens: normalizeFiniteNonNegativeNumber(usage.totalTokens),
		costTotal: normalizeFiniteNonNegativeNumber(usage.costTotal),
		last: normalizeLastUsage(usage.last),
	};
}
