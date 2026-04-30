import type {
	AgentEndEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	InputEvent,
	SessionStartEvent,
	SessionTreeEvent,
} from "@mariozechner/pi-coding-agent";
import { buildTurnContext } from "../../app/services/conversation-signals.js";
import type { TurnContext } from "../../domain/suggestion.js";

export interface ExtensionWiring {
	onSessionStart: (ctx: ExtensionContext) => Promise<void>;
	onAgentEnd: (
		turn: ReturnType<typeof buildTurnContext>,
		ctx: ExtensionContext,
	) => Promise<void>;
	onUserSubmit: (event: InputEvent, ctx: ExtensionContext) => Promise<void>;
	onReseedCommand: (ctx: ExtensionCommandContext) => Promise<void>;
	onStatusCommand: (ctx: ExtensionCommandContext) => Promise<void>;
	onSeedTraceCommand: (
		args: string,
		ctx: ExtensionCommandContext,
	) => Promise<void>;
}

function isStaleExtensionContextError(error: unknown): boolean {
	return (
		error instanceof Error && error.message.includes("extension ctx is stale")
	);
}

async function ignoreStaleContext(work: () => Promise<void>): Promise<void> {
	try {
		await work();
	} catch (error) {
		if (!isStaleExtensionContextError(error)) throw error;
	}
}

async function handleSessionEvent(
	ctx: ExtensionContext,
	handler: (ctx: ExtensionContext) => Promise<void>,
): Promise<void> {
	await handler(ctx);
}

function extractRecentUserPrompts(branchMessages: unknown[]): string[] {
	return [...branchMessages]
		.reverse()
		.filter(
			(message): message is { role: string; content?: unknown } =>
				typeof message === "object" &&
				message !== null &&
				"role" in message &&
				(message as { role: string }).role === "user",
		)
		.map((message) => {
			if (typeof message.content === "string") return message.content;
			if (!Array.isArray(message.content)) return "";
			return message.content
				.map((block) => {
					if (
						block &&
						typeof block === "object" &&
						"type" in block &&
						(block as { type?: string }).type === "text"
					) {
						return String((block as { text?: unknown }).text ?? "");
					}
					return "";
				})
				.join("\n");
		})
		.map((text) => text.trim())
		.filter(Boolean);
}

function buildAbortedFallbackTurn(
	sourceLeafId: string,
	branchMessages: unknown[],
): TurnContext {
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
		abortContextNote:
			"The user explicitly aborted the previous agent turn. Suggest a clear next prompt that either resumes intentionally or redirects the work.",
	};
}

export class PiExtensionAdapter {
	public constructor(
		private readonly pi: ExtensionAPI,
		private readonly wiring: ExtensionWiring,
	) {}

	public register(): void {
		this.pi.on("session_start", async (_event: SessionStartEvent, ctx) => {
			await ignoreStaleContext(() =>
				handleSessionEvent(ctx, this.wiring.onSessionStart),
			);
		});
		this.pi.on("session_tree", async (_event: SessionTreeEvent, ctx) => {
			await ignoreStaleContext(() =>
				handleSessionEvent(ctx, this.wiring.onSessionStart),
			);
		});

		this.pi.on("agent_end", async (event: AgentEndEvent, ctx) => {
			await ignoreStaleContext(async () => {
				const branchEntries = ctx.sessionManager.getBranch();
				const branchMessages = branchEntries
					.filter(
						(
							entry,
						): entry is (typeof branchEntries)[number] & { type: "message" } =>
							entry.type === "message",
					)
					.map((entry) => entry.message);
				const sourceLeafId =
					ctx.sessionManager.getLeafId() ?? `turn-${Date.now()}`;
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
					await this.wiring.onAgentEnd(
						buildAbortedFallbackTurn(sourceLeafId, branchMessages),
						ctx,
					);
				}
			});
		});

		this.pi.on("input", async (event: InputEvent, ctx) => {
			await ignoreStaleContext(() => this.wiring.onUserSubmit(event, ctx));
			return { action: "continue" };
		});

		this.pi.registerCommand("suggester", {
			description: "suggester controls: status | reseed | seed-trace [limit]",
			handler: async (args, ctx) => {
				await ignoreStaleContext(async () => {
					const trimmed = args.trim();
					const [subcommand, ...rest] =
						trimmed.length > 0 ? trimmed.split(/\s+/) : ["status"];
					if (subcommand === "reseed") {
						await this.wiring.onReseedCommand(ctx);
						return;
					}
					if (subcommand === "seed-trace") {
						await this.wiring.onSeedTraceCommand(rest.join(" "), ctx);
						return;
					}
					await this.wiring.onStatusCommand(ctx);
				});
			},
		});
	}
}
