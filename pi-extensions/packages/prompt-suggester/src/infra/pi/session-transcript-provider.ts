import type { Message } from "@mariozechner/pi-ai";
import {
	buildSessionContext,
	type SessionContext,
	type SessionEntry,
} from "@mariozechner/pi-coding-agent";
import type { SessionTranscriptProvider } from "../../app/ports/session-transcript";

function isMessage(value: unknown): value is Message {
	return (
		typeof value === "object" &&
		value !== null &&
		"role" in value &&
		(value.role === "user" ||
			value.role === "assistant" ||
			value.role === "toolResult")
	);
}

function cloneMessages(messages: unknown[]): Message[] {
	return structuredClone(messages.filter(isMessage));
}

type SessionManagerWithContext = {
	getLeafId(): string | null;
	getBranch(fromId?: string): SessionEntry[];
	getSessionId(): string;
	buildSessionContext?: () => SessionContext;
};

type RuntimeContextLike = {
	sessionManager: SessionManagerWithContext;
	getSystemPrompt(): string;
	getContextUsage?(): { percent: number | null } | undefined;
};

type RuntimeContextProvider = {
	getContext(): RuntimeContextLike | undefined;
};

export class PiSessionTranscriptProvider implements SessionTranscriptProvider {
	public constructor(private readonly runtime: RuntimeContextProvider) {}

	public getActiveTranscript() {
		const ctx = this.runtime.getContext();
		if (!ctx) return undefined;
		try {
			const sessionManager = ctx.sessionManager;
			const transcript =
				typeof sessionManager.buildSessionContext === "function"
					? sessionManager.buildSessionContext()
					: buildSessionContext(
							sessionManager.getBranch(sessionManager.getLeafId() ?? undefined),
							sessionManager.getLeafId() ?? undefined,
						);
			const systemPrompt = ctx.getSystemPrompt().trim();
			if (!systemPrompt) return undefined;
			return {
				systemPrompt,
				messages: cloneMessages(transcript.messages),
				contextUsagePercent: ctx.getContextUsage?.()?.percent ?? undefined,
				sessionId: ctx.sessionManager.getSessionId(),
			};
		} catch {
			return undefined;
		}
	}
}
