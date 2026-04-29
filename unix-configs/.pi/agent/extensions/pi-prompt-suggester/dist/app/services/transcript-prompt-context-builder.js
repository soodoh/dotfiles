function textFromContent(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    return content
        .map((block) => {
        if (block && typeof block === "object") {
            if (block.type === "text")
                return String(block.text ?? "");
            if (block.type === "thinking")
                return String(block.thinking ?? "");
            if (block.type === "toolCall") {
                return `${block.name}(${JSON.stringify(block.arguments ?? {})})`;
            }
        }
        return "";
    })
        .join("\n")
        .trim();
}
function estimateTranscriptChars(messages) {
    return messages.reduce((sum, message) => sum + textFromContent(message.content).length, 0);
}
function cloneMessages(messages) {
    return JSON.parse(JSON.stringify(messages));
}
export class TranscriptPromptContextBuilder {
    config;
    transcriptProvider;
    constructor(config, transcriptProvider) {
        this.config = config;
        this.transcriptProvider = transcriptProvider;
    }
    build(seed, steering, overrideConfig) {
        const config = overrideConfig ?? this.config;
        const transcript = this.transcriptProvider.getActiveTranscript();
        if (!transcript) {
            throw new Error("No active session transcript available for transcript-steering suggestion mode");
        }
        if (!transcript.systemPrompt.trim()) {
            throw new Error("Active session transcript is missing a system prompt");
        }
        const transcriptMessages = cloneMessages(transcript.messages);
        return {
            systemPrompt: transcript.systemPrompt,
            transcriptMessages,
            transcriptMessageCount: transcriptMessages.length,
            transcriptCharCount: estimateTranscriptChars(transcriptMessages),
            contextUsagePercent: transcript.contextUsagePercent,
            sessionId: transcript.sessionId,
            intentSeed: seed,
            recentChanged: steering.recentChanged.slice(0, config.steering.maxChangedExamples),
            customInstruction: config.suggestion.customInstruction,
            noSuggestionToken: config.suggestion.noSuggestionToken,
            maxSuggestionChars: config.suggestion.maxSuggestionChars,
        };
    }
}
