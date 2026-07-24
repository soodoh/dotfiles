import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Message, Model, UserMessage } from "@earendil-works/pi-ai";
import { complete, completeSimple } from "@earendil-works/pi-ai/compat";
import {
	type AgentSettledEvent,
	type ExtensionAPI,
	type ExtensionContext,
	type InputEvent,
	type SessionEntry,
	type SessionInfoChangedEvent,
	SessionManager,
	type SessionShutdownEvent,
	type SessionStartEvent,
	type SessionTreeEvent,
} from "@earendil-works/pi-coding-agent";

type AutoSessionNameContext = Pick<ExtensionContext, "model" | "signal"> & {
	modelRegistry: Pick<
		ExtensionContext["modelRegistry"],
		"getAll" | "getApiKeyAndHeaders"
	>;
	sessionManager: Pick<
		ExtensionContext["sessionManager"],
		"getBranch" | "getSessionFile"
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

export type AutoTitleState = {
	title: string;
	originalRequest: string;
	phase: "initial" | "refinement";
	refinementAttempted: boolean;
	initialFallback: boolean;
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
const MAX_TITLE_OUTPUT_TOKENS = 32;
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

export const extractUserRequest = (text: string): string =>
	text.replace(LEADING_SKILL_RE, "").trim();

export const cleanRawUserInput = (text: string): string | undefined => {
	const input = compactWhitespace(text);
	if (!input) return undefined;

	const command = input.match(COMMAND_RE);
	if (!command) return input;

	const argumentsText = command[1] ? compactWhitespace(command[1]) : "";
	return argumentsText || undefined;
};

export const truncateHeadAndTail = (
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
		request && /[A-Za-z0-9]/.test(request) && !COMMAND_RE.test(request),
	);
};

export const extractUserRequests = (entries: SessionEntry[]): string[] => {
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

export const normalizeModelTitle = (text: string): string | undefined => {
	const title = capTitle(trimTitleDecorations(compactWhitespace(text)));
	return title || undefined;
};

export const makeFallbackTitle = (request: string): string | undefined =>
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

export const isWeakRequest = (request: string): boolean => {
	const normalized = normalizeForComparison(request);
	if (!normalized || GENERIC_REQUEST_RE.test(normalized)) return true;
	return request.length <= 32 && meaningfulTerms(request).length <= 1;
};

export const isWeakTitle = (title: string): boolean => {
	const normalized = normalizeForComparison(title);
	return !normalized || GENERIC_TITLE_RE.test(normalized);
};

export const hasDirectionChange = (request: string): boolean =>
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

export const extractStableAnchors = (requests: string[]): string[] => {
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

export const shouldRefineTitle = ({
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
	typeof value.initialFallback === "boolean";

export const reconstructAutoTitleState = (
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
		}
	}
	return state;
};

const createUserMessage = (text: string): UserMessage => ({
	role: "user",
	content: [{ type: "text", text }],
	timestamp: Date.now(),
});

export const createInitialTitlePrompt = (request: string): Prompt => ({
	systemPrompt:
		"Create a concise Pi session title from the user's request. Return only plain text, 3-8 words, no quotes, no markdown, maximum 60 characters.",
	messages: [createUserMessage(request)],
});

export const createRefinementTitlePrompt = ({
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
			join(homedir(), ".pi", "agent", "settings.json"),
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
	const auth = await awaitWithAbort(
		ctx.modelRegistry.getApiKeyAndHeaders(model),
		signal,
	);
	if (!auth.ok) throw new Error(auth.error);

	const baseOptions = {
		apiKey: auth.apiKey,
		headers: auth.headers,
		env: auth.env,
		maxTokens: MAX_TITLE_OUTPUT_TOKENS,
		temperature: TITLE_TEMPERATURE,
		timeoutMs: TITLE_TIMEOUT_MS,
		maxRetries: TITLE_PROVIDER_RETRIES,
		signal,
	};
	const response =
		model.api === "openai-codex-responses"
			? await complete(model, prompt, {
					...baseOptions,
					reasoningEffort: "none",
				})
			: await completeSimple(model, prompt, {
					...baseOptions,
					reasoning: undefined,
				});
	if (response.stopReason === "error" || response.stopReason === "aborted") {
		throw new Error(response.errorMessage ?? "Title generation failed");
	}
	return normalizeModelTitle(extractCompletionText(response.content));
};

const sessionName = (pi: AutoSessionNameAPI): string | undefined =>
	pi.getSessionName()?.trim() || undefined;

const authoritativeSessionName = (
	pi: AutoSessionNameAPI,
	ctx: AutoSessionNameContext,
): string | undefined => {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) return sessionName(pi);

	try {
		return (
			SessionManager.open(sessionFile).getSessionName()?.trim() || undefined
		);
	} catch {
		return sessionName(pi);
	}
};

export default function autoSessionName(pi: AutoSessionNameAPI) {
	let active = true;
	let sessionEpoch = 0;
	let initialEligible = true;
	let firstRawRequest: string | undefined;
	let recentRawRequests: string[] = [];
	let autoTitleState: AutoTitleState | undefined;
	let ownsTitle = false;
	let manualOverride = false;
	let inFlight: "initial" | "refinement" | undefined;
	let requestController: AbortController | undefined;
	let applyingTitle: string | undefined;

	const abortRequest = () => {
		requestController?.abort();
		requestController = undefined;
	};

	const restoreBranchState = (ctx: AutoSessionNameContext) => {
		abortRequest();
		sessionEpoch += 1;
		firstRawRequest = undefined;
		recentRawRequests = [];
		inFlight = undefined;
		autoTitleState = reconstructAutoTitleState(ctx.sessionManager.getBranch());
		const currentName = sessionName(pi);
		ownsTitle = Boolean(autoTitleState && currentName === autoTitleState.title);
		manualOverride = Boolean(
			(autoTitleState && currentName !== autoTitleState.title) ||
				(!autoTitleState && currentName),
		);
		initialEligible =
			!autoTitleState &&
			!manualOverride &&
			extractUserRequests(ctx.sessionManager.getBranch()).length === 0;
	};

	const applyAutomaticTitle = (nextState: AutoTitleState) => {
		autoTitleState = nextState;
		ownsTitle = true;
		manualOverride = false;
		applyingTitle = nextState.title;
		try {
			pi.setSessionName(nextState.title);
			pi.appendEntry(STATE_ENTRY_TYPE, nextState);
		} finally {
			applyingTitle = undefined;
		}
	};

	const appendState = (nextState: AutoTitleState) => {
		autoTitleState = nextState;
		pi.appendEntry(STATE_ENTRY_TYPE, nextState);
	};

	const createRequestController = (parentSignal: AbortSignal | undefined) => {
		const controller = new AbortController();
		const abortFromParent = () => controller.abort();
		if (parentSignal?.aborted) controller.abort();
		else
			parentSignal?.addEventListener("abort", abortFromParent, { once: true });
		requestController = controller;
		const timeout = setTimeout(() => controller.abort(), TITLE_TIMEOUT_MS);
		return {
			controller,
			cleanup() {
				clearTimeout(timeout);
				parentSignal?.removeEventListener("abort", abortFromParent);
				if (requestController === controller) requestController = undefined;
			},
		};
	};

	const canApplyInitial = (
		epoch: number,
		ctx: AutoSessionNameContext,
	): boolean =>
		active &&
		sessionEpoch === epoch &&
		!manualOverride &&
		!autoTitleState &&
		!authoritativeSessionName(pi, ctx);

	const canApplyRefinement = (
		epoch: number,
		currentTitle: string,
		ctx: AutoSessionNameContext,
	): boolean =>
		active &&
		sessionEpoch === epoch &&
		ownsTitle &&
		!manualOverride &&
		autoTitleState?.title === currentTitle &&
		authoritativeSessionName(pi, ctx) === currentTitle;

	const runInitialNaming = async (
		ctx: AutoSessionNameContext,
		storedRequests: string[],
	) => {
		if (inFlight || !initialEligible || manualOverride || sessionName(pi))
			return;
		inFlight = "initial";
		const epoch = sessionEpoch;
		try {
			const settings = await readSettings();
			if (!settings.enabled || !canApplyInitial(epoch, ctx)) return;

			const fallbackRequest = storedRequests[0];
			const cleanedRequest = firstRawRequest ?? fallbackRequest;
			if (!cleanedRequest) return;
			const request = truncateHeadAndTail(
				compactWhitespace(extractUserRequest(cleanedRequest)),
			);
			if (!isMeaningfulUserRequest(request)) return;

			const generation = createRequestController(ctx.signal);
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

			if (!canApplyInitial(epoch, ctx)) return;
			const title = generatedTitle ?? makeFallbackTitle(request);
			if (!title) return;
			applyAutomaticTitle({
				title,
				originalRequest: request,
				phase: "initial",
				refinementAttempted: false,
				initialFallback: !generatedTitle,
			});
			initialEligible = false;
		} finally {
			if (sessionEpoch === epoch) inFlight = undefined;
		}
	};

	const runRefinement = async (
		ctx: AutoSessionNameContext,
		state: AutoTitleState,
		storedRequests: string[],
	) => {
		if (inFlight || !canApplyRefinement(sessionEpoch, state.title, ctx)) return;
		inFlight = "refinement";
		const epoch = sessionEpoch;
		const currentTitle = state.title;
		try {
			const settings = await readSettings();
			if (!settings.enabled || !canApplyRefinement(epoch, currentTitle, ctx))
				return;

			const consumedState = { ...state, refinementAttempted: true };
			appendState(consumedState);

			const recentRequests = (
				recentRawRequests.length > 0
					? recentRawRequests
					: storedRequests.slice(-2)
			)
				.slice(-2)
				.map((request) =>
					truncateHeadAndTail(request, MAX_RECENT_REQUEST_CHARS),
				);
			const anchors = extractStableAnchors([
				...recentRawRequests.slice(-2).reverse(),
				...storedRequests.slice(-2).reverse(),
				state.originalRequest,
			]);
			const prompt = createRefinementTitlePrompt({
				currentTitle,
				originalRequest: state.originalRequest,
				recentRequests,
				anchors,
			});
			const generation = createRequestController(ctx.signal);
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

			if (
				!refinedTitle ||
				refinedTitle === currentTitle ||
				!canApplyRefinement(epoch, currentTitle, ctx)
			) {
				return;
			}
			applyAutomaticTitle({
				...consumedState,
				title: refinedTitle,
				phase: "refinement",
			});
		} finally {
			if (sessionEpoch === epoch) inFlight = undefined;
		}
	};

	pi.on("input", (event) => {
		const commandInput = COMMAND_RE.test(compactWhitespace(event.text));
		if (event.source === "extension" && commandInput) return;

		const request = cleanRawUserInput(event.text);
		if (!request || !isMeaningfulUserRequest(request)) return;
		firstRawRequest ??= request;
		recentRawRequests = [...recentRawRequests, request].slice(
			-MAX_RECENT_RAW_REQUESTS,
		);
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (!active || manualOverride) return;
		const storedRequests = extractUserRequests(ctx.sessionManager.getBranch());
		if (!autoTitleState) {
			void runInitialNaming(ctx, storedRequests).catch(() => undefined);
			return;
		}
		if (
			ownsTitle &&
			shouldRefineTitle({ state: autoTitleState, userRequests: storedRequests })
		) {
			void runRefinement(ctx, autoTitleState, storedRequests).catch(
				() => undefined,
			);
		}
	});

	pi.on("session_start", (_event, ctx) => {
		active = true;
		restoreBranchState(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		restoreBranchState(ctx);
	});

	pi.on("session_info_changed", (event) => {
		if (applyingTitle === event.name) return;
		if (autoTitleState && event.name !== autoTitleState.title) {
			ownsTitle = false;
			manualOverride = true;
			return;
		}
		if (!autoTitleState && event.name?.trim()) manualOverride = true;
	});

	pi.on("session_shutdown", () => {
		active = false;
		sessionEpoch += 1;
		abortRequest();
		inFlight = undefined;
	});
}
