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

const getFirstUserMessageText = (entries: SessionEntry[]): string | undefined => {
	const firstUserEntry = entries.find((entry) => entry.type === "message" && entry.message?.role === "user");
	if (!firstUserEntry) {
		return undefined;
	}

	const text = extractTextContent(firstUserEntry.message?.content).trim();
	return text || undefined;
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
	});
}
