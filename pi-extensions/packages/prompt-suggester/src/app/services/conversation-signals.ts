import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
	SuggestionUsage,
	TurnContext,
	TurnStatus,
} from "../../domain/suggestion";
import { normalizeFiniteNonNegativeNumber } from "../../domain/usage";

interface BranchMessageEntry {
	id: string;
	message: AgentMessage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextContentBlock(
	value: unknown,
): value is { type: "text"; text?: unknown } {
	return isRecord(value) && value.type === "text";
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => (isTextContentBlock(block) ? String(block.text ?? "") : ""))
		.join("\n")
		.trim();
}

function isAgentMessage(value: unknown): value is AgentMessage {
	if (!isRecord(value)) return false;
	return (
		value.role === "user" ||
		value.role === "assistant" ||
		value.role === "toolResult"
	);
}

function extractToolSignals(messages: AgentMessage[]): {
	toolSignals: string[];
	touchedFiles: string[];
} {
	const toolSignals: string[] = [];
	const touchedFiles = new Set<string>();

	for (const message of messages) {
		if (message.role === "assistant" && Array.isArray(message.content)) {
			for (const block of message.content) {
				if (block.type === "toolCall") {
					const args = isRecord(block.arguments) ? block.arguments : undefined;
					const pathValue =
						typeof args?.path === "string" ? args.path : undefined;
					const fileValue =
						typeof args?.file === "string" ? args.file : undefined;
					const patternValue =
						typeof args?.pattern === "string" ? args.pattern : undefined;
					const commandValue =
						typeof args?.command === "string" ? args.command : undefined;
					const target = pathValue ?? fileValue ?? patternValue ?? commandValue;
					toolSignals.push(`${block.name}${target ? `(${target})` : ""}`);
					if (pathValue) touchedFiles.add(pathValue.replace(/^@/, ""));
					if (fileValue) touchedFiles.add(fileValue.replace(/^@/, ""));
				}
			}
		}
		if (message.role === "toolResult" && message.isError) {
			toolSignals.push(`${message.toolName}:error`);
		}
	}

	return { toolSignals, touchedFiles: Array.from(touchedFiles) };
}

function extractUnresolvedQuestions(text: string): string[] {
	return text
		.split(/\n+/)
		.map((line) => line.trim())
		.filter((line) => line.endsWith("?"));
}

function usageNumber(
	usage: Record<string, unknown>,
	key: string,
): number | undefined {
	const value = usage[key];
	return typeof value === "number" ? value : undefined;
}

function extractUsage(message: AgentMessage): SuggestionUsage | undefined {
	if (!isRecord(message) || !isRecord(message.usage)) return undefined;
	const cost = isRecord(message.usage.cost) ? message.usage.cost : undefined;
	return {
		inputTokens: normalizeFiniteNonNegativeNumber(
			usageNumber(message.usage, "input"),
		),
		outputTokens: normalizeFiniteNonNegativeNumber(
			usageNumber(message.usage, "output"),
		),
		cacheReadTokens: normalizeFiniteNonNegativeNumber(
			usageNumber(message.usage, "cacheRead"),
		),
		cacheWriteTokens: normalizeFiniteNonNegativeNumber(
			usageNumber(message.usage, "cacheWrite"),
		),
		totalTokens: normalizeFiniteNonNegativeNumber(
			usageNumber(message.usage, "totalTokens"),
		),
		costTotal: normalizeFiniteNonNegativeNumber(
			cost ? usageNumber(cost, "total") : undefined,
		),
	};
}

function extractRecentUserPrompts(messages: AgentMessage[]): string[] {
	return [...messages]
		.reverse()
		.filter((message) => message.role === "user")
		.map((message) => textFromContent(message.content))
		.filter(Boolean);
}

function buildPlaceholderTurnContext(params: {
	turnId: string;
	sourceLeafId: string;
	messagesFromPrompt: AgentMessage[];
	branchMessages: AgentMessage[];
	occurredAt: string;
}): TurnContext | null {
	const lastMessage = params.messagesFromPrompt.at(-1);
	if (!lastMessage) return null;

	const recentUserPrompts = extractRecentUserPrompts(params.branchMessages);
	const { toolSignals, touchedFiles } = extractToolSignals(
		params.messagesFromPrompt,
	);

	if (lastMessage.role === "toolResult") {
		const status: TurnStatus = lastMessage.isError ? "error" : "success";
		const assistantText = lastMessage.isError
			? "[error/toolcall]"
			: "[toolcall]";
		return {
			turnId: params.turnId,
			sourceLeafId: params.sourceLeafId,
			assistantText,
			assistantUsage: undefined,
			status,
			occurredAt: params.occurredAt,
			recentUserPrompts,
			toolSignals,
			touchedFiles,
			unresolvedQuestions: [],
			abortContextNote: undefined,
		};
	}

	if (lastMessage.role === "assistant") return null;

	return {
		turnId: params.turnId,
		sourceLeafId: params.sourceLeafId,
		assistantText: "[empty]",
		assistantUsage: undefined,
		status: "success",
		occurredAt: params.occurredAt,
		recentUserPrompts,
		toolSignals,
		touchedFiles,
		unresolvedQuestions: [],
		abortContextNote: undefined,
	};
}

export function buildTurnContext(params: {
	turnId: string;
	sourceLeafId: string;
	messagesFromPrompt: unknown[];
	branchMessages: unknown[];
	occurredAt: string;
}): TurnContext | null {
	const messagesFromPrompt = params.messagesFromPrompt.filter(isAgentMessage);
	const branchMessages = params.branchMessages.filter(isAgentMessage);
	const latestMessage = messagesFromPrompt.at(-1);
	if (!latestMessage) return null;
	if (latestMessage.role !== "assistant") {
		return buildPlaceholderTurnContext({
			...params,
			messagesFromPrompt,
			branchMessages,
		});
	}

	const assistantText = textFromContent(latestMessage.content);
	const status: TurnStatus =
		latestMessage.stopReason === "error"
			? "error"
			: latestMessage.stopReason === "aborted"
				? "aborted"
				: "success";
	const recentUserPrompts = extractRecentUserPrompts(branchMessages);
	const { toolSignals, touchedFiles } = extractToolSignals(messagesFromPrompt);
	return {
		turnId: params.turnId,
		sourceLeafId: params.sourceLeafId,
		assistantText,
		assistantUsage: extractUsage(latestMessage),
		status,
		occurredAt: params.occurredAt,
		recentUserPrompts,
		toolSignals,
		touchedFiles,
		unresolvedQuestions: extractUnresolvedQuestions(assistantText),
		abortContextNote:
			status === "aborted"
				? "The previous agent turn ended with stopReason=aborted. The user likely interrupted execution and wants a better next instruction."
				: undefined,
	};
}

export function buildLatestHistoricalTurnContext(params: {
	branchEntries: BranchMessageEntry[];
}): TurnContext | null {
	if (params.branchEntries.at(-1)?.message.role === "user") return null;

	let lastRelevantIndex = -1;
	for (let i = params.branchEntries.length - 1; i >= 0; i -= 1) {
		if (params.branchEntries[i]?.message.role !== "user") {
			lastRelevantIndex = i;
			break;
		}
	}
	if (lastRelevantIndex === -1) return null;

	const latestEntry = params.branchEntries[lastRelevantIndex];
	const branchMessages = params.branchEntries.map((entry) => entry.message);
	let startIndex = 0;
	for (let i = lastRelevantIndex - 1; i >= 0; i -= 1) {
		if (params.branchEntries[i]?.message.role === "user") {
			startIndex = i + 1;
			break;
		}
	}

	const occurredAt =
		typeof latestEntry.message.timestamp === "number"
			? new Date(latestEntry.message.timestamp).toISOString()
			: new Date().toISOString();

	return buildTurnContext({
		turnId: latestEntry.id,
		sourceLeafId: latestEntry.id,
		messagesFromPrompt: branchMessages.slice(startIndex, lastRelevantIndex + 1),
		branchMessages,
		occurredAt,
	});
}
