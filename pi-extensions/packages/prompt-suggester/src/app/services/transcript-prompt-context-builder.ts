import type { Message } from "@mariozechner/pi-ai";
import type { PromptSuggesterConfig } from "../../config/types";
import type { SeedArtifact } from "../../domain/seed";
import type { SteeringSlice } from "../../domain/steering";
import type { SessionTranscriptProvider } from "../ports/session-transcript";

function textFromContent(content: Message["content"]): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (block && typeof block === "object") {
				if (block.type === "text") return String(block.text ?? "");
				if (block.type === "thinking") return String(block.thinking ?? "");
				if (block.type === "toolCall") {
					return `${block.name}(${JSON.stringify(block.arguments ?? {})})`;
				}
			}
			return "";
		})
		.join("\n")
		.trim();
}

function estimateTranscriptChars(messages: Message[]): number {
	return messages.reduce(
		(sum, message) => sum + textFromContent(message.content).length,
		0,
	);
}

function truncateMessageContent(message: Message, maxChars: number): Message {
	const text = textFromContent(message.content).slice(0, Math.max(0, maxChars));
	if (message.role === "user" && typeof message.content === "string") {
		return { ...message, content: text };
	}
	return { ...message, content: [{ type: "text", text }] };
}

function capTranscriptMessages(
	messages: Message[],
	maxMessages: number,
	maxChars: number,
): Message[] {
	const capped = structuredClone(messages).slice(-maxMessages);
	while (capped.length > 1 && estimateTranscriptChars(capped) > maxChars) {
		capped.shift();
	}
	if (estimateTranscriptChars(capped) > maxChars && capped.length > 0) {
		const newest = capped.at(-1);
		if (newest)
			capped[capped.length - 1] = truncateMessageContent(newest, maxChars);
	}
	return capped;
}

export interface TranscriptSuggestionPromptContext {
	systemPrompt: string;
	transcriptMessages: Message[];
	transcriptMessageCount: number;
	transcriptCharCount: number;
	contextUsagePercent?: number;
	sessionId?: string;
	intentSeed: SeedArtifact | null;
	recentChanged: SteeringSlice["recentChanged"];
	customInstruction: string;
	noSuggestionToken: string;
	maxSuggestionChars: number;
}

export class TranscriptPromptContextBuilder {
	public constructor(
		private readonly config: PromptSuggesterConfig,
		private readonly transcriptProvider: SessionTranscriptProvider,
	) {}

	public build(
		seed: SeedArtifact | null,
		steering: SteeringSlice,
		overrideConfig?: PromptSuggesterConfig,
	): TranscriptSuggestionPromptContext {
		const config = overrideConfig ?? this.config;
		const transcript = this.transcriptProvider.getActiveTranscript();
		if (!transcript) {
			throw new Error(
				"No active session transcript available for transcript-steering suggestion mode",
			);
		}
		if (!transcript.systemPrompt.trim()) {
			throw new Error("Active session transcript is missing a system prompt");
		}
		const transcriptMessages = capTranscriptMessages(
			transcript.messages,
			config.suggestion.transcriptMaxMessages,
			config.suggestion.transcriptMaxChars,
		);
		return {
			systemPrompt: transcript.systemPrompt,
			transcriptMessages,
			transcriptMessageCount: transcriptMessages.length,
			transcriptCharCount: estimateTranscriptChars(transcriptMessages),
			contextUsagePercent: transcript.contextUsagePercent,
			sessionId: transcript.sessionId,
			intentSeed: seed,
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
