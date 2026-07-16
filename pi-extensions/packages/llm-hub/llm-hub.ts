import { join } from "node:path";
import type {
	OAuthCredentials,
	OAuthLoginCallbacks,
} from "@earendil-works/pi-ai";
import { getModels } from "@earendil-works/pi-ai/compat";
import {
	AuthStorage,
	type ExtensionAPI,
	getAgentDir,
	type ProviderConfig,
	type ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import {
	createClaudeOtelExtension,
	type OtelExtensionApi,
} from "./otel-metrics";

const DEFAULT_PROVIDER_NAME = "llm-hub";
const PROVIDER_DISPLAY_NAME = "LLM Hub";
const ENV_BASE_URL = "LLMHUB_BASE_URL";
const ENV_AUTH_TOKEN = "LLMHUB_AUTH_TOKEN";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 2000;
const LOGIN_TIMEOUT_MS = 10_000;
const MAX_DISCOVERY_PAGES = 20;
const PERMANENT_CREDENTIAL_EXPIRY = Number.MAX_SAFE_INTEGER;

type DiscoveredModel = {
	id: string;
	displayName?: string;
};

type ParsedModelsResponse = {
	models: DiscoveredModel[];
	hasMore: boolean;
	lastId?: string;
};

type FetchLike = (
	input: string,
	init?: {
		headers?: Record<string, string>;
		signal?: AbortSignal;
	},
) => Promise<{
	ok: boolean;
	json(): Promise<unknown>;
}>;

export type LlmHubExtensionApi = Pick<ExtensionAPI, "registerProvider"> &
	OtelExtensionApi;

type RegisterOptions = {
	env?: Record<string, string | undefined>;
	fetch?: FetchLike;
	timeoutMs?: number;
	authStorage?: Pick<AuthStorage, "get">;
	telemetry?: Omit<
		Parameters<typeof createClaudeOtelExtension>[0],
		"providerName"
	>;
};

type ResolvedCredentials = {
	baseUrl?: string;
	token?: string;
};

type LoginCredentials = OAuthCredentials & { baseUrl: string };

type LoginResult = {
	credentials: LoginCredentials;
	models: DiscoveredModel[];
};

type DiscoverOptions = {
	baseUrl: string;
	token: string;
	fetch: FetchLike;
	timeoutMs?: number;
};

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
	typeof value === "object" && value !== null;

const cleanString = (value: unknown): string | undefined => {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
};

const getAuthPath = (): string => join(getAgentDir(), "auth.json");

export const normalizeBaseUrl = (value: unknown): string | undefined => {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;

	try {
		const url = new URL(trimmed);
		if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
	} catch {
		return undefined;
	}

	return trimmed.replace(/\/+$/, "");
};

export const resolveLlmHubCredentials = (
	authStorage: Pick<AuthStorage, "get">,
	env: Record<string, string | undefined> = process.env,
): ResolvedCredentials => {
	const credential = authStorage.get(DEFAULT_PROVIDER_NAME);
	const savedBaseUrl =
		credential?.type === "oauth"
			? normalizeBaseUrl(credential.baseUrl)
			: undefined;
	const savedToken =
		credential?.type === "oauth"
			? cleanString(credential.access)
			: credential?.type === "api_key"
				? cleanString(credential.key)
				: undefined;

	return {
		baseUrl: savedBaseUrl ?? normalizeBaseUrl(env[ENV_BASE_URL]),
		token: savedToken ?? cleanString(env[ENV_AUTH_TOKEN]),
	};
};

export const buildModelsUrl = (baseUrl: string, afterId?: string): string => {
	const url = new URL(`${baseUrl.replace(/\/+$/, "")}/v1/models`);
	if (afterId) url.searchParams.set("after_id", afterId);
	return url.toString();
};

export const parseAnthropicModelsResponse = (
	payload: unknown,
): ParsedModelsResponse | undefined => {
	if (!isRecord(payload) || !Array.isArray(payload.data)) return undefined;

	const models = payload.data.flatMap((entry): DiscoveredModel[] => {
		if (!isRecord(entry) || typeof entry.id !== "string") return [];
		const id = entry.id.trim();
		if (!id) return [];
		const displayName =
			typeof entry.display_name === "string" && entry.display_name.trim()
				? entry.display_name.trim()
				: undefined;
		return [{ id, displayName }];
	});

	return {
		models,
		hasMore: payload.has_more === true,
		lastId:
			typeof payload.last_id === "string" && payload.last_id.trim()
				? payload.last_id.trim()
				: undefined,
	};
};

const fallbackModel = (id: string): ProviderModelConfig => ({
	id,
	name: id,
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 16384,
});

export const toProviderModel = (
	discoveredModel: DiscoveredModel,
	anthropicDefaults: ProviderModelConfig | undefined,
): ProviderModelConfig => {
	if (!anthropicDefaults) return fallbackModel(discoveredModel.id);

	return {
		id: discoveredModel.id,
		name: anthropicDefaults.name,
		reasoning: anthropicDefaults.reasoning,
		input: [...anthropicDefaults.input],
		cost: { ...anthropicDefaults.cost },
		contextWindow: anthropicDefaults.contextWindow,
		maxTokens: anthropicDefaults.maxTokens,
		...(anthropicDefaults.thinkingLevelMap !== undefined
			? { thinkingLevelMap: anthropicDefaults.thinkingLevelMap }
			: {}),
		...(anthropicDefaults.compat !== undefined
			? { compat: anthropicDefaults.compat }
			: {}),
	};
};

const fetchModelsPage = async ({
	url,
	token,
	fetch,
	timeoutMs,
}: {
	url: string;
	token: string;
	fetch: FetchLike;
	timeoutMs: number;
}): Promise<ParsedModelsResponse | undefined> => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetch(url, {
			headers: {
				"x-api-key": token,
				"anthropic-version": ANTHROPIC_VERSION,
			},
			signal: controller.signal,
		});
		if (!response.ok) return undefined;
		return parseAnthropicModelsResponse(await response.json());
	} catch {
		return undefined;
	} finally {
		clearTimeout(timeout);
	}
};

export const discoverModels = async ({
	baseUrl,
	token,
	fetch,
	timeoutMs = DEFAULT_TIMEOUT_MS,
}: DiscoverOptions): Promise<DiscoveredModel[] | undefined> => {
	const models = new Map<string, DiscoveredModel>();
	let afterId: string | undefined;

	for (let page = 0; page < MAX_DISCOVERY_PAGES; page++) {
		const parsed = await fetchModelsPage({
			url: buildModelsUrl(baseUrl, afterId),
			token,
			fetch,
			timeoutMs,
		});
		if (!parsed) return undefined;

		for (const model of parsed.models) {
			models.set(model.id, model);
		}

		if (!parsed.hasMore) return [...models.values()];
		if (!parsed.lastId) return undefined;
		afterId = parsed.lastId;
	}

	return undefined;
};

const permanentCredentials = (
	baseUrl: string,
	token: string,
): LoginCredentials => ({
	access: token,
	refresh: "",
	expires: PERMANENT_CREDENTIAL_EXPIRY,
	baseUrl,
});

export const loginLlmHub = async (
	callbacks: OAuthLoginCallbacks,
	options: Pick<DiscoverOptions, "fetch"> & { timeoutMs?: number },
): Promise<LoginResult> => {
	const rawBaseUrl = await callbacks.onPrompt({
		message: "Enter LLM Hub base URL:",
		placeholder: "https://llm-hub.example.com",
	});
	const baseUrl = normalizeBaseUrl(rawBaseUrl);
	if (!baseUrl) throw new Error("A valid HTTP(S) base URL is required");

	const token = cleanString(
		await callbacks.onPrompt({ message: "Enter LLM Hub API key:" }),
	);
	if (!token) throw new Error("API key is required");

	const models = await discoverModels({
		baseUrl,
		token,
		fetch: options.fetch,
		timeoutMs: options.timeoutMs ?? LOGIN_TIMEOUT_MS,
	});
	if (!models?.length) {
		throw new Error("LLM Hub returned no usable models");
	}
	callbacks.onProgress?.(`LLM Hub: discovered ${models.length} model(s)`);
	return { credentials: permanentCredentials(baseUrl, token), models };
};

const createProviderAuth = (
	fetch: FetchLike,
	timeoutMs: number,
	onLogin: (result: LoginResult) => void,
): NonNullable<ProviderConfig["oauth"]> => ({
	name: PROVIDER_DISPLAY_NAME,
	async login(callbacks) {
		const result = await loginLlmHub(callbacks, { fetch, timeoutMs });
		onLogin(result);
		return result.credentials;
	},
	async refreshToken(credentials) {
		return credentials;
	},
	getApiKey(credentials) {
		return credentials.access;
	},
	modifyModels(models, credentials) {
		const baseUrl = normalizeBaseUrl(credentials.baseUrl);
		if (!baseUrl) return models;
		return models.map((model) =>
			model.provider === DEFAULT_PROVIDER_NAME ? { ...model, baseUrl } : model,
		);
	},
});

export const createLlmHubExtension = (options: RegisterOptions = {}) => {
	return async (pi: LlmHubExtensionApi): Promise<void> => {
		const env = options.env ?? process.env;
		const authStorage =
			options.authStorage ?? AuthStorage.create(getAuthPath());
		const fetch = options.fetch ?? globalThis.fetch;
		const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		const credentials = resolveLlmHubCredentials(authStorage, env);
		const baseUrl = credentials.baseUrl ?? "https://llm-hub.example.com";
		const token = credentials.token;
		const discoveredModels =
			credentials.baseUrl && token
				? await discoverModels({ baseUrl, token, fetch, timeoutMs })
				: undefined;

		const anthropicDefaults = new Map(
			getModels("anthropic").map((model): [string, ProviderModelConfig] => [
				model.id,
				{
					id: model.id,
					name: model.name,
					reasoning: model.reasoning,
					thinkingLevelMap: model.thinkingLevelMap,
					input: model.input,
					cost: model.cost,
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
					compat: model.compat,
				},
			]),
		);
		const toProviderModels = (discovered: DiscoveredModel[]) =>
			discovered.map((model) =>
				toProviderModel(model, anthropicDefaults.get(model.id)),
			);
		let models = toProviderModels(discoveredModels ?? []);
		let oauth: NonNullable<ProviderConfig["oauth"]>;
		const registerProvider = (providerBaseUrl: string): void => {
			pi.registerProvider(DEFAULT_PROVIDER_NAME, {
				name: PROVIDER_DISPLAY_NAME,
				baseUrl: providerBaseUrl,
				apiKey: `$${ENV_AUTH_TOKEN}`,
				api: "anthropic-messages",
				models,
				oauth,
			});
		};
		oauth = createProviderAuth(fetch, LOGIN_TIMEOUT_MS, (result) => {
			models = toProviderModels(result.models);
			registerProvider(result.credentials.baseUrl);
		});
		registerProvider(baseUrl);
		createClaudeOtelExtension({
			providerName: DEFAULT_PROVIDER_NAME,
			...options.telemetry,
		})(pi);
	};
};

export default createLlmHubExtension();
