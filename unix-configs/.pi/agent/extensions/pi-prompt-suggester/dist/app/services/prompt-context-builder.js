function truncate(value, maxChars) {
    if (value.length <= maxChars)
        return value;
    return `${value.slice(0, maxChars)}…`;
}
export class PromptContextBuilder {
    config;
    constructor(config) {
        this.config = config;
    }
    build(turn, seed, steering, overrideConfig) {
        const config = overrideConfig ?? this.config;
        return {
            latestAssistantTurn: truncate(turn.assistantText, config.suggestion.maxAssistantTurnChars),
            turnStatus: turn.status,
            intentSeed: seed,
            recentUserPrompts: turn.recentUserPrompts
                .slice(0, config.suggestion.maxRecentUserPrompts)
                .map((prompt) => truncate(prompt, config.suggestion.maxRecentUserPromptChars)),
            toolSignals: turn.toolSignals
                .slice(0, config.suggestion.maxToolSignals)
                .map((signal) => truncate(signal, config.suggestion.maxToolSignalChars)),
            touchedFiles: turn.touchedFiles.slice(0, config.suggestion.maxTouchedFiles),
            unresolvedQuestions: turn.unresolvedQuestions.slice(0, config.suggestion.maxUnresolvedQuestions),
            abortContextNote: turn.abortContextNote
                ? truncate(turn.abortContextNote, config.suggestion.maxAbortContextChars)
                : undefined,
            recentChanged: steering.recentChanged.slice(0, config.steering.maxChangedExamples),
            customInstruction: config.suggestion.customInstruction,
            noSuggestionToken: config.suggestion.noSuggestionToken,
            maxSuggestionChars: config.suggestion.maxSuggestionChars,
        };
    }
}
