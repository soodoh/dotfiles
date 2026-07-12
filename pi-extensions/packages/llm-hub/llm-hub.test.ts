import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import llmHub, {
	buildModelsUrl,
	createLlmHubExtension,
	discoverModels,
	normalizeBaseUrl,
	normalizeProviderName,
	readLlmHubSettings,
	registerLlmHubProvider,
	toProviderModel,
} from "./llm-hub";

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

type SessionStartHandler = (event: unknown, ctx: TestContext) => void;

type TestContext = {
	cwd: string;
	hasUI: boolean;
	ui: {
		notify(message: string, type?: "info" | "warning" | "error"): void;
	};
	modelRegistry: {
		getAll(): TestModel[];
	};
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

const tempDir = async (prefix: string): Promise<string> =>
	mkdtemp(join(tmpdir(), prefix));

const writeSettings = async (
	path: string,
	settings: Record<string, unknown>,
): Promise<void> => {
	await mkdir(path, { recursive: true });
	await writeFile(join(path, "settings.json"), JSON.stringify(settings));
};

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

const createHarness = (models: TestModel[] = [], cwd = "/tmp/project") => {
	const registrations: RegisteredProvider[] = [];
	const notifications: Array<{ message: string; type?: string }> = [];
	const ctx: TestContext = {
		cwd,
		hasUI: true,
		ui: {
			notify(message, type) {
				notifications.push({ message, type });
			},
		},
		modelRegistry: {
			getAll() {
				return models;
			},
		},
	};
	const pi = {
		registerProvider(name: string, config: unknown) {
			registrations.push({ name, config });
		},
	};
	return { ctx, pi, registrations, notifications };
};

describe("llm-hub settings", () => {
	test("defaults providerName to llm-hub when unset or invalid", () => {
		expect(normalizeProviderName(undefined)).toBe("llm-hub");
		expect(normalizeProviderName(" ")).toBe("llm-hub");
		expect(normalizeProviderName("bad provider")).toBe("llm-hub");
		expect(normalizeProviderName(" custom-provider ")).toBe("custom-provider");
	});

	test("normalizes base URL by trimming trailing slashes", () => {
		expect(normalizeBaseUrl(" https://llm-hub.example.com/// ")).toBe(
			"https://llm-hub.example.com",
		);
		expect(normalizeBaseUrl("")).toBeUndefined();
		expect(normalizeBaseUrl("not a url")).toBeUndefined();
	});

	test("reads global settings providerName", async () => {
		const home = await tempDir("llm-hub-home-");
		const cwd = await tempDir("llm-hub-project-");
		await writeSettings(join(home, ".pi", "agent"), {
			"llm-hub": { providerName: "global-hub" },
		});

		await expect(readLlmHubSettings(cwd, home)).resolves.toEqual({
			providerName: "global-hub",
		});
	});

	test("project settings override global settings", async () => {
		const home = await tempDir("llm-hub-home-");
		const cwd = await tempDir("llm-hub-project-");
		await writeSettings(join(home, ".pi", "agent"), {
			"llm-hub": { providerName: "global-hub" },
		});
		await writeSettings(join(cwd, ".pi"), {
			"llm-hub": { providerName: "project-hub" },
		});

		await expect(readLlmHubSettings(cwd, home)).resolves.toEqual({
			providerName: "project-hub",
		});
	});

	test("project and global settings are merged", async () => {
		const home = await tempDir("llm-hub-home-");
		const cwd = await tempDir("llm-hub-project-");
		await writeSettings(join(home, ".pi", "agent"), {
			"llm-hub": { providerName: "global-hub" },
		});
		await writeSettings(join(cwd, ".pi"), {
			"llm-hub": {},
		});

		await expect(readLlmHubSettings(cwd, home)).resolves.toEqual({
			providerName: "global-hub",
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

	test("non-2xx response skips registration", async () => {
		const home = await tempDir("llm-hub-home-");
		const cwd = await tempDir("llm-hub-project-");
		const { fetch } = createFetch([jsonResponse({ error: "nope" }, false)]);
		const { pi, ctx, registrations } = createHarness([], cwd);

		await registerLlmHubProvider(pi, ctx, {
			homeDir: home,
			fetch,
			env: {
				ANTHROPIC_BASE_URL: "https://llm-hub.example.com",
				ANTHROPIC_AUTH_TOKEN: "secret",
			},
		});

		expect(registrations).toEqual([]);
	});

	test("invalid JSON skips registration", async () => {
		const home = await tempDir("llm-hub-home-");
		const cwd = await tempDir("llm-hub-project-");
		const { fetch } = createFetch([invalidJsonResponse()]);
		const { pi, ctx, registrations } = createHarness([], cwd);

		await registerLlmHubProvider(pi, ctx, {
			homeDir: home,
			fetch,
			env: {
				ANTHROPIC_BASE_URL: "https://llm-hub.example.com",
				ANTHROPIC_AUTH_TOKEN: "secret",
			},
		});

		expect(registrations).toEqual([]);
	});

	test("empty model list skips registration", async () => {
		const home = await tempDir("llm-hub-home-");
		const cwd = await tempDir("llm-hub-project-");
		const { fetch } = createFetch([jsonResponse({ data: [] })]);
		const { pi, ctx, registrations } = createHarness([], cwd);

		await registerLlmHubProvider(pi, ctx, {
			homeDir: home,
			fetch,
			env: {
				ANTHROPIC_BASE_URL: "https://llm-hub.example.com",
				ANTHROPIC_AUTH_TOKEN: "secret",
			},
		});

		expect(registrations).toEqual([]);
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

describe("llm-hub registration", () => {
	test("missing env vars skip silently", async () => {
		const home = await tempDir("llm-hub-home-");
		const cwd = await tempDir("llm-hub-project-");
		const { pi, ctx, registrations, notifications } = createHarness([], cwd);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		await registerLlmHubProvider(pi, ctx, { homeDir: home, env: {} });

		expect(registrations).toEqual([]);
		expect(notifications).toEqual([]);
		expect(consoleError).not.toHaveBeenCalled();
		consoleError.mockRestore();
	});

	test("empty env vars skip silently", async () => {
		const home = await tempDir("llm-hub-home-");
		const cwd = await tempDir("llm-hub-project-");
		const { pi, ctx, registrations, notifications } = createHarness([], cwd);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		await registerLlmHubProvider(pi, ctx, {
			homeDir: home,
			env: { ANTHROPIC_BASE_URL: " ", ANTHROPIC_AUTH_TOKEN: "" },
		});

		expect(registrations).toEqual([]);
		expect(notifications).toEqual([]);
		expect(consoleError).not.toHaveBeenCalled();
		consoleError.mockRestore();
	});

	test("known Anthropic model copies metadata", () => {
		const compat = { cacheControlFormat: "anthropic" };
		const thinkingLevelMap = { low: "low", high: "high" };
		const model = toProviderModel(
			{ id: "claude-sonnet-4-5-20250929" },
			makeModel({ compat, thinkingLevelMap }),
		);

		expect(model).toEqual({
			id: "claude-sonnet-4-5-20250929",
			name: "Claude Sonnet 4.5",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
			contextWindow: 200000,
			maxTokens: 64000,
			thinkingLevelMap,
			compat,
		});
	});

	test("unknown model gets fallback metadata", () => {
		expect(toProviderModel({ id: "unknown-model" }, undefined)).toEqual({
			id: "unknown-model",
			name: "unknown-model",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 16384,
		});
	});

	test("provider collision shows error and skips registerProvider", async () => {
		const home = await tempDir("llm-hub-home-");
		const cwd = await tempDir("llm-hub-project-");
		const { pi, ctx, registrations, notifications } = createHarness(
			[makeModel({ provider: "llm-hub" })],
			cwd,
		);
		const { fetch, calls } = createFetch([
			jsonResponse({ data: [{ id: "model-1" }] }),
		]);

		await registerLlmHubProvider(pi, ctx, {
			homeDir: home,
			fetch,
			env: {
				ANTHROPIC_BASE_URL: "https://llm-hub.example.com",
				ANTHROPIC_AUTH_TOKEN: "secret",
			},
		});

		expect(registrations).toEqual([]);
		expect(calls).toEqual([]);
		expect(notifications).toEqual([
			{
				message:
					'llm-hub provider name "llm-hub" already exists; skipping registration.',
				type: "error",
			},
		]);
	});

	test("successful discovery calls registerProvider with expected config", async () => {
		const home = await tempDir("llm-hub-home-");
		const cwd = await tempDir("llm-hub-project-");
		await writeSettings(join(cwd, ".pi"), {
			"llm-hub": { providerName: "corp-hub" },
		});
		const { fetch } = createFetch([
			jsonResponse({ data: [{ id: "claude-sonnet-4-5-20250929" }] }),
		]);
		const { pi, ctx, registrations } = createHarness([makeModel()], cwd);

		await expect(
			registerLlmHubProvider(pi, ctx, {
				homeDir: home,
				fetch,
				env: {
					ANTHROPIC_BASE_URL: "https://llm-hub.example.com/",
					ANTHROPIC_AUTH_TOKEN: " secret ",
				},
			}),
		).resolves.toBe("corp-hub");

		expect(registrations).toEqual([
			{
				name: "corp-hub",
				config: {
					name: "corp-hub",
					baseUrl: "https://llm-hub.example.com",
					apiKey: "ANTHROPIC_AUTH_TOKEN",
					api: "anthropic-messages",
					models: [
						{
							id: "claude-sonnet-4-5-20250929",
							name: "Claude Sonnet 4.5",
							reasoning: true,
							input: ["text", "image"],
							cost: {
								input: 3,
								output: 15,
								cacheRead: 0.3,
								cacheWrite: 3.75,
							},
							contextWindow: 200000,
							maxTokens: 64000,
						},
					],
				},
			},
		]);
	});

	test("default export registers session_start handler", () => {
		const handlers = new Map<string, SessionStartHandler>();
		const pi = {
			on(eventName: "session_start", handler: SessionStartHandler) {
				handlers.set(eventName, handler);
			},
			registerProvider() {
				throw new Error("should not register during extension load");
			},
		};

		llmHub(pi);

		expect(handlers.has("session_start")).toBe(true);
	});

	test("extension handler starts background task without awaiting discovery", async () => {
		const home = await tempDir("llm-hub-home-");
		const cwd = await tempDir("llm-hub-project-");
		let resolveFetch: ((response: FetchResponse) => void) | undefined;
		const calls: FetchCall[] = [];
		const fetch = async (
			url: string,
			init?: FetchInit,
		): Promise<FetchResponse> => {
			calls.push({ url, init });
			return new Promise((resolve) => {
				resolveFetch = resolve;
			});
		};
		const handlers = new Map<string, SessionStartHandler>();
		const registrations: RegisteredProvider[] = [];
		const pi = {
			on(eventName: "session_start", handler: SessionStartHandler) {
				handlers.set(eventName, handler);
			},
			registerProvider(name: string, config: unknown) {
				registrations.push({ name, config });
			},
		};
		const { ctx } = createHarness([], cwd);
		createLlmHubExtension({
			homeDir: home,
			fetch,
			env: {
				ANTHROPIC_BASE_URL: "https://llm-hub.example.com",
				ANTHROPIC_AUTH_TOKEN: "secret",
			},
		})(pi);

		const result = handlers.get("session_start")?.({}, ctx);

		expect(result).toBeUndefined();
		expect(registrations).toEqual([]);
		await vi.waitFor(() => expect(calls).toHaveLength(1));
		resolveFetch?.(jsonResponse({ data: [{ id: "model-1" }] }));
		await vi.waitFor(() => expect(registrations).toHaveLength(1));
	});
});
