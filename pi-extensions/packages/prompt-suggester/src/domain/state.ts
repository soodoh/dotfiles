import type { SteeringEvent } from "./steering";
import type { SuggestionStrategy, SuggestionUsage } from "./suggestion";
import { emptyUsageStats } from "./usage";

export const CURRENT_RUNTIME_STATE_VERSION = 9;

interface LastSuggestionState {
	text: string;
	shownAt: string;
	turnId: string;
	sourceLeafId: string;
	variantName?: string;
	strategy?: SuggestionStrategy;
	requestedStrategy?: SuggestionStrategy;
}

interface PendingNextTurnObservation {
	suggestionTurnId: string;
	suggestionShownAt: string;
	userPromptSubmittedAt: string;
	variantName?: string;
	strategy?: SuggestionStrategy;
	requestedStrategy?: SuggestionStrategy;
}

export interface SuggestionUsageStats {
	calls: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	costTotal: number;
	last?: SuggestionUsage;
}

export interface RuntimeState {
	stateVersion: number;
	lastSuggestion?: LastSuggestionState;
	pendingNextTurnObservation?: PendingNextTurnObservation;
	steeringHistory: SteeringEvent[];
	suggestionUsage: SuggestionUsageStats;
	seederUsage: SuggestionUsageStats;
	turnsSinceLastStalenessCheck: number;
}

export const INITIAL_RUNTIME_STATE: RuntimeState = {
	stateVersion: CURRENT_RUNTIME_STATE_VERSION,
	steeringHistory: [],
	suggestionUsage: emptyUsageStats(),
	seederUsage: emptyUsageStats(),
	turnsSinceLastStalenessCheck: 0,
};
