import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	completeSimple,
	type Message,
	type Model,
	type UserMessage,
} from "@mariozechner/pi-ai";

type ExtensionAPI = {
	getSessionName(): string | undefined;
	setSessionName(name: string): void;
	on(
		eventName: "turn_end",
		handler: (
			event: { turnIndex: number },
			ctx: ExtensionContext,
		) => void | Promise<void>,
	): void;
};

type AuthResult =
	| { ok: true; apiKey?: string; headers?: Record<string, string> }
	| { ok: false; error: string };

type ModelRegistry = {
	getAll(): Model<string>[];
	getApiKeyAndHeaders?: (
		model: Model<string>,
	) => Promise<AuthResult> | AuthResult;
	getApiKey?: (
		model: Model<string>,
	) => Promise<string | undefined> | string | undefined;
	getHeaders?: (
		model: Model<string>,
	) =>
		| Promise<Record<string, string> | undefined>
		| Record<string, string>
		| undefined;
};

type ExtensionContext = {
	model: Model<string>;
	modelRegistry: ModelRegistry;
	sessionManager: {
		getBranch(): unknown[];
	};
};

type ShouldNameAfterTurnInput = {
	hasSessionName: boolean;
	turnIndex: number;
};

type AutoSessionNameSettings = {
	enabled: boolean;
	titleModel: string[];
};

type CompletionResponseLike = {
	content?: unknown;
};

const LEADING_SKILL_RE = /^\s*<skill\b[^>]*>[\s\S]*?<\/skill>\s*/i;
const DEFAULT_TITLE_MODEL = ["session-default"];
const MAX_TITLE_WORDS = 8;
const MAX_TITLE_LENGTH = 60;

export const extractUserRequest = (text: string): string => {
	return text.replace(LEADING_SKILL_RE, "").trim();
};

export const shouldNameAfterTurn = ({
	hasSessionName,
	turnIndex,
}: ShouldNameAfterTurnInput): boolean => {
	return !hasSessionName && turnIndex === 0;
};

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
	typeof value === "object" && value !== null;

const isTextPart = (part: unknown): part is { text: string } =>
	isRecord(part) && part.type === "text" && typeof part.text === "string";

const compactWhitespace = (text: string): string =>
	text.replace(/\s+/g, " ").trim();

const extractTextContent = (content: unknown): string => {
	if (typeof content === "string") {
		return content;
	}

	if (!Array.isArray(content)) {
		return "";
	}

	return content
		.filter(isTextPart)
		.map((part) => part.text)
		.join("\n");
};

const getFirstUserMessageText = (entries: unknown[]): string | undefined => {
	for (const entry of entries) {
		if (!isRecord(entry) || entry.type !== "message") continue;
		const message = entry.message;
		if (!isRecord(message) || message.role !== "user") continue;
		const text = compactWhitespace(extractTextContent(message.content));
		if (text) return text;
	}

	return undefined;
};

const trimTitleDecorations = (text: string): string => {
	let title = text.trim();
	let previous = "";
	while (title !== previous) {
		previous = title;
		title = title
			.trim()
			.replace(/^[`*_#>\-\s]+/, "")
			.replace(/[`*_#\-\s]+$/, "")
			.trim()
			.replace(/^["'“”‘’]+/, "")
			.replace(/["'“”‘’]+$/, "")
			.trim();
	}
	return title;
};

const capTitle = (text: string): string => {
	const words = compactWhitespace(text).split(" ").filter(Boolean);
	let title = words.slice(0, MAX_TITLE_WORDS).join(" ");
	while (title.length > MAX_TITLE_LENGTH && title.includes(" ")) {
		title = title.slice(0, title.lastIndexOf(" "));
	}
	return title.length > MAX_TITLE_LENGTH
		? title.slice(0, MAX_TITLE_LENGTH).trim()
		: title;
};

export const normalizeModelTitle = (text: string): string | undefined => {
	const title = capTitle(trimTitleDecorations(compactWhitespace(text)));
	return title || undefined;
};

export const makeFallbackTitle = (request: string): string | undefined => {
	const words = trimTitleDecorations(compactWhitespace(request))
		.split(" ")
		.filter(Boolean);
	let title = words.slice(0, MAX_TITLE_WORDS).join(" ");
	while (title.length > MAX_TITLE_LENGTH && title.includes(" ")) {
		title = title.slice(0, title.lastIndexOf(" "));
	}
	if (title.length > MAX_TITLE_LENGTH) {
		title = title.slice(0, MAX_TITLE_LENGTH).trim();
	}
	return title || undefined;
};

const isValidTitleModel = (value: unknown): value is string[] =>
	Array.isArray(value) &&
	value.length > 0 &&
	value.every((entry) => typeof entry === "string" && entry.trim().length > 0);

const readSettings = async (): Promise<AutoSessionNameSettings> => {
	try {
		const content = await readFile(
			join(homedir(), ".pi", "agent", "settings.json"),
			"utf8",
		);
		const parsed = JSON.parse(content);
		const autoSessionName = isRecord(parsed)
			? parsed.autoSessionName
			: undefined;
		const settings = isRecord(autoSessionName) ? autoSessionName : undefined;
		return {
			enabled: settings?.enabled !== false,
			titleModel: isValidTitleModel(settings?.titleModel)
				? settings.titleModel.map((entry) => entry.trim())
				: DEFAULT_TITLE_MODEL,
		};
	} catch {
		return {
			enabled: true,
			titleModel: DEFAULT_TITLE_MODEL,
		};
	}
};

const resolveModelRef = (
	modelRef: string,
	currentModel: Model<string>,
	allModels: Model<string>[],
): Model<string> | undefined => {
	if (modelRef === "session-default") {
		return currentModel;
	}

	if (modelRef.includes("/")) {
		const [provider, ...idParts] = modelRef.split("/");
		const id = idParts.join("/");
		return allModels.find(
			(model) => model.provider === provider && model.id === id,
		);
	}

	const candidates = allModels.filter((model) => model.id === modelRef);
	return candidates.length === 1 ? candidates[0] : undefined;
};

const resolveTitleModel = (
	modelRefs: string[],
	currentModel: Model<string>,
	allModels: Model<string>[],
): Model<string> => {
	for (const modelRef of modelRefs) {
		const model = resolveModelRef(modelRef, currentModel, allModels);
		if (model) return model;
	}
	throw new Error("No configured title models are available");
};

const resolveRequestAuth = async (
	model: Model<string>,
	modelRegistry: ModelRegistry,
): Promise<{ apiKey?: string; headers?: Record<string, string> }> => {
	if (typeof modelRegistry.getApiKeyAndHeaders === "function") {
		const auth = await modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) throw new Error(auth.error);
		return { apiKey: auth.apiKey, headers: auth.headers };
	}

	const [apiKey, headers] = await Promise.all([
		modelRegistry.getApiKey?.(model),
		modelRegistry.getHeaders?.(model),
	]);
	return { apiKey, headers };
};

const extractCompletionText = (response: CompletionResponseLike): string => {
	if (typeof response.content === "string") return response.content;
	return extractTextContent(response.content);
};

const createTitlePrompt = (
	request: string,
): { systemPrompt: string; messages: Message[] } => {
	const userMessage: UserMessage = {
		role: "user",
		content: [{ type: "text", text: request }],
		timestamp: Date.now(),
	};
	return {
		systemPrompt:
			"Create a concise Pi session title from the user's first message. Return only plain text, 3-8 words, no quotes, no markdown, maximum 60 characters.",
		messages: [userMessage],
	};
};

const generateTitle = async (
	request: string,
	ctx: ExtensionContext,
	settings: AutoSessionNameSettings,
): Promise<string | undefined> => {
	const model = resolveTitleModel(
		settings.titleModel,
		ctx.model,
		ctx.modelRegistry.getAll(),
	);
	const auth = await resolveRequestAuth(model, ctx.modelRegistry);
	const response = await completeSimple(
		model,
		createTitlePrompt(request),
		auth,
	);
	return normalizeModelTitle(extractCompletionText(response));
};

const nameSessionFromFirstTurn = async (
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	firstUserText: string,
): Promise<void> => {
	const request = compactWhitespace(extractUserRequest(firstUserText));
	if (!request) return;

	const settings = await readSettings();
	if (!settings.enabled) return;

	let title: string | undefined;
	try {
		title = await generateTitle(request, ctx, settings);
	} catch {
		title = undefined;
	}

	const finalTitle = title ?? makeFallbackTitle(request);
	if (!finalTitle || pi.getSessionName()?.trim()) return;
	pi.setSessionName(finalTitle);
};

export default function (pi: ExtensionAPI) {
	pi.on("turn_end", (event, ctx) => {
		if (
			!shouldNameAfterTurn({
				hasSessionName: Boolean(pi.getSessionName()?.trim()),
				turnIndex: event.turnIndex,
			})
		) {
			return;
		}

		const firstUserText = getFirstUserMessageText(
			ctx.sessionManager.getBranch(),
		);
		if (!firstUserText) return;

		void nameSessionFromFirstTurn(pi, ctx, firstUserText).catch(
			() => undefined,
		);
	});
}
