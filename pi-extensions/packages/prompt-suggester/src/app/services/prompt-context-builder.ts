import type { PromptSuggesterConfig } from "../../config/types";
import type { SeedArtifact } from "../../domain/seed";
import type { SteeringSlice } from "../../domain/steering";
import type { TurnContext } from "../../domain/suggestion";

function truncate(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}…`;
}

export interface SuggestionPromptContext {
	latestAssistantTurn: string;
	turnStatus: TurnContext["status"];
	intentSeed: SeedArtifact | null;
	recentUserPrompts: string[];
	toolSignals: string[];
	touchedFiles: string[];
	unresolvedQuestions: string[];
	abortContextNote?: string;
	recentChanged: SteeringSlice["recentChanged"];
	customInstruction: string;
	noSuggestionToken: string;
	maxSuggestionChars: number;
}

export class PromptContextBuilder {
	public constructor(private readonly config: PromptSuggesterConfig) {}

	public build(
		turn: TurnContext,
		seed: SeedArtifact | null,
		steering: SteeringSlice,
		overrideConfig?: PromptSuggesterConfig,
	): SuggestionPromptContext {
		const config = overrideConfig ?? this.config;
		return {
			latestAssistantTurn: truncate(
				turn.assistantText,
				config.suggestion.maxAssistantTurnChars,
			),
			turnStatus: turn.status,
			intentSeed: seed,
			recentUserPrompts: turn.recentUserPrompts
				.slice(0, config.suggestion.maxRecentUserPrompts)
				.map((prompt) =>
					truncate(prompt, config.suggestion.maxRecentUserPromptChars),
				),
			toolSignals: turn.toolSignals
				.slice(0, config.suggestion.maxToolSignals)
				.map((signal) =>
					truncate(signal, config.suggestion.maxToolSignalChars),
				),
			touchedFiles: turn.touchedFiles.slice(
				0,
				config.suggestion.maxTouchedFiles,
			),
			unresolvedQuestions: turn.unresolvedQuestions.slice(
				0,
				config.suggestion.maxUnresolvedQuestions,
			),
			abortContextNote: turn.abortContextNote
				? truncate(
						turn.abortContextNote,
						config.suggestion.maxAbortContextChars,
					)
				: undefined,
			recentChanged: steering.recentChanged.slice(
				0,
				config.steering.maxChangedExamples,
			),
			customInstruction: config.suggestion.customInstruction,
			noSuggestionToken: config.suggestion.noSuggestionToken,
			maxSuggestionChars: config.suggestion.maxSuggestionChars,
		};
	}
}
