import { buildSessionContext } from "@mariozechner/pi-coding-agent";
function cloneMessages(messages) {
    return JSON.parse(JSON.stringify(messages));
}
export class PiSessionTranscriptProvider {
    runtime;
    constructor(runtime) {
        this.runtime = runtime;
    }
    getActiveTranscript() {
        const ctx = this.runtime.getContext();
        if (!ctx)
            return undefined;
        const sessionManager = ctx.sessionManager;
        const transcript = typeof sessionManager.buildSessionContext === "function"
            ? sessionManager.buildSessionContext()
            : buildSessionContext(ctx.sessionManager.getBranch(ctx.sessionManager.getLeafId() ?? undefined), ctx.sessionManager.getLeafId() ?? undefined);
        const systemPrompt = ctx.getSystemPrompt().trim();
        if (!systemPrompt)
            return undefined;
        return {
            systemPrompt,
            messages: cloneMessages(transcript.messages),
            contextUsagePercent: ctx.getContextUsage()?.percent ?? undefined,
            sessionId: ctx.sessionManager.getSessionId(),
        };
    }
}
