import { describe, expect, test, vi } from "vitest";
import llmHub, {
	buildModelsUrl,
	createLlmHubExtension,
	discoverModels,
	type LlmHubExtensionApi,
	loginLlmHub,
	normalizeBaseUrl,
	resolveLlmHubCredentials,
} from "./llm-hub";
import type {
	ExtensionContextLike,
	OtelEventName,
	OtelHandler,
} from "./otel-metrics";

type TestModel = {
	id: string;
	name: string;
	provider: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
	};
	contextWindow: number;
	maxTokens: number;
	thinkingLevelMap?: unknown;
	compat?: unknown;
};

type FetchInit = {
	headers?: Record<string, string>;
	signal?: AbortSignal;
};

type FetchResponse = {
	ok: boolean;
	json(): Promise<unknown>;
};

type FetchCall = {
	url: string;
	init?: FetchInit;
};

type RegisteredProvider = {
	name: string;
	config: unknown;
};

const makeModel = (overrides: Partial<TestModel> = {}): TestModel => ({
	id: "claude-sonnet-4-5-20250929",
	name: "Claude Sonnet 4.5",
	provider: "anthropic",
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	contextWindow: 200000,
	maxTokens: 64000,
	...overrides,
});

const createFetch = (responses: FetchResponse[]) => {
	const calls: FetchCall[] = [];
	const fetch = async (
		url: string,
		init?: FetchInit,
	): Promise<FetchResponse> => {
		calls.push({ url, init });
		const response = responses.shift();
		if (!response) throw new Error("unexpected fetch");
		return response;
	};
	return { fetch, calls };
};

const jsonResponse = (payload: unknown, ok = true): FetchResponse => ({
	ok,
	async json() {
		return payload;
	},
});

const invalidJsonResponse = (): FetchResponse => ({
	ok: true,
	async json() {
		throw new SyntaxError("invalid json");
	},
});

describe("llm-hub settings", () => {
	test("normalizes base URL by trimming trailing slashes", () => {
		expect(normalizeBaseUrl(" https://llm-hub.example.com/// ")).toBe(
			"https://llm-hub.example.com",
		);
		expect(normalizeBaseUrl("")).toBeUndefined();
		expect(normalizeBaseUrl("not a url")).toBeUndefined();
	});

	test("saved login credentials take precedence over LLMHUB environment variables", () => {
		const authStorage = {
			get: () => ({
				type: "oauth" as const,
				access: "saved-token",
				refresh: "",
				expires: Number.MAX_SAFE_INTEGER,
				baseUrl: "https://saved.example.com/",
			}),
		};

		expect(
			resolveLlmHubCredentials(authStorage, {
				LLMHUB_BASE_URL: "https://env.example.com",
				LLMHUB_AUTH_TOKEN: "env-token",
			}),
		).toEqual({
			baseUrl: "https://saved.example.com",
			token: "saved-token",
		});
	});

	test("falls back to LLMHUB environment variables", () => {
		expect(
			resolveLlmHubCredentials(
				{ get: () => undefined },
				{
					LLMHUB_BASE_URL: "https://env.example.com/",
					LLMHUB_AUTH_TOKEN: " env-token ",
				},
			),
		).toEqual({
			baseUrl: "https://env.example.com",
			token: "env-token",
		});
	});
});

describe("llm-hub discovery", () => {
	test("builds /v1/models discovery URLs", () => {
		expect(buildModelsUrl("https://llm-hub.example.com/")).toBe(
			"https://llm-hub.example.com/v1/models",
		);
		expect(buildModelsUrl("https://llm-hub.example.com", "model-1")).toBe(
			"https://llm-hub.example.com/v1/models?after_id=model-1",
		);
	});

	test("discovery calls baseUrl /v1/models and sends Anthropic headers", async () => {
		const { fetch, calls } = createFetch([
			jsonResponse({ data: [{ id: "model-1" }] }),
		]);

		await expect(
			discoverModels({
				baseUrl: "https://llm-hub.example.com",
				token: "secret",
				fetch,
			}),
		).resolves.toEqual([{ id: "model-1" }]);
		expect(calls[0]?.url).toBe("https://llm-hub.example.com/v1/models");
		expect(calls[0]?.init?.headers).toEqual({
			"x-api-key": "secret",
			"anthropic-version": "2023-06-01",
		});
	});

	test("non-2xx and invalid JSON fail discovery silently", async () => {
		const nonOk = createFetch([jsonResponse({ error: "nope" }, false)]);
		await expect(
			discoverModels({
				baseUrl: "https://llm-hub.example.com",
				token: "secret",
				fetch: nonOk.fetch,
			}),
		).resolves.toBeUndefined();

		const invalidJson = createFetch([invalidJsonResponse()]);
		await expect(
			discoverModels({
				baseUrl: "https://llm-hub.example.com",
				token: "secret",
				fetch: invalidJson.fetch,
			}),
		).resolves.toBeUndefined();
	});

	test("pagination follows has_more and last_id", async () => {
		const { fetch, calls } = createFetch([
			jsonResponse({
				data: [{ id: "model-1" }],
				has_more: true,
				last_id: "model-1",
			}),
			jsonResponse({ data: [{ id: "model-2" }], has_more: false }),
		]);

		await expect(
			discoverModels({
				baseUrl: "https://llm-hub.example.com",
				token: "secret",
				fetch,
			}),
		).resolves.toEqual([{ id: "model-1" }, { id: "model-2" }]);
		expect(calls.map((call) => call.url)).toEqual([
			"https://llm-hub.example.com/v1/models",
			"https://llm-hub.example.com/v1/models?after_id=model-1",
		]);
	});

	test("pagination cap prevents infinite loops", async () => {
		const responses = Array.from({ length: 25 }, (_entry, index) =>
			jsonResponse({
				data: [{ id: `model-${index}` }],
				has_more: true,
				last_id: `model-${index}`,
			}),
		);
		const { fetch, calls } = createFetch(responses);

		await expect(
			discoverModels({
				baseUrl: "https://llm-hub.example.com",
				token: "secret",
				fetch,
			}),
		).resolves.toBeUndefined();
		expect(calls).toHaveLength(20);
	});
});

describe("llm-hub login", () => {
	test("prompts for base URL and API key and verifies model discovery", async () => {
		const prompts = ["https://llm-hub.example.com/", "secret"];
		const progress: string[] = [];
		const { fetch, calls } = createFetch([
			jsonResponse({ data: [{ id: "model-1" }] }),
		]);

		await expect(
			loginLlmHub(
				{
					onAuth() {},
					onPrompt: async () => prompts.shift() ?? "",
					onProgress: (message) => progress.push(message),
				},
				{ fetch },
			),
		).resolves.toMatchObject({
			credentials: {
				access: "secret",
				refresh: "",
				expires: Number.MAX_SAFE_INTEGER,
				baseUrl: "https://llm-hub.example.com",
			},
			models: [{ id: "model-1" }],
		});
		expect(calls[0]?.init?.headers?.["x-api-key"]).toBe("secret");
		expect(progress).toEqual(["LLM Hub: discovered 1 model(s)"]);
	});

	test("rejects credentials when discovery fails", async () => {
		const prompts = ["https://llm-hub.example.com", "bad-secret"];
		const { fetch } = createFetch([jsonResponse({ error: "nope" }, false)]);

		await expect(
			loginLlmHub(
				{
					onAuth() {},
					onPrompt: async () => prompts.shift() ?? "",
				},
				{ fetch },
			),
		).rejects.toThrow("LLM Hub returned no usable models");
	});
});

describe("llm-hub extension", () => {
	class FakeManager {
		readonly sessionId = "session-1";
		starts: string[] = [];
		stops = 0;
		flushes = 0;

		async start(startType: "fresh" | "resume" | "continue") {
			this.starts.push(startType);
		}

		async stop() {
			this.stops += 1;
		}

		async flush() {
			this.flushes += 1;
		}

		recordTokenUsage() {}
		recordCostUsage() {}
		async recordToolCall() {}
		recordToolResult() {}
		recordUserActivity() {}
		recordAgentStart() {}
		recordAgentEnd() {}
	}

	const createExtensionHarness = () => {
		const registrations: RegisteredProvider[] = [];
		const handlers = new Map<OtelEventName, OtelHandler[]>();
		const pi: LlmHubExtensionApi = {
			registerProvider(name, config) {
				registrations.push({ name, config });
			},
			on(eventName, handler) {
				const current = handlers.get(eventName) ?? [];
				current.push(handler);
				handlers.set(eventName, current);
			},
		};
		const emit = async (
			eventName: OtelEventName,
			event: unknown,
			ctx: ExtensionContextLike,
		): Promise<void> => {
			for (const handler of handlers.get(eventName) ?? []) {
				await handler(event, ctx);
			}
		};
		return { pi, registrations, handlers, emit };
	};

	test("registers the login flow even when environment credentials are absent", async () => {
		const { pi, registrations, handlers } = createExtensionHarness();

		await createLlmHubExtension({
			env: {},
			authStorage: { get: () => undefined },
		})(pi);

		expect(registrations).toHaveLength(1);
		expect(registrations[0]).toMatchObject({
			name: "llm-hub",
			config: {
				name: "LLM Hub",
				apiKey: "$LLMHUB_AUTH_TOKEN",
				models: [],
				oauth: { name: "LLM Hub" },
			},
		});
		expect(handlers.has("session_start")).toBe(true);
	});

	test("failed startup discovery still leaves login available", async () => {
		const { fetch } = createFetch([jsonResponse({ data: [] })]);
		const { pi, registrations, handlers } = createExtensionHarness();

		await createLlmHubExtension({
			fetch,
			env: {
				LLMHUB_BASE_URL: "https://llm-hub.example.com",
				LLMHUB_AUTH_TOKEN: "secret",
			},
			authStorage: { get: () => undefined },
		})(pi);

		expect(registrations).toHaveLength(1);
		expect(registrations[0]).toMatchObject({
			config: { models: [], oauth: { name: "LLM Hub" } },
		});
		expect(handlers.has("session_start")).toBe(true);
	});

	test("registers the fixed llm-hub provider during async extension load", async () => {
		const { fetch } = createFetch([
			jsonResponse({ data: [{ id: "claude-sonnet-4-5-20250929" }] }),
		]);
		const { pi, registrations, handlers } = createExtensionHarness();

		await createLlmHubExtension({
			fetch,
			env: {
				LLMHUB_BASE_URL: "https://llm-hub.example.com/",
				LLMHUB_AUTH_TOKEN: " secret ",
			},
			authStorage: { get: () => undefined },
		})(pi);

		expect(registrations).toHaveLength(1);
		expect(registrations[0]).toMatchObject({
			name: "llm-hub",
			config: {
				name: "LLM Hub",
				baseUrl: "https://llm-hub.example.com",
				apiKey: "$LLMHUB_AUTH_TOKEN",
				api: "anthropic-messages",
			},
		});
		expect(handlers.has("session_start")).toBe(true);
		expect(handlers.has("model_select")).toBe(true);
	});

	test("login refreshes the provider with discovered models and saved base URL", async () => {
		const responses = [jsonResponse({ data: [{ id: "model-after-login" }] })];
		const { fetch } = createFetch(responses);
		const { pi, registrations } = createExtensionHarness();
		await createLlmHubExtension({
			fetch,
			env: {},
			authStorage: { get: () => undefined },
		})(pi);

		const registration = registrations[0];
		expect(registration).toBeDefined();
		if (!registration) throw new Error("provider was not registered");
		const oauth = (
			registration.config as {
				oauth: { login(callbacks: unknown): Promise<unknown> };
			}
		).oauth;
		const prompts = ["https://saved.example.com/", "saved-token"];
		await oauth.login({
			onAuth() {},
			onPrompt: async () => prompts.shift() ?? "",
		});

		expect(registrations).toHaveLength(2);
		expect(registrations[1]).toMatchObject({
			config: {
				baseUrl: "https://saved.example.com",
				models: [{ id: "model-after-login" }],
			},
		});
	});

	test("telemetry follows llm-hub and excludes litellm", async () => {
		vi.stubEnv("CLAUDE_CODE_ENABLE_TELEMETRY", "1");
		vi.stubEnv("OTEL_METRICS_EXPORTER", "otlp");
		vi.stubEnv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json");
		vi.stubEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "https://otel.example");
		const { fetch } = createFetch([
			jsonResponse({ data: [{ id: "model-1" }] }),
		]);
		const manager = new FakeManager();
		const { pi, emit } = createExtensionHarness();
		await createLlmHubExtension({
			fetch,
			env: {
				LLMHUB_BASE_URL: "https://llm-hub.example.com",
				LLMHUB_AUTH_TOKEN: "secret",
			},
			authStorage: { get: () => undefined },
			telemetry: {
				managerFactory: () => manager,
				versionResolver: async () => "9.8.7",
			},
		})(pi);

		await emit(
			"session_start",
			{ reason: "startup" },
			{ model: makeModel({ provider: "litellm" }) },
		);
		expect(manager.starts).toEqual([]);

		await emit(
			"model_select",
			{
				previousModel: makeModel({ provider: "litellm" }),
				model: makeModel({ provider: "llm-hub" }),
			},
			{ model: makeModel({ provider: "litellm" }) },
		);
		expect(manager.starts).toEqual(["fresh"]);

		await emit(
			"model_select",
			{
				previousModel: makeModel({ provider: "llm-hub" }),
				model: makeModel({ provider: "litellm" }),
			},
			{ model: makeModel({ provider: "llm-hub" }) },
		);
		expect(manager.flushes).toBe(1);
		expect(manager.stops).toBe(1);
	});

	test("default export is the async extension factory", () => {
		expect(llmHub).toBeTypeOf("function");
	});
});
