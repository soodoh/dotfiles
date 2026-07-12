import type { InferenceConfig, ThinkingLevel } from "./types";

type ConfiguredThinkingLevel = InferenceConfig["seederThinking"];

export function toInvocationThinkingLevel(
	value: ConfiguredThinkingLevel,
): ThinkingLevel | undefined {
	return value === "session-default" ? undefined : value;
}
