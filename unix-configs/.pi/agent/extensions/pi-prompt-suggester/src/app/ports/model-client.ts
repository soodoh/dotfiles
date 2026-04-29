import type { ThinkingLevel } from "../../config/types.js";
import type { SeedArtifact, SeedDraft, ReseedTrigger } from "../../domain/seed.js";
import type { SuggestionUsage } from "../../domain/suggestion.js";
import type { SuggestionPromptContext } from "../services/prompt-context-builder.js";
import type { TranscriptSuggestionPromptContext } from "../services/transcript-prompt-context-builder.js";

export interface ModelInvocationSettings {
	modelRef?: string;
	thinkingLevel?: ThinkingLevel;
}

export type SuggestionModelContext = SuggestionPromptContext | TranscriptSuggestionPromptContext;

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
