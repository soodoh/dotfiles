import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { InputEvent } from "@mariozechner/pi-coding-agent";
import { buildTurnContext } from "../../app/services/conversation-signals";
import type { TurnContext } from "../../domain/suggestion";

export type PromptSuggesterBranchEntry = {
	type: string;
	id?: string;
	message?: unknown;
};

export type PromptSuggesterExtensionContext = {
	hasUI: boolean;
	sessionManager: {
		getCwd(): string;
		getSessionFile(): string | undefined;
		getSessionId?: () => string;
		getLeafId(): string | null | undefined;
		getBranch(): PromptSuggesterBranchEntry[];
	};
};

type PromptSuggesterHandler = (
	event: unknown,
	ctx: PromptSuggesterExtensionContext,
) => void | Promise<void>;

type PromptSuggesterInputResult = { action: "continue" } | undefined;

type PromptSuggesterInputHandler = (
	event: unknown,
	ctx: PromptSuggesterExtensionContext,
) => PromptSuggesterInputResult | Promise<PromptSuggesterInputResult>;

export type PiExtensionEventApi = {
	on(event: "input", handler: PromptSuggesterInputHandler): void;
	on(
		event: "session_start" | "session_tree" | "session_shutdown",
		handler: PromptSuggesterHandler,
	): void;
	on(event: "agent_end", handler: PromptSuggesterHandler): void;
};

interface ExtensionWiring {
	onSessionStart: (ctx: PromptSuggesterExtensionContext) => Promise<void>;
	onAgentEnd: (
		turn: ReturnType<typeof buildTurnContext>,
		ctx: PromptSuggesterExtensionContext,
	) => Promise<void>;
	onUserSubmit: (
		event: InputEvent,
		ctx: PromptSuggesterExtensionContext,
	) => Promise<void>;
}

function isObjectRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === "object" && value !== null;
}

function isAgentMessage(value: unknown): value is AgentMessage {
	if (!isObjectRecord(value)) return false;
	return (
		value.role === "user" ||
		value.role === "assistant" ||
		value.role === "toolResult"
	);
}

function isMessageBranchEntry(
	entry: PromptSuggesterBranchEntry,
): entry is PromptSuggesterBranchEntry & {
	type: "message";
	message: AgentMessage;
} {
	return entry.type === "message" && isAgentMessage(entry.message);
}

function getAgentEndMessages(event: unknown): AgentMessage[] {
	if (!isObjectRecord(event) || !Array.isArray(event.messages)) return [];
	return event.messages.filter(isAgentMessage);
}

function isInputSource(value: unknown): value is InputEvent["source"] {
	return value === "interactive" || value === "rpc" || value === "extension";
}

function isInputEvent(event: unknown): event is InputEvent {
	return (
		isObjectRecord(event) &&
		event.type === "input" &&
		typeof event.text === "string" &&
		isInputSource(event.source)
	);
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
	ctx: PromptSuggesterExtensionContext,
	handler: (ctx: PromptSuggesterExtensionContext) => Promise<void>,
): Promise<void> {
	await handler(ctx);
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (!isObjectRecord(block) || block.type !== "text") return "";
			return String(block.text ?? "");
		})
		.join("\n");
}

function extractRecentUserPrompts(branchMessages: unknown[]): string[] {
	return [...branchMessages]
		.reverse()
		.filter(
			(message): message is Record<PropertyKey, unknown> =>
				isObjectRecord(message) && message.role === "user",
		)
		.map((message) => textFromContent(message.content))
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
		private readonly pi: PiExtensionEventApi,
		private readonly wiring: ExtensionWiring,
	) {}

	public register(): void {
		this.pi.on("session_start", async (_event, ctx) => {
			await ignoreStaleContext(() =>
				handleSessionEvent(ctx, this.wiring.onSessionStart),
			);
		});
		this.pi.on("session_tree", async (_event, ctx) => {
			await ignoreStaleContext(() =>
				handleSessionEvent(ctx, this.wiring.onSessionStart),
			);
		});

		this.pi.on("agent_end", async (event, ctx) => {
			await ignoreStaleContext(async () => {
				const branchEntries = ctx.sessionManager.getBranch();
				const branchMessages = branchEntries
					.filter(isMessageBranchEntry)
					.map((entry) => entry.message);
				const sourceLeafId =
					ctx.sessionManager.getLeafId() ?? `turn-${Date.now()}`;
				const messages = getAgentEndMessages(event);
				const turn = buildTurnContext({
					turnId: sourceLeafId,
					sourceLeafId,
					messagesFromPrompt: messages,
					branchMessages,
					occurredAt: new Date().toISOString(),
				});
				if (turn) {
					await this.wiring.onAgentEnd(turn, ctx);
					return;
				}

				if (messages.length === 0) {
					await this.wiring.onAgentEnd(
						buildAbortedFallbackTurn(sourceLeafId, branchMessages),
						ctx,
					);
				}
			});
		});

		this.pi.on("input", async (event, ctx) => {
			if (isInputEvent(event)) {
				await ignoreStaleContext(() => this.wiring.onUserSubmit(event, ctx));
			}
			return { action: "continue" };
		});
	}
}
