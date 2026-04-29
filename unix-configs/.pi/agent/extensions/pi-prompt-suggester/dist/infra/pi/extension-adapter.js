import { buildTurnContext } from "../../app/services/conversation-signals.js";
async function handleSessionEvent(ctx, handler) {
    await handler(ctx);
}
function extractRecentUserPrompts(branchMessages) {
    return [...branchMessages]
        .reverse()
        .filter((message) => typeof message === "object" && message !== null && "role" in message && message.role === "user")
        .map((message) => {
        if (typeof message.content === "string")
            return message.content;
        if (!Array.isArray(message.content))
            return "";
        return message.content
            .map((block) => {
            if (block && typeof block === "object" && "type" in block && block.type === "text") {
                return String(block.text ?? "");
            }
            return "";
        })
            .join("\n");
    })
        .map((text) => text.trim())
        .filter(Boolean);
}
function buildAbortedFallbackTurn(sourceLeafId, branchMessages) {
    return {
        turnId: sourceLeafId,
        sourceLeafId,
        assistantText: "[aborted]",
        assistantUsage: undefined,
        status: "aborted",
        occurredAt: new Date().toISOString(),
        recentUserPrompts: extractRecentUserPrompts(branchMessages),
        toolSignals: [],
        touchedFiles: [],
        unresolvedQuestions: [],
        abortContextNote: "The user explicitly aborted the previous agent turn. Suggest a clear next prompt that either resumes intentionally or redirects the work.",
    };
}
export class PiExtensionAdapter {
    pi;
    wiring;
    constructor(pi, wiring) {
        this.pi = pi;
        this.wiring = wiring;
    }
    register() {
        this.pi.on("session_start", async (_event, ctx) => {
            await handleSessionEvent(ctx, this.wiring.onSessionStart);
        });
        this.pi.on("session_tree", async (_event, ctx) => {
            await handleSessionEvent(ctx, this.wiring.onSessionStart);
        });
        this.pi.on("agent_end", async (event, ctx) => {
            const branchEntries = ctx.sessionManager.getBranch();
            const branchMessages = branchEntries
                .filter((entry) => entry.type === "message")
                .map((entry) => entry.message);
            const sourceLeafId = ctx.sessionManager.getLeafId() ?? `turn-${Date.now()}`;
            const turn = buildTurnContext({
                turnId: sourceLeafId,
                sourceLeafId,
                messagesFromPrompt: event.messages,
                branchMessages,
                occurredAt: new Date().toISOString(),
            });
            if (turn) {
                await this.wiring.onAgentEnd(turn, ctx);
                return;
            }
            if (event.messages.length === 0) {
                await this.wiring.onAgentEnd(buildAbortedFallbackTurn(sourceLeafId, branchMessages), ctx);
            }
        });
        this.pi.on("input", async (event, ctx) => {
            await this.wiring.onUserSubmit(event, ctx);
            return { action: "continue" };
        });
        this.pi.registerCommand("suggesterSettings", {
            description: "Interactive suggester settings menu",
            handler: async (_args, ctx) => {
                await this.wiring.onSettingsUiCommand(ctx);
            },
        });
        this.pi.registerCommand("suggester", {
            description: "suggester controls: status | reseed | model | thinking | instruction | variant | ab | config | seed-trace [limit]",
            handler: async (args, ctx) => {
                const trimmed = args.trim();
                const [subcommand, ...rest] = trimmed.length > 0 ? trimmed.split(/\s+/) : ["status"];
                if (subcommand === "reseed") {
                    await this.wiring.onReseedCommand(ctx);
                    return;
                }
                if (subcommand === "model") {
                    await this.wiring.onModelCommand(rest.join(" "), ctx);
                    return;
                }
                if (subcommand === "thinking") {
                    await this.wiring.onThinkingCommand(rest.join(" "), ctx);
                    return;
                }
                if (subcommand === "config") {
                    await this.wiring.onConfigCommand(rest.join(" "), ctx);
                    return;
                }
                if (subcommand === "instruction") {
                    await this.wiring.onInstructionCommand(rest.join(" "), ctx);
                    return;
                }
                if (subcommand === "variant") {
                    await this.wiring.onVariantCommand(rest.join(" "), ctx);
                    return;
                }
                if (subcommand === "ab") {
                    await this.wiring.onAbCommand(rest.join(" "), ctx);
                    return;
                }
                if (subcommand === "seed-trace") {
                    await this.wiring.onSeedTraceCommand(rest.join(" "), ctx);
                    return;
                }
                await this.wiring.onStatusCommand(ctx);
            },
        });
    }
}
