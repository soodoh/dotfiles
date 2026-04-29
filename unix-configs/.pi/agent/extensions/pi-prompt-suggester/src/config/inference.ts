import type { ThinkingLevel } from "./types.js";

export function toInvocationThinkingLevel(value: string): ThinkingLevel | undefined {
	return value === "session-default" ? undefined : (value as ThinkingLevel);
}
