export type TurnStatus = "success" | "error" | "aborted";
export type SuggestionStrategy = "compact" | "transcript-steering";

export interface SuggestionUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalTokens: number;
	costTotal: number;
}

export interface SuggestionMetadata {
	requestedStrategy: SuggestionStrategy;
	strategy: SuggestionStrategy;
	variantName?: string;
	sampledOut?: boolean;
	fallbackReason?: string;
	transcriptMessageCount?: number;
	transcriptCharCount?: number;
	contextUsagePercent?: number;
	latencyMs?: number;
}

export interface TurnContext {
	turnId: string;
	sourceLeafId: string;
	assistantText: string;
	assistantUsage?: SuggestionUsage;
	status: TurnStatus;
	occurredAt: string;
	recentUserPrompts: string[];
	toolSignals: string[];
	touchedFiles: string[];
	unresolvedQuestions: string[];
	abortContextNote?: string;
}

export interface PromptSuggestion {
	kind: "suggestion";
	text: string;
	usage?: SuggestionUsage;
	metadata?: SuggestionMetadata;
}

export interface NoSuggestion {
	kind: "no_suggestion";
	text: string;
	usage?: SuggestionUsage;
	metadata?: SuggestionMetadata;
}

export type SuggestionResult = PromptSuggestion | NoSuggestion;
