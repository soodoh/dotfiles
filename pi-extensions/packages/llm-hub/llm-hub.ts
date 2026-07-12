import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_PROVIDER_NAME = "llm-hub";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 2000;
const MAX_DISCOVERY_PAGES = 20;

type LlmHubSettings = {
	providerName?: unknown;
};

type DiscoveredModel = {
	id: string;
	displayName?: string;
};

type ParsedModelsResponse = {
	models: DiscoveredModel[];
	hasMore: boolean;
	lastId?: string;
};

type ModelCost = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
};

type ProviderModelConfig = {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: ModelCost;
	contextWindow: number;
	maxTokens: number;
	thinkingLevelMap?: unknown;
	compat?: unknown;
};

type ModelLike = ProviderModelConfig & {
	provider: string;
	api?: string;
	baseUrl?: string;
};

type ModelRegistryLike = {
	getAll(): ModelLike[];
};

type ExtensionContextLike = {
	cwd?: string;
	hasUI?: boolean;
	ui?: {
		notify(message: string, type?: "info" | "warning" | "error"): void;
	};
	modelRegistry: ModelRegistryLike;
};

type ProviderRegistrationConfig = {
	name: string;
	baseUrl: string;
	apiKey: string;
	api: "anthropic-messages";
	models: ProviderModelConfig[];
};

type ExtensionApiLike = {
	on(
		eventName: "session_start",
		handler: (event: unknown, ctx: ExtensionContextLike) => void,
	): void;
	registerProvider(name: string, config: ProviderRegistrationConfig): void;
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

type RegisterOptions = {
	env?: Record<string, string | undefined>;
	cwd?: string;
	homeDir?: string;
	fetch?: FetchLike;
	timeoutMs?: number;
};

type DiscoverOptions = {
	baseUrl: string;
	token: string;
	fetch: FetchLike;
	timeoutMs?: number;
};

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
	typeof value === "object" && value !== null;

const hasOwn = (value: Record<PropertyKey, unknown>, key: string): boolean =>
	Object.hasOwn(value, key);

const readSettingsFile = async (
	path: string,
): Promise<LlmHubSettings | undefined> => {
	try {
		const content = await readFile(path, "utf8");
		const parsed = JSON.parse(content);
		if (!isRecord(parsed) || !hasOwn(parsed, "llm-hub")) return undefined;
		const config = parsed["llm-hub"];
		if (!isRecord(config)) return {};
		return hasOwn(config, "providerName")
			? { providerName: config.providerName }
			: {};
	} catch {
		return undefined;
	}
};

export const readLlmHubSettings = async (
	cwd: string,
	homeDir: string,
): Promise<LlmHubSettings> => {
	const globalSettings = await readSettingsFile(
		join(homeDir, ".pi", "agent", "settings.json"),
	);
	const projectSettings = await readSettingsFile(
		join(cwd, ".pi", "settings.json"),
	);

	return { ...(globalSettings ?? {}), ...(projectSettings ?? {}) };
};

export const normalizeProviderName = (value: unknown): string => {
	if (typeof value !== "string") return DEFAULT_PROVIDER_NAME;
	const trimmed = value.trim();
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed)) {
		return DEFAULT_PROVIDER_NAME;
	}
	return trimmed;
};

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
	anthropicDefaults: ModelLike | undefined,
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

export const providerNameExists = (
	providerName: string,
	modelRegistry: ModelRegistryLike,
): boolean =>
	modelRegistry.getAll().some((model) => model.provider === providerName);

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

const notifyCollision = (
	providerName: string,
	ctx: ExtensionContextLike,
): void => {
	const message = `llm-hub provider name "${providerName}" already exists; skipping registration.`;
	if (ctx.hasUI && ctx.ui?.notify) {
		ctx.ui.notify(message, "error");
		return;
	}
	console.error(message);
};

export const registerLlmHubProvider = async (
	pi: Pick<ExtensionApiLike, "registerProvider">,
	ctx: ExtensionContextLike,
	options: RegisterOptions = {},
): Promise<string | undefined> => {
	const env = options.env ?? process.env;
	const baseUrl = normalizeBaseUrl(env.ANTHROPIC_BASE_URL);
	const token = env.ANTHROPIC_AUTH_TOKEN?.trim();
	if (!baseUrl || !token) return undefined;

	const settings = await readLlmHubSettings(
		options.cwd ?? ctx.cwd ?? process.cwd(),
		options.homeDir ?? homedir(),
	);
	const providerName = normalizeProviderName(settings.providerName);

	if (providerNameExists(providerName, ctx.modelRegistry)) {
		notifyCollision(providerName, ctx);
		return undefined;
	}

	const fetchImpl = options.fetch ?? globalThis.fetch;
	const discoveredModels = await discoverModels({
		baseUrl,
		token,
		fetch: fetchImpl,
		timeoutMs: options.timeoutMs,
	});
	if (!discoveredModels || discoveredModels.length === 0) return undefined;

	const anthropicDefaults = new Map(
		ctx.modelRegistry
			.getAll()
			.filter((model) => model.provider === "anthropic")
			.map((model) => [model.id, model]),
	);
	const models = discoveredModels.map((model) =>
		toProviderModel(model, anthropicDefaults.get(model.id)),
	);

	pi.registerProvider(providerName, {
		name: providerName,
		baseUrl,
		apiKey: "ANTHROPIC_AUTH_TOKEN",
		api: "anthropic-messages",
		models,
	});
	return providerName;
};

export const createLlmHubExtension = (
	options: RegisterOptions = {},
): ((pi: ExtensionApiLike) => void) => {
	return (pi: ExtensionApiLike): void => {
		let registeredProviderName: string | undefined;

		pi.on("session_start", (_event, ctx) => {
			if (registeredProviderName) return;
			void registerLlmHubProvider(pi, ctx, options)
				.then((providerName) => {
					if (providerName) registeredProviderName = providerName;
				})
				.catch(() => {
					// silent
				});
		});
	};
};

export default function llmHub(pi: ExtensionApiLike): void {
	createLlmHubExtension()(pi);
}
