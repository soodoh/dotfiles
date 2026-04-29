import { CURRENT_RUNTIME_STATE_VERSION, INITIAL_RUNTIME_STATE } from "../../domain/state.js";
import { addUsageStats, cloneUsageStats, emptyUsageStats, normalizeUsageStats } from "../../domain/usage.js";
import { LEGACY_STATE_CUSTOM_TYPE, LEGACY_USAGE_CUSTOM_TYPE, } from "./session-state-types.js";
export function emptyUsagePair() {
    return {
        suggester: emptyUsageStats(),
        seeder: emptyUsageStats(),
    };
}
export function cloneUsagePair(pair) {
    return {
        suggester: cloneUsageStats(pair.suggester),
        seeder: cloneUsageStats(pair.seeder),
    };
}
export function parseUsage(raw) {
    if (!raw || typeof raw !== "object")
        return undefined;
    const usage = raw;
    if (typeof usage.inputTokens !== "number" ||
        typeof usage.outputTokens !== "number" ||
        typeof usage.cacheReadTokens !== "number" ||
        typeof usage.cacheWriteTokens !== "number" ||
        typeof usage.totalTokens !== "number" ||
        typeof usage.costTotal !== "number") {
        return undefined;
    }
    return {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        totalTokens: usage.totalTokens,
        costTotal: usage.costTotal,
    };
}
export function normalizeInteractionState(raw) {
    const latest = (raw ?? INITIAL_RUNTIME_STATE);
    return {
        stateVersion: CURRENT_RUNTIME_STATE_VERSION,
        lastSuggestion: latest.lastSuggestion,
        pendingNextTurnObservation: latest.pendingNextTurnObservation,
        steeringHistory: Array.isArray(latest.steeringHistory) ? latest.steeringHistory : [],
        turnsSinceLastStalenessCheck: Math.max(0, Number(latest.turnsSinceLastStalenessCheck ?? 0)),
    };
}
export function toRuntimeState(interaction, usage) {
    return {
        stateVersion: CURRENT_RUNTIME_STATE_VERSION,
        lastSuggestion: interaction.lastSuggestion,
        pendingNextTurnObservation: interaction.pendingNextTurnObservation,
        steeringHistory: interaction.steeringHistory,
        suggestionUsage: cloneUsageStats(usage.suggester),
        seederUsage: cloneUsageStats(usage.seeder),
        turnsSinceLastStalenessCheck: interaction.turnsSinceLastStalenessCheck,
    };
}
export function toPersistedInteractionState(state) {
    return normalizeInteractionState({
        stateVersion: CURRENT_RUNTIME_STATE_VERSION,
        lastSuggestion: state.lastSuggestion,
        pendingNextTurnObservation: state.pendingNextTurnObservation,
        steeringHistory: state.steeringHistory,
        turnsSinceLastStalenessCheck: state.turnsSinceLastStalenessCheck,
    });
}
export function extractUsageTotals(entries) {
    let hasLedger = false;
    let legacyUsageEntryCount = 0;
    let suggester = emptyUsageStats();
    let seeder = emptyUsageStats();
    for (const entry of entries) {
        if (entry.type !== "custom" || entry.customType !== LEGACY_USAGE_CUSTOM_TYPE)
            continue;
        legacyUsageEntryCount += 1;
        const data = entry.data;
        const usage = parseUsage(data?.usage);
        if (!usage)
            continue;
        hasLedger = true;
        if (data.kind === "seeder")
            seeder = addUsageStats(seeder, usage);
        else
            suggester = addUsageStats(suggester, usage);
    }
    return { hasLedger, suggester, seeder, legacyUsageEntryCount };
}
export function extractLegacyInteractionSnapshots(entries) {
    const snapshots = new Map();
    for (const entry of entries) {
        if (entry.type !== "custom" || entry.customType !== LEGACY_STATE_CUSTOM_TYPE)
            continue;
        snapshots.set(entry.id, normalizeInteractionState(entry.data));
    }
    return snapshots;
}
export function normalizePersistedUsagePair(raw) {
    return {
        suggester: normalizeUsageStats(raw?.suggestionUsage, emptyUsageStats()),
        seeder: normalizeUsageStats(raw?.seederUsage, emptyUsageStats()),
    };
}
