export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh";
type InferenceDefault = "session-default";
export type SuggestionStrategy = "compact" | "transcript-steering";
export type GhostAcceptKey = "space" | "right" | "enter";

export interface SeedConfig {
	maxDiffChars: number;
}

export interface ReseedConfig {
	enabled: boolean;
	checkOnSessionStart: boolean;
	checkAfterEveryTurn: boolean;
	turnCheckInterval: number;
}

export interface SuggestionConfig {
	noSuggestionToken: string;
	customInstruction: string;
	fastPathContinueOnError: boolean;
	ghostAcceptKeys: GhostAcceptKey[];
	ghostAcceptAndSendKeys: GhostAcceptKey[];
	maxAssistantTurnChars: number;
	maxRecentUserPrompts: number;
	maxRecentUserPromptChars: number;
	maxToolSignals: number;
	maxToolSignalChars: number;
	maxTouchedFiles: number;
	maxUnresolvedQuestions: number;
	maxAbortContextChars: number;
	maxSuggestionChars: number;
	prefillOnlyWhenEditorEmpty: boolean;
	showUsageInPanel: boolean;
	showPanelStatus: boolean;
	strategy: SuggestionStrategy;
	transcriptMaxContextPercent: number;
	transcriptMaxMessages: number;
	transcriptMaxChars: number;
	transcriptRolloutPercent: number;
}

export interface SteeringConfig {
	historyWindow: number;
	acceptedThreshold: number;
	maxChangedExamples: number;
}

export interface LoggingConfig {
	level: "debug" | "info" | "warn" | "error";
}

export interface InferenceConfig {
	seederModel: string;
	suggesterModel: string[];
	seederThinking: ThinkingLevel | InferenceDefault;
	suggesterThinking: ThinkingLevel | InferenceDefault;
}

export interface PromptSuggesterConfig {
	schemaVersion: number;
	seed: SeedConfig;
	reseed: ReseedConfig;
	suggestion: SuggestionConfig;
	steering: SteeringConfig;
	logging: LoggingConfig;
	inference: InferenceConfig;
}
