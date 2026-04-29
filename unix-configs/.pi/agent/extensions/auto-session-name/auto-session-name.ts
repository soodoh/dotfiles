import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

type ExtensionAPI = {
	getSessionName(): string | undefined;
	setSessionName(name: string): void;
	on(eventName: "turn_end", handler: (event: { turnIndex: number }, ctx: ExtensionContext) => void | Promise<void>): void;
	on(eventName: "session_start", handler: (event: unknown, ctx: ExtensionContext) => void | Promise<void>): void;
};

type ExtensionContext = {
	sessionManager: {
		getBranch(): unknown[];
	};
};

type SessionEntry = {
	type: string;
	message?: {
		role?: string;
		content?: unknown;
	};
};

type ShouldNameAfterTurnInput = {
	hasSessionName: boolean;
	skillName?: string;
	turnIndex: number;
};

const LEADING_SKILL_RE = /^\s*<skill\b([^>]*)>[\s\S]*?<\/skill>\s*/i;
const SKILL_NAME_RE = /\bname=(?:"([^"]+)"|'([^']+)')/i;
const DEFAULT_MAX_TITLE_LENGTH = 72;
const SESSION_INFO_TYPE = "session_info";

let didBackfillExistingSessions = false;

export const extractSkillName = (text: string): string | undefined => {
	const skillMatch = text.match(/^\s*<skill\b([^>]*)>/i);
	if (!skillMatch) {
		return undefined;
	}

	const nameMatch = skillMatch[1]?.match(SKILL_NAME_RE);
	return nameMatch?.[1] ?? nameMatch?.[2];
};

export const extractUserRequest = (text: string): string => {
	return text.replace(LEADING_SKILL_RE, "").trim();
};

const compactWhitespace = (text: string): string => text.replace(/\s+/g, " ").trim();

export const makeSessionTitle = (
	skillName: string,
	request: string,
	maxLength = DEFAULT_MAX_TITLE_LENGTH,
): string => {
	const cleanRequest = compactWhitespace(request);
	if (!cleanRequest) {
		return `${skillName} skill session`;
	}

	const prefix = `${skillName}: `;
	const fullTitle = `${prefix}${cleanRequest}`;
	if (fullTitle.length <= maxLength) {
		return fullTitle;
	}

	const requestLength = Math.max(1, maxLength - prefix.length - 1);
	return `${prefix}${cleanRequest.slice(0, requestLength).trimEnd()}…`;
};

export const shouldNameAfterTurn = ({
	hasSessionName,
	skillName,
	turnIndex,
}: ShouldNameAfterTurnInput): boolean => {
	return !hasSessionName && Boolean(skillName) && turnIndex === 0;
};

const extractTextContent = (content: unknown): string => {
	if (typeof content === "string") {
		return content;
	}

	if (!Array.isArray(content)) {
		return "";
	}

	return content
		.filter((part): part is { type: string; text: string } => {
			return Boolean(part) && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string";
		})
		.map((part) => part.text)
		.join("\n");
};

const getLatestSessionName = (entries: unknown[]): string | undefined => {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (!entry || typeof entry !== "object") {
			continue;
		}

		const maybeInfo = entry as { type?: unknown; name?: unknown };
		if (maybeInfo.type === SESSION_INFO_TYPE) {
			return typeof maybeInfo.name === "string" ? maybeInfo.name.trim() || undefined : undefined;
		}
	}

	return undefined;
};

const getEntryId = (entry: unknown): string | null => {
	if (!entry || typeof entry !== "object") {
		return null;
	}

	const id = (entry as { id?: unknown }).id;
	return typeof id === "string" ? id : null;
};

const makeEntryId = (entries: unknown[]): string => {
	const existingIds = new Set(entries.map(getEntryId).filter((id): id is string => Boolean(id)));
	let id = "";
	do {
		id = Math.floor(Math.random() * 0xffffffff)
			.toString(16)
			.padStart(8, "0")
			.slice(0, 8);
	} while (existingIds.has(id));

	return id;
};

const parseJsonlEntries = (content: string): unknown[] => {
	return content
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => JSON.parse(line) as unknown);
};

const getFirstUserMessageText = (entries: SessionEntry[]): string | undefined => {
	const firstUserEntry = entries.find((entry) => entry.type === "message" && entry.message?.role === "user");
	if (!firstUserEntry) {
		return undefined;
	}

	const text = extractTextContent(firstUserEntry.message?.content).trim();
	return text || undefined;
};

export const backfillSkillSessionNameInFile = async (sessionPath: string): Promise<boolean> => {
	const content = await readFile(sessionPath, "utf8");
	const entries = parseJsonlEntries(content);
	if (getLatestSessionName(entries)) {
		return false;
	}

	const firstUserText = getFirstUserMessageText(entries as SessionEntry[]);
	if (!firstUserText) {
		return false;
	}

	const skillName = extractSkillName(firstUserText);
	if (!skillName) {
		return false;
	}

	const lastEntry = entries.at(-1);
	const sessionInfo = {
		type: SESSION_INFO_TYPE,
		id: makeEntryId(entries),
		parentId: getEntryId(lastEntry),
		timestamp: new Date().toISOString(),
		name: makeSessionTitle(skillName, extractUserRequest(firstUserText)),
	};

	const suffix = content.endsWith("\n") ? "" : "\n";
	await writeFile(sessionPath, `${content}${suffix}${JSON.stringify(sessionInfo)}\n`);
	return true;
};

const findSessionFiles = async (directory: string): Promise<string[]> => {
	let entries;
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch {
		return [];
	}

	const files = await Promise.all(
		entries.map(async (entry) => {
			const fullPath = join(directory, entry.name);
			if (entry.isDirectory()) {
				return findSessionFiles(fullPath);
			}
			return entry.isFile() && entry.name.endsWith(".jsonl") ? [fullPath] : [];
		}),
	);

	return files.flat();
};

export const backfillSkillSessionNames = async (sessionsDir = join(homedir(), ".pi", "agent", "sessions")): Promise<number> => {
	const sessionFiles = await findSessionFiles(sessionsDir);
	let changedCount = 0;

	for (const sessionFile of sessionFiles) {
		try {
			if ((await stat(sessionFile)).isFile() && (await backfillSkillSessionNameInFile(sessionFile))) {
				changedCount++;
			}
		} catch {
			// Ignore malformed or concurrently modified session files.
		}
	}

	return changedCount;
};

const maybeNameSkillSession = (pi: ExtensionAPI, entries: SessionEntry[]): boolean => {
	if (pi.getSessionName()) {
		return false;
	}

	const firstUserText = getFirstUserMessageText(entries);
	if (!firstUserText) {
		return false;
	}

	const skillName = extractSkillName(firstUserText);
	if (!skillName) {
		return false;
	}

	pi.setSessionName(makeSessionTitle(skillName, extractUserRequest(firstUserText)));
	return true;
};

export default function (pi: ExtensionAPI) {
	pi.on("turn_end", async (event, ctx) => {
		const firstUserText = getFirstUserMessageText(ctx.sessionManager.getBranch() as SessionEntry[]);
		const skillName = firstUserText ? extractSkillName(firstUserText) : undefined;

		if (!shouldNameAfterTurn({ hasSessionName: Boolean(pi.getSessionName()), skillName, turnIndex: event.turnIndex })) {
			return;
		}

		pi.setSessionName(makeSessionTitle(skillName!, extractUserRequest(firstUserText!)));
	});

	pi.on("session_start", async (_event, ctx) => {
		maybeNameSkillSession(pi, ctx.sessionManager.getBranch() as SessionEntry[]);

		if (!didBackfillExistingSessions) {
			didBackfillExistingSessions = true;
			await backfillSkillSessionNames();
		}
	});
}
