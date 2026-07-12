import type { ThinkingLevel } from "../../config/types";
import type { ReseedTrigger, SeedArtifact, SeedDraft } from "../../domain/seed";
import type { SuggestionUsage } from "../../domain/suggestion";
import type { SuggestionPromptContext } from "../services/prompt-context-builder";
import type { TranscriptSuggestionPromptContext } from "../services/transcript-prompt-context-builder";

export interface ModelInvocationSettings {
	modelRef?: string | string[];
	thinkingLevel?: ThinkingLevel;
}

export type SuggestionModelContext =
	| SuggestionPromptContext
	| TranscriptSuggestionPromptContext;

export interface ModelClient {
	generateSeed(input: {
		reseedTrigger: ReseedTrigger;
		previousSeed: SeedArtifact | null;
		settings?: ModelInvocationSettings;
		runId?: string;
	}): Promise<{ seed: SeedDraft; usage?: SuggestionUsage }>;

	generateSuggestion(
		context: SuggestionModelContext,
		settings?: ModelInvocationSettings,
	): Promise<{
		text: string;
		usage?: SuggestionUsage;
	}>;
}
