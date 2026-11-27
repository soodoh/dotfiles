import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	clampThinkingLevel,
	type Message,
	type Model,
	type UserMessage,
} from "@earendil-works/pi-ai";
import {
	type AgentSettledEvent,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
	type InputEvent,
	type SessionEntry,
	type SessionInfoChangedEvent,
	SessionManager,
	type SessionShutdownEvent,
	type SessionStartEvent,
	type SessionTreeEvent,
	type TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import {
	type AuthoritativeTitleInfo,
	type AutoTitleState,
	createTitleOwnershipState,
} from "./title-ownership";

type AutoSessionNameContext = Pick<ExtensionContext, "model" | "signal"> & {
	modelRegistry: Pick<ExtensionContext["modelRegistry"], "getAll"> & {
		streamSimple(
			...args: Parameters<ExtensionContext["modelRegistry"]["streamSimple"]>
		): Pick<
			ReturnType<ExtensionContext["modelRegistry"]["streamSimple"]>,
			"result"
		>;
	};
	sessionManager: Pick<
		ExtensionContext["sessionManager"],
		"getBranch" | "getEntries" | "getSessionFile"
	>;
};

type EventHandler<Event> = (
	event: Event,
	ctx: AutoSessionNameContext,
) => void | Promise<void>;

type AutoSessionNameAPI = Pick<
	ExtensionAPI,
	"appendEntry" | "getSessionName" | "setSessionName"
> & {
	on(event: "input", handler: EventHandler<InputEvent>): void;
	on(event: "agent_settled", handler: EventHandler<AgentSettledEvent>): void;
	on(event: "turn_end", handler: EventHandler<TurnEndEvent>): void;
	on(event: "session_start", handler: EventHandler<SessionStartEvent>): void;
	on(
		event: "session_info_changed",
		handler: EventHandler<SessionInfoChangedEvent>,
	): void;
	on(
		event: "session_shutdown",
		handler: EventHandler<SessionShutdownEvent>,
	): void;
	on(event: "session_tree", handler: EventHandler<SessionTreeEvent>): void;
};

type AutoSessionNameSettings = {
	enabled: boolean;
	titleModel: string[];
};

type RefinementEligibilityInput = {
	state: AutoTitleState;
	userRequests: string[];
};

type Prompt = {
	systemPrompt: string;
	messages: Message[];
};

const LEADING_SKILL_RE = /^\s*<skill\b[^>]*>[\s\S]*?<\/skill>\s*/i;
const COMMAND_RE = /^\/[A-Za-z0-9:_-]+(?:\s+([\s\S]*))?$/;
const DIRECTION_CHANGE_RE =
	/^\s*(?:actually\b|instead\b|switch\s+to\b|new\s+task\b|let(?:'|’)s\s+focus\s+on\b|now\s+work\s+on\b)/i;
const GENERIC_REQUEST_RE =
	/^(?:help(?:\s+me)?(?:\s+with\s+this)?|can\s+you\s+(?:take\s+a\s+look|help)|take\s+a\s+look|continue|fix\s+this|look\s+at\s+this|what\s+do\s+you\s+think)$/i;
const GENERIC_TITLE_RE =
	/^(?:help(?:\s+me)?(?:\s+with\s+this)?|take\s+a\s+look|continue|fix\s+this|new\s+session|session|untitled)$/i;
const DEFAULT_TITLE_MODEL = ["session-default"];
const STATE_ENTRY_TYPE = "auto-session-name-state";
const MAX_TITLE_INPUT_CHARS = 1_600;
const MAX_RECENT_REQUEST_CHARS = 400;
const MAX_RECENT_RAW_REQUESTS = 4;
const MAX_STABLE_ANCHORS = 8;
const MAX_TITLE_OUTPUT_TOKENS = 128;
const TITLE_TEMPERATURE = 0;
const TITLE_TIMEOUT_MS = 8_000;
const TITLE_PROVIDER_RETRIES = 0;
const MAX_TITLE_WORDS = 8;
const MAX_TITLE_LENGTH = 60;

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
	typeof value === "object" && value !== null;

const isTextPart = (part: unknown): part is { text: string } =>
	isRecord(part) && part.type === "text" && typeof part.text === "string";

const compactWhitespace = (text: string): string =>
	text.replace(/\s+/g, " ").trim();

const normalizeForComparison = (text: string): string =>
	compactWhitespace(text)
		.toLowerCase()
		.replace(/[^a-z0-9#./_-]+/g, " ")
		.trim();

const extractTextContent = (content: unknown): string => {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	return content
		.filter(isTextPart)
		.map((part) => part.text)
		.join("\n");
};

const extractUserRequest = (text: string): string =>
	text.replace(LEADING_SKILL_RE, "").trim();

const cleanRawUserInput = (text: string): string | undefined => {
	const input = compactWhitespace(text);
	if (!input) return undefined;

	const command = input.match(COMMAND_RE);
	if (!command) return input;

	const argumentsText = command[1] ? compactWhitespace(command[1]) : "";
	return argumentsText || undefined;
};

const truncateHeadAndTail = (
	text: string,
	maxCharacters = MAX_TITLE_INPUT_CHARS,
): string => {
	if (text.length <= maxCharacters) return text;
	if (maxCharacters <= 0) return "";

	const separator = "\n...\n";
	if (maxCharacters <= separator.length) return text.slice(0, maxCharacters);

	const remaining = maxCharacters - separator.length;
	const headLength = Math.ceil(remaining / 2);
	const tailLength = Math.floor(remaining / 2);
	return `${text.slice(0, headLength)}${separator}${text.slice(-tailLength)}`;
};

const isMeaningfulUserRequest = (text: string): boolean => {
	const request = compactWhitespace(text);
	return Boolean(
		request && /[\p{L}\p{N}]/u.test(request) && !COMMAND_RE.test(request),
	);
};

const extractUserRequests = (entries: SessionEntry[]): string[] => {
	const requests: string[] = [];
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		const request = compactWhitespace(
			extractUserRequest(extractTextContent(entry.message.content)),
		);
		if (isMeaningfulUserRequest(request)) requests.push(request);
	}
	return requests;
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

const normalizeModelTitle = (text: string): string | undefined => {
	const title = capTitle(trimTitleDecorations(compactWhitespace(text)));
	return title || undefined;
};

const makeFallbackTitle = (request: string): string | undefined =>
	normalizeModelTitle(request);

const meaningfulTerms = (text: string): string[] => {
	const ignored = new Set([
		"a",
		"an",
		"and",
		"can",
		"could",
		"for",
		"help",
		"me",
		"please",
		"the",
		"this",
		"to",
		"with",
		"you",
	]);
	return normalizeForComparison(text)
		.split(/[^a-z0-9_-]+/)
		.filter((term) => term.length > 1 && !ignored.has(term));
};

const isWeakRequest = (request: string): boolean => {
	const normalized = normalizeForComparison(request);
	if (!normalized || GENERIC_REQUEST_RE.test(normalized)) return true;
	return request.length <= 32 && meaningfulTerms(request).length <= 1;
};

const isWeakTitle = (title: string): boolean => {
	const normalized = normalizeForComparison(title);
	return !normalized || GENERIC_TITLE_RE.test(normalized);
};

const hasDirectionChange = (request: string): boolean =>
	DIRECTION_CHANGE_RE.test(request);

const addAnchor = (anchors: string[], candidate: string): void => {
	const anchor = candidate.trim().replace(/[.,;:!?]+$/, "");
	if (!anchor || anchor.length > 100) return;
	if (
		anchors.some((existing) => existing.toLowerCase() === anchor.toLowerCase())
	)
		return;
	anchors.push(anchor);
};

const extractStableAnchors = (requests: string[]): string[] => {
	const anchors: string[] = [];
	const patterns = [
		/\b[A-Z][A-Z0-9]+-\d+\b/g,
		/\b(?:PR|pull\s+request|issue)\s*#?\d+\b/gi,
		/(?:^|\s)#\d+\b/g,
		/https?:\/\/[^\s)]+\/(?:pull|issues)\/\d+\b/gi,
		/(?:^|\s)((?:\.{0,2}\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+)/g,
		/\b[A-Za-z0-9_.-]+\.(?:c|cpp|css|go|html|java|js|json|jsx|lua|md|py|rb|rs|sh|ts|tsx|yaml|yml)\b/g,
		/\b(?:ERR_[A-Z0-9_]+|E[A-Z][A-Z0-9_]{2,})\b/g,
	];

	for (const request of requests) {
		for (const match of request.matchAll(/`([^`\n]{2,100})`/g)) {
			if (match[1]) addAnchor(anchors, match[1]);
		}
		for (const pattern of patterns) {
			for (const match of request.matchAll(pattern)) {
				addAnchor(anchors, match[1] ?? match[0]);
			}
		}
		if (anchors.length >= MAX_STABLE_ANCHORS) break;
	}

	return anchors.slice(0, MAX_STABLE_ANCHORS);
};

const shouldRefineTitle = ({
	state,
	userRequests,
}: RefinementEligibilityInput): boolean => {
	if (state.phase !== "initial" || state.refinementAttempted) return false;

	const requests = userRequests.filter(isMeaningfulUserRequest);
	const laterRequests = requests.slice(1);
	if (laterRequests.some(hasDirectionChange)) return true;

	const weakInitial =
		state.initialFallback ||
		isWeakRequest(state.originalRequest) ||
		isWeakTitle(state.title);
	return weakInitial && requests.length >= 3;
};

const isAutoTitleState = (value: unknown): value is AutoTitleState =>
	isRecord(value) &&
	typeof value.title === "string" &&
	typeof value.originalRequest === "string" &&
	(value.phase === "initial" || value.phase === "refinement") &&
	typeof value.refinementAttempted === "boolean" &&
	typeof value.initialFallback === "boolean" &&
	(value.ownershipReleased === undefined ||
		typeof value.ownershipReleased === "boolean");

const reconstructAutoTitleState = (
	entries: SessionEntry[],
): AutoTitleState | undefined => {
	let state: AutoTitleState | undefined;
	for (const entry of entries) {
		if (
			entry.type === "custom" &&
			entry.customType === STATE_ENTRY_TYPE &&
			isAutoTitleState(entry.data)
		) {
			state = { ...entry.data };
		} else if (
			entry.type === "session_info" &&
			state &&
			entry.name !== state.title
		) {
			// Also recover explicit choices recorded before ownership markers existed
			// or made by another process while this runtime was not observing events.
			state.ownershipReleased = true;
		}
	}
	return state;
};

const createUserMessage = (text: string): UserMessage => ({
	role: "user",
	content: [{ type: "text", text }],
	timestamp: Date.now(),
});

const createInitialTitlePrompt = (request: string): Prompt => ({
	systemPrompt:
		"Create a concise Pi session title from the user's request. Return only plain text, 3-8 words, no quotes, no markdown, maximum 60 characters.",
	messages: [createUserMessage(request)],
});

const createRefinementTitlePrompt = ({
	currentTitle,
	originalRequest,
	recentRequests,
	anchors,
}: {
	currentTitle: string;
	originalRequest: string;
	recentRequests: string[];
	anchors: string[];
}): Prompt => {
	const envelope = [
		`Current automatic title: ${currentTitle}`,
		`Original request: ${originalRequest}`,
		...recentRequests.map(
			(request, index) => `Recent request ${index + 1}: ${request}`,
		),
		anchors.length > 0 ? `Stable anchors: ${anchors.join(", ")}` : undefined,
	]
		.filter((line) => line !== undefined)
		.join("\n");

	return {
		systemPrompt:
			"Refine a Pi session navigation title. Keep the current title unless the dominant task materially changed or became substantially clearer. Preserve useful ticket, PR, file, or component identifiers. Return only the title, 3-8 words, no quotes, no markdown, maximum 60 characters.",
		messages: [createUserMessage(envelope)],
	};
};

const isValidTitleModel = (value: unknown): value is string[] =>
	Array.isArray(value) &&
	value.length > 0 &&
	value.every((entry) => typeof entry === "string" && entry.trim().length > 0);

const readSettings = async (): Promise<AutoSessionNameSettings> => {
	try {
		const content = await readFile(
			join(getAgentDir(), "settings.json"),
			"utf8",
		);
		const parsed: unknown = JSON.parse(content);
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
		return { enabled: true, titleModel: DEFAULT_TITLE_MODEL };
	}
};

const resolveModelRef = (
	modelRef: string,
	currentModel: Model<string> | undefined,
	allModels: Model<string>[],
): Model<string> | undefined => {
	if (modelRef === "session-default") return currentModel;

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
	currentModel: Model<string> | undefined,
	allModels: Model<string>[],
): Model<string> => {
	for (const modelRef of modelRefs) {
		const model = resolveModelRef(modelRef, currentModel, allModels);
		if (model) return model;
	}
	throw new Error("No configured title models are available");
};

const extractCompletionText = (content: unknown): string =>
	typeof content === "string" ? content : extractTextContent(content);

const awaitWithAbort = async <Value>(
	promise: Promise<Value>,
	signal: AbortSignal,
): Promise<Value> => {
	if (signal.aborted) throw new DOMException("Aborted", "AbortError");

	return new Promise((resolve, reject) => {
		const abort = () => reject(new DOMException("Aborted", "AbortError"));
		signal.addEventListener("abort", abort, { once: true });
		promise.then(resolve, reject).finally(() => {
			signal.removeEventListener("abort", abort);
		});
	});
};

const generateTitle = async (
	prompt: Prompt,
	ctx: AutoSessionNameContext,
	settings: AutoSessionNameSettings,
	signal: AbortSignal,
): Promise<string | undefined> => {
	const model = resolveTitleModel(
		settings.titleModel,
		ctx.model,
		ctx.modelRegistry.getAll(),
	);
	const reasoningLevel = clampThinkingLevel(model, "off");
	// Pi's configured runtime owns provider dispatch, auth (including endpoint
	// overrides), virtual routing and cancellation. No compatibility/global API.
	const response = await awaitWithAbort(
		ctx.modelRegistry
			.streamSimple(model, prompt, {
				maxTokens: MAX_TITLE_OUTPUT_TOKENS,
				temperature: TITLE_TEMPERATURE,
				timeoutMs: TITLE_TIMEOUT_MS,
				maxRetries: TITLE_PROVIDER_RETRIES,
				...(reasoningLevel === "off" ? {} : { reasoning: reasoningLevel }),
				signal,
			})
			.result(),
		signal,
	);
	if (
		response.stopReason === "error" ||
		response.stopReason === "aborted" ||
		response.stopReason === "length"
	) {
		throw new Error(response.errorMessage ?? "Title generation failed");
	}
	return normalizeModelTitle(extractCompletionText(response.content));
};

const sessionName = (pi: AutoSessionNameAPI): string | undefined =>
	pi.getSessionName()?.trim() || undefined;

// Names are session-wide, unlike title-generation state on the active branch.
const ownershipReleased = (entries: SessionEntry[]): boolean => {
	let automaticTitle: string | undefined;
	for (const [index, entry] of entries.entries()) {
		if (
			entry.type === "custom" &&
			entry.customType === STATE_ENTRY_TYPE &&
			isAutoTitleState(entry.data)
		) {
			if (entry.data.ownershipReleased) return true;
			automaticTitle = entry.data.title;
		} else if (
			entry.type === "session_info" &&
			automaticTitle &&
			entry.name !== automaticTitle
		) {
			const next = entries[index + 1];
			// An automatic rename is immediately paired with its persisted title state.
			if (
				!(
					next?.type === "custom" &&
					next.customType === STATE_ENTRY_TYPE &&
					isAutoTitleState(next.data) &&
					next.data.title === entry.name &&
					!next.data.ownershipReleased
				)
			)
				return true;
		}
	}
	return false;
};

const authoritativeTitleInfo = (
	pi: AutoSessionNameAPI,
	ctx: AutoSessionNameContext,
): { name: string | undefined; released: boolean } => {
	const memoryEntries = ctx.sessionManager.getEntries();
	let name = sessionName(pi);
	let entries = memoryEntries;
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (sessionFile) {
		try {
			const disk = SessionManager.open(sessionFile);
			name = disk.getSessionName()?.trim() || undefined;
			entries = disk.getEntries();
		} catch {
			/* In-memory/unflushed sessions use the live manager. */
		}
	}
	return {
		name,
		released: ownershipReleased(memoryEntries) || ownershipReleased(entries),
	};
};

export default function autoSessionName(pi: AutoSessionNameAPI) {
	const state = createTitleOwnershipState({
		maxRecentRawRequests: MAX_RECENT_RAW_REQUESTS,
		timeoutMs: TITLE_TIMEOUT_MS,
	});

	const titleInfoFor = (ctx: AutoSessionNameContext): AuthoritativeTitleInfo =>
		authoritativeTitleInfo(pi, ctx);

	const persistState = (nextState: AutoTitleState) => {
		pi.appendEntry(STATE_ENTRY_TYPE, nextState);
	};

	const persistTitle = (committed: AutoTitleState) => {
		pi.setSessionName(committed.title);
		pi.appendEntry(STATE_ENTRY_TYPE, committed);
	};

	const restoreBranch = (
		ctx: AutoSessionNameContext,
		options?: { allowExistingRequests?: boolean; activate?: boolean },
	) => {
		const branch = ctx.sessionManager.getBranch();
		state.restore({
			branchState: reconstructAutoTitleState(branch),
			titleInfo: titleInfoFor(ctx),
			hasExistingRequests: extractUserRequests(branch).length > 0,
			allowExistingRequests: options?.allowExistingRequests,
			activate: options?.activate,
		});
	};

	const runInitialNaming = async (
		ctx: AutoSessionNameContext,
		storedRequests: string[],
	) => {
		const lease = state.beginInitial(sessionName(pi));
		if (!lease) return;
		try {
			const settings = await readSettings();
			if (!settings.enabled || !lease.canCommit(() => titleInfoFor(ctx))) {
				return;
			}

			const cleanedRequest = state.firstRequest(storedRequests[0]);
			if (!cleanedRequest) return;
			const request = truncateHeadAndTail(
				compactWhitespace(extractUserRequest(cleanedRequest)),
			);
			if (!isMeaningfulUserRequest(request)) return;

			const generation = lease.createController(ctx.signal);
			let generatedTitle: string | undefined;
			try {
				generatedTitle = await generateTitle(
					createInitialTitlePrompt(request),
					ctx,
					settings,
					generation.controller.signal,
				);
			} catch {
				generatedTitle = undefined;
			} finally {
				generation.cleanup();
			}

			const title = generatedTitle ?? makeFallbackTitle(request);
			if (!title) return;
			lease.commit(
				() => titleInfoFor(ctx),
				{
					title,
					originalRequest: request,
					phase: "initial",
					refinementAttempted: false,
					initialFallback: !generatedTitle,
				},
				persistTitle,
			);
		} finally {
			lease.finish();
		}
	};

	const runRefinement = async (
		ctx: AutoSessionNameContext,
		candidate: AutoTitleState,
		storedRequests: string[],
	) => {
		const currentTitle = candidate.title;
		const lease = state.beginRefinement(currentTitle, () => titleInfoFor(ctx));
		if (!lease) return;
		try {
			const settings = await readSettings();
			if (!settings.enabled) return;

			const consumedState = lease.markAttempted(
				() => titleInfoFor(ctx),
				persistState,
			);
			if (!consumedState) return;
			const recentRaw = state.recentRequests();
			const recentRequests = (
				recentRaw.length > 0 ? recentRaw : storedRequests.slice(-2)
			)
				.slice(-2)
				.map((request) =>
					truncateHeadAndTail(request, MAX_RECENT_REQUEST_CHARS),
				);
			const anchors = extractStableAnchors([
				...recentRaw.slice(-2).reverse(),
				...storedRequests.slice(-2).reverse(),
				candidate.originalRequest,
			]);
			const prompt = createRefinementTitlePrompt({
				currentTitle,
				originalRequest: candidate.originalRequest,
				recentRequests,
				anchors,
			});
			const generation = lease.createController(ctx.signal);
			let refinedTitle: string | undefined;
			try {
				refinedTitle = await generateTitle(
					prompt,
					ctx,
					settings,
					generation.controller.signal,
				);
			} catch {
				refinedTitle = undefined;
			} finally {
				generation.cleanup();
			}

			if (!refinedTitle || refinedTitle === currentTitle) {
				return;
			}
			lease.commit(
				() => titleInfoFor(ctx),
				{
					...consumedState,
					title: refinedTitle,
					phase: "refinement",
				},
				persistTitle,
			);
		} finally {
			lease.finish();
		}
	};

	pi.on("input", (event) => {
		const commandInput = COMMAND_RE.test(compactWhitespace(event.text));
		if (event.source === "extension" && commandInput) return;

		const request = cleanRawUserInput(event.text);
		if (!request || !isMeaningfulUserRequest(request)) return;
		state.recordInput(request);
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (!state.shouldRunInitial()) return;
		const storedRequests = extractUserRequests(ctx.sessionManager.getBranch());
		await runInitialNaming(ctx, storedRequests).catch(() => undefined);
	});

	pi.on("agent_settled", async (event, ctx) => {
		if (event.aborted) return;
		const candidate = state.refinementCandidate();
		if (!candidate) return;
		const storedRequests = extractUserRequests(ctx.sessionManager.getBranch());
		if (shouldRefineTitle({ state: candidate, userRequests: storedRequests })) {
			await runRefinement(ctx, candidate, storedRequests).catch(
				() => undefined,
			);
		}
	});

	pi.on("session_start", (event, ctx) => {
		restoreBranch(ctx, {
			activate: true,
			allowExistingRequests: event.reason === "fork",
		});
	});

	pi.on("session_tree", (_event, ctx) => {
		restoreBranch(ctx);
	});

	pi.on("session_info_changed", (event) => {
		state.handleSessionInfoChanged(event.name, persistState);
	});

	pi.on("session_shutdown", () => {
		state.shutdown();
	});
}
