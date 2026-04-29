function normalizeSuggestion(value, maxChars) {
    const normalizedLineEndings = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const trimmedTrailing = normalizedLineEndings
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return trimmedTrailing.length > maxChars ? trimmedTrailing.slice(0, maxChars).trimEnd() : trimmedTrailing;
}
function stableSamplePercent(seed) {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
        hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    return hash % 100;
}
export class SuggestionEngine {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async suggest(turn, seed, steering, settings, overrideConfig) {
        const config = overrideConfig ?? this.deps.config;
        if (config.suggestion.fastPathContinueOnError && turn.status !== "success") {
            return {
                kind: "suggestion",
                text: "continue",
                metadata: {
                    requestedStrategy: config.suggestion.strategy,
                    strategy: "compact",
                    fallbackReason: "fast_path_continue",
                },
            };
        }
        const raw = await this.generateWithBestAvailableStrategy(turn, seed, steering, settings, config);
        const normalized = normalizeSuggestion(raw.text, config.suggestion.maxSuggestionChars);
        if (!normalized || normalized === config.suggestion.noSuggestionToken) {
            return {
                kind: "no_suggestion",
                text: config.suggestion.noSuggestionToken,
                usage: raw.usage,
                metadata: raw.metadata,
            };
        }
        return {
            kind: "suggestion",
            text: normalized,
            usage: raw.usage,
            metadata: raw.metadata,
        };
    }
    async generateWithBestAvailableStrategy(turn, seed, steering, settings, config) {
        const requestedStrategy = config.suggestion.strategy;
        if (requestedStrategy === "transcript-steering" && this.deps.transcriptPromptContextBuilder) {
            const sampledOut = config.suggestion.transcriptRolloutPercent < 100 &&
                stableSamplePercent(turn.turnId || turn.sourceLeafId) >= config.suggestion.transcriptRolloutPercent;
            if (sampledOut) {
                return await this.generateCompactSuggestion(turn, seed, steering, settings, config, {
                    requestedStrategy,
                    sampledOut: true,
                    fallbackReason: "transcript_rollout_skip",
                });
            }
            try {
                const transcriptContext = this.deps.transcriptPromptContextBuilder.build(seed, steering, config);
                const overContextLimit = typeof transcriptContext.contextUsagePercent === "number" &&
                    transcriptContext.contextUsagePercent > config.suggestion.transcriptMaxContextPercent;
                if (overContextLimit) {
                    return await this.generateCompactSuggestion(turn, seed, steering, settings, config, {
                        requestedStrategy,
                        fallbackReason: "transcript_context_limit",
                        contextUsagePercent: transcriptContext.contextUsagePercent,
                        transcriptMessageCount: transcriptContext.transcriptMessageCount,
                        transcriptCharCount: transcriptContext.transcriptCharCount,
                    });
                }
                const result = await this.deps.modelClient.generateSuggestion(transcriptContext, settings);
                return {
                    text: result.text,
                    usage: result.usage,
                    metadata: {
                        requestedStrategy,
                        strategy: "transcript-steering",
                        contextUsagePercent: transcriptContext.contextUsagePercent,
                        transcriptMessageCount: transcriptContext.transcriptMessageCount,
                        transcriptCharCount: transcriptContext.transcriptCharCount,
                    },
                };
            }
            catch (error) {
                return await this.generateCompactSuggestion(turn, seed, steering, settings, config, {
                    requestedStrategy,
                    fallbackReason: `transcript_error:${error.message}`,
                });
            }
        }
        return await this.generateCompactSuggestion(turn, seed, steering, settings, config, {
            requestedStrategy,
        });
    }
    async generateCompactSuggestion(turn, seed, steering, settings, config, metadata) {
        const context = this.deps.promptContextBuilder.build(turn, seed, steering, config);
        const result = await this.deps.modelClient.generateSuggestion(context, settings);
        return {
            text: result.text,
            usage: result.usage,
            metadata: {
                ...metadata,
                strategy: "compact",
            },
        };
    }
}
