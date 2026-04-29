export function createEmptyUsage() {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        costTotal: 0,
    };
}
export function emptyUsageStats() {
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
export function addUsageStats(current, usage) {
    return {
        calls: current.calls + 1,
        inputTokens: current.inputTokens + usage.inputTokens,
        outputTokens: current.outputTokens + usage.outputTokens,
        cacheReadTokens: current.cacheReadTokens + usage.cacheReadTokens,
        cacheWriteTokens: current.cacheWriteTokens + usage.cacheWriteTokens,
        totalTokens: current.totalTokens + usage.totalTokens,
        costTotal: current.costTotal + usage.costTotal,
        last: usage,
    };
}
export function accumulateUsage(current, usage) {
    if (!usage)
        return current;
    return {
        inputTokens: current.inputTokens + usage.inputTokens,
        outputTokens: current.outputTokens + usage.outputTokens,
        cacheReadTokens: current.cacheReadTokens + usage.cacheReadTokens,
        cacheWriteTokens: current.cacheWriteTokens + usage.cacheWriteTokens,
        totalTokens: current.totalTokens + usage.totalTokens,
        costTotal: current.costTotal + usage.costTotal,
    };
}
export function cloneUsageStats(stats) {
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
export function normalizeUsageStats(raw, fallback = emptyUsageStats()) {
    const usage = (raw ?? fallback);
    return {
        calls: Number(usage.calls ?? 0),
        inputTokens: Number(usage.inputTokens ?? 0),
        outputTokens: Number(usage.outputTokens ?? 0),
        cacheReadTokens: Number(usage.cacheReadTokens ?? 0),
        cacheWriteTokens: Number(usage.cacheWriteTokens ?? 0),
        totalTokens: Number(usage.totalTokens ?? 0),
        costTotal: Number(usage.costTotal ?? 0),
        last: usage.last,
    };
}
