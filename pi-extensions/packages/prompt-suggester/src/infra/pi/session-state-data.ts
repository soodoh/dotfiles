import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import {
	CURRENT_RUNTIME_STATE_VERSION,
	INITIAL_RUNTIME_STATE,
	type RuntimeState,
	type SuggestionUsageStats,
} from "../../domain/state";
import type { SuggestionUsage } from "../../domain/suggestion";
import {
	addUsageStats,
	cloneUsageStats,
	emptyUsageStats,
	normalizeFiniteNonNegativeNumber,
	normalizeUsageStats,
} from "../../domain/usage";
import {
	LEGACY_STATE_CUSTOM_TYPE,
	LEGACY_USAGE_CUSTOM_TYPE,
	type PersistedInteractionState,
	type SuggestionUsageStatsPair,
} from "./session-state-types";

export function emptyUsagePair(): SuggestionUsageStatsPair {
	return {
		suggester: emptyUsageStats(),
		seeder: emptyUsageStats(),
	};
}

function isObjectRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === "object" && value !== null;
}

function isSuggestionStrategy(
	value: unknown,
): value is "compact" | "transcript-steering" {
	return value === "compact" || value === "transcript-steering";
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function optionalSuggestionStrategy(
	value: unknown,
): "compact" | "transcript-steering" | undefined {
	return isSuggestionStrategy(value) ? value : undefined;
}

function parseLastSuggestion(
	raw: unknown,
): RuntimeState["lastSuggestion"] | undefined {
	if (!isObjectRecord(raw)) return undefined;
	if (
		typeof raw.text !== "string" ||
		typeof raw.shownAt !== "string" ||
		typeof raw.turnId !== "string" ||
		typeof raw.sourceLeafId !== "string"
	) {
		return undefined;
	}
	return {
		text: raw.text,
		shownAt: raw.shownAt,
		turnId: raw.turnId,
		sourceLeafId: raw.sourceLeafId,
		variantName: optionalString(raw.variantName),
		strategy: optionalSuggestionStrategy(raw.strategy),
		requestedStrategy: optionalSuggestionStrategy(raw.requestedStrategy),
	};
}

function parsePendingNextTurnObservation(
	raw: unknown,
): RuntimeState["pendingNextTurnObservation"] | undefined {
	if (!isObjectRecord(raw)) return undefined;
	if (
		typeof raw.suggestionTurnId !== "string" ||
		typeof raw.suggestionShownAt !== "string" ||
		typeof raw.userPromptSubmittedAt !== "string"
	) {
		return undefined;
	}
	return {
		suggestionTurnId: raw.suggestionTurnId,
		suggestionShownAt: raw.suggestionShownAt,
		userPromptSubmittedAt: raw.userPromptSubmittedAt,
		variantName: optionalString(raw.variantName),
		strategy: optionalSuggestionStrategy(raw.strategy),
		requestedStrategy: optionalSuggestionStrategy(raw.requestedStrategy),
	};
}

function isSteeringClassification(
	value: unknown,
): value is "accepted_exact" | "accepted_edited" | "changed_course" {
	return (
		value === "accepted_exact" ||
		value === "accepted_edited" ||
		value === "changed_course"
	);
}

function parseSteeringHistory(raw: unknown): RuntimeState["steeringHistory"] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((entry) => {
		if (!isObjectRecord(entry)) return [];
		if (
			typeof entry.turnId !== "string" ||
			typeof entry.suggestedPrompt !== "string" ||
			typeof entry.actualUserPrompt !== "string" ||
			!isSteeringClassification(entry.classification) ||
			typeof entry.similarity !== "number" ||
			!Number.isFinite(entry.similarity) ||
			typeof entry.timestamp !== "string"
		) {
			return [];
		}
		return [
			{
				turnId: entry.turnId,
				suggestedPrompt: entry.suggestedPrompt,
				actualUserPrompt: entry.actualUserPrompt,
				classification: entry.classification,
				similarity: entry.similarity,
				timestamp: entry.timestamp,
			},
		];
	});
}

function parseUsage(raw: unknown): SuggestionUsage | undefined {
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

export function normalizeInteractionState(
	raw: unknown,
): PersistedInteractionState {
	const latest = isObjectRecord(raw) ? raw : INITIAL_RUNTIME_STATE;
	return {
		stateVersion: CURRENT_RUNTIME_STATE_VERSION,
		lastSuggestion: parseLastSuggestion(latest.lastSuggestion),
		pendingNextTurnObservation: parsePendingNextTurnObservation(
			latest.pendingNextTurnObservation,
		),
		steeringHistory: parseSteeringHistory(latest.steeringHistory),
		turnsSinceLastStalenessCheck: normalizeFiniteNonNegativeNumber(
			latest.turnsSinceLastStalenessCheck,
		),
	};
}

export function toRuntimeState(
	interaction: PersistedInteractionState,
	usage: SuggestionUsageStatsPair,
): RuntimeState {
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

export function toPersistedInteractionState(
	state: RuntimeState,
): PersistedInteractionState {
	return normalizeInteractionState({
		stateVersion: CURRENT_RUNTIME_STATE_VERSION,
		lastSuggestion: state.lastSuggestion,
		pendingNextTurnObservation: state.pendingNextTurnObservation,
		steeringHistory: state.steeringHistory,
		turnsSinceLastStalenessCheck: state.turnsSinceLastStalenessCheck,
	});
}

export function extractUsageTotals(entries: SessionEntry[]): {
	hasLedger: boolean;
	suggester: SuggestionUsageStats;
	seeder: SuggestionUsageStats;
	legacyUsageEntryCount: number;
} {
	let hasLedger = false;
	let legacyUsageEntryCount = 0;
	let suggester = emptyUsageStats();
	let seeder = emptyUsageStats();

	for (const entry of entries) {
		if (
			entry.type !== "custom" ||
			entry.customType !== LEGACY_USAGE_CUSTOM_TYPE
		)
			continue;
		legacyUsageEntryCount += 1;
		const data = isObjectRecord(entry.data) ? entry.data : undefined;
		const usage = parseUsage(data?.usage);
		if (!usage) continue;
		hasLedger = true;
		if (data?.kind === "seeder") seeder = addUsageStats(seeder, usage);
		else suggester = addUsageStats(suggester, usage);
	}

	return { hasLedger, suggester, seeder, legacyUsageEntryCount };
}

export function extractLegacyInteractionSnapshots(
	entries: SessionEntry[],
): Map<string, PersistedInteractionState> {
	const snapshots = new Map<string, PersistedInteractionState>();
	for (const entry of entries) {
		if (
			entry.type !== "custom" ||
			entry.customType !== LEGACY_STATE_CUSTOM_TYPE
		)
			continue;
		snapshots.set(entry.id, normalizeInteractionState(entry.data));
	}
	return snapshots;
}

export function normalizePersistedUsagePair(
	raw:
		| {
				suggestionUsage?: unknown;
				seederUsage?: unknown;
		  }
		| undefined,
): SuggestionUsageStatsPair {
	return {
		suggester: normalizeUsageStats(raw?.suggestionUsage, emptyUsageStats()),
		seeder: normalizeUsageStats(raw?.seederUsage, emptyUsageStats()),
	};
}
