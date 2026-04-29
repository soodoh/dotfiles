function textFromContent(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    return content
        .map((block) => {
        if (block && typeof block === "object") {
            if ("type" in block && block.type === "text" && "text" in block) {
                return String(block.text ?? "");
            }
        }
        return "";
    })
        .join("\n")
        .trim();
}
function extractToolSignals(messages) {
    const toolSignals = [];
    const touchedFiles = new Set();
    for (const message of messages) {
        if (message.role === "assistant" && Array.isArray(message.content)) {
            for (const block of message.content) {
                if (block.type === "toolCall") {
                    const args = block.arguments;
                    const pathValue = typeof args.path === "string" ? args.path : undefined;
                    const fileValue = typeof args.file === "string" ? args.file : undefined;
                    const patternValue = typeof args.pattern === "string" ? args.pattern : undefined;
                    const commandValue = typeof args.command === "string" ? args.command : undefined;
                    const target = pathValue ?? fileValue ?? patternValue ?? commandValue;
                    toolSignals.push(`${block.name}${target ? `(${target})` : ""}`);
                    if (pathValue)
                        touchedFiles.add(pathValue.replace(/^@/, ""));
                    if (fileValue)
                        touchedFiles.add(fileValue.replace(/^@/, ""));
                }
            }
        }
        if (message.role === "toolResult" && message.isError) {
            toolSignals.push(`${message.toolName}:error`);
        }
    }
    return { toolSignals, touchedFiles: Array.from(touchedFiles) };
}
function extractUnresolvedQuestions(text) {
    return text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.endsWith("?"));
}
function extractUsage(message) {
    const usage = message.usage;
    if (!usage)
        return undefined;
    return {
        inputTokens: Number(usage.input ?? 0),
        outputTokens: Number(usage.output ?? 0),
        cacheReadTokens: Number(usage.cacheRead ?? 0),
        cacheWriteTokens: Number(usage.cacheWrite ?? 0),
        totalTokens: Number(usage.totalTokens ?? 0),
        costTotal: Number(usage.cost?.total ?? 0),
    };
}
function extractRecentUserPrompts(messages) {
    return [...messages]
        .reverse()
        .filter((message) => message.role === "user")
        .map((message) => textFromContent(message.content))
        .filter(Boolean);
}
function buildPlaceholderTurnContext(params) {
    const lastMessage = params.messagesFromPrompt.at(-1);
    if (!lastMessage)
        return null;
    const recentUserPrompts = extractRecentUserPrompts(params.branchMessages);
    const { toolSignals, touchedFiles } = extractToolSignals(params.messagesFromPrompt);
    if (lastMessage.role === "toolResult") {
        const status = lastMessage.isError ? "error" : "success";
        const assistantText = lastMessage.isError ? "[error/toolcall]" : "[toolcall]";
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
    if (lastMessage.role === "assistant")
        return null;
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
export function buildTurnContext(params) {
    const latestMessage = params.messagesFromPrompt.at(-1);
    if (!latestMessage)
        return null;
    if (latestMessage.role !== "assistant") {
        return buildPlaceholderTurnContext(params);
    }
    const assistantText = textFromContent(latestMessage.content);
    const status = latestMessage.stopReason === "error"
        ? "error"
        : latestMessage.stopReason === "aborted"
            ? "aborted"
            : "success";
    const recentUserPrompts = extractRecentUserPrompts(params.branchMessages);
    const { toolSignals, touchedFiles } = extractToolSignals(params.messagesFromPrompt);
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
        abortContextNote: status === "aborted"
            ? "The previous agent turn ended with stopReason=aborted. The user likely interrupted execution and wants a better next instruction."
            : undefined,
    };
}
export function extractUserText(message) {
    return textFromContent(message.content ?? "");
}
export function buildLatestHistoricalTurnContext(params) {
    let lastRelevantIndex = -1;
    for (let i = params.branchEntries.length - 1; i >= 0; i -= 1) {
        if (params.branchEntries[i]?.message.role !== "user") {
            lastRelevantIndex = i;
            break;
        }
    }
    if (lastRelevantIndex === -1)
        return null;
    const latestEntry = params.branchEntries[lastRelevantIndex];
    const branchMessages = params.branchEntries.map((entry) => entry.message);
    let startIndex = 0;
    for (let i = lastRelevantIndex - 1; i >= 0; i -= 1) {
        if (params.branchEntries[i]?.message.role === "user") {
            startIndex = i + 1;
            break;
        }
    }
    const occurredAt = typeof latestEntry.message.timestamp === "number"
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
