import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const googleAuthMock = vi.hoisted(() => {
	type MockGoogleAuthClient = {
		projectId?: string | null;
		quotaProjectId?: string;
		serviceAccountEmail?: string;
		getAccessToken(): Promise<{ token?: string | null }>;
	};
	let jsonContent: Record<string, unknown> | null = null;
	const getClient = vi.fn<() => Promise<MockGoogleAuthClient>>();
	const getProjectId = vi.fn<() => Promise<string>>();
	const construct = vi.fn<(options: unknown) => void>();
	return {
		construct,
		getClient,
		getProjectId,
		get jsonContent() {
			return jsonContent;
		},
		setJsonContent(value: Record<string, unknown> | null) {
			jsonContent = value;
		},
		reset() {
			jsonContent = null;
			getClient.mockReset().mockRejectedValue(new Error("ADC unavailable"));
			getProjectId
				.mockReset()
				.mockRejectedValue(new Error("project unavailable"));
			construct.mockReset();
		},
	};
});

googleAuthMock.reset();

vi.mock("google-auth-library", () => ({
	GoogleAuth: class {
		constructor(options: unknown) {
			googleAuthMock.construct(options);
		}
		get jsonContent(): Record<string, unknown> | null {
			return googleAuthMock.jsonContent;
		}

		getClient() {
			return googleAuthMock.getClient();
		}

		getProjectId() {
			return googleAuthMock.getProjectId();
		}
	},
}));

import type { AuthCredentialLike, ProviderUsageContext } from "./pi-types";

import {
	discoverProviderUsageTargets,
	formatProviderUsage,
	invalidateProviderUsageCache,
	mappedProviderUsageFamily,
	type ProviderUsageTarget,
	refreshProviderUsage,
	renderProviderUsage,
} from "./provider-usage";

const theme = { fg: (_color: string, text: string) => text };
const styledTheme = {
	fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
};
type FetchCall = {
	url: string;
	init: RequestInit;
};

function deferredValue<T>(): {
	promise: Promise<T>;
	resolve(value: T): void;
} {
	let resolve = (_value: T) => {};
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

function fetchCalls(
	handler: (url: string, init: RequestInit) => Response | Promise<Response>,
): { calls: FetchCall[]; fetchMock: ReturnType<typeof vi.fn> } {
	const calls: FetchCall[] = [];
	const fetchMock = vi.fn(
		async (url: string | URL | Request, init?: RequestInit) => {
			const urlText =
				typeof url === "string"
					? url
					: url instanceof URL
						? url.toString()
						: url.url;
			const requestInit = init ?? {};
			calls.push({ url: urlText, init: requestInit });
			return handler(urlText, requestInit);
		},
	);
	vi.stubGlobal("fetch", fetchMock);
	return { calls, fetchMock };
}

function headersRecord(
	headers: HeadersInit | undefined,
): Record<string, string> {
	if (!headers) return {};
	if (headers instanceof Headers) {
		const out: Record<string, string> = {};
		headers.forEach((value, key) => {
			out[key] = value;
		});
		return out;
	}
	if (Array.isArray(headers)) return Object.fromEntries(headers);
	return headers;
}

async function refreshAndWait(
	ctx: ProviderUsageContext,
	targets: ProviderUsageTarget[],
): Promise<void> {
	const onUpdate = vi.fn();
	await refreshProviderUsage(ctx, targets, onUpdate);
}

function render(targets: ProviderUsageTarget[], activeOnly = false): string {
	return renderProviderUsage(targets, theme, activeOnly) ?? "";
}

function renderStyled(
	targets: ProviderUsageTarget[],
	activeOnly = false,
	activeFamilyOverride?: string,
): string {
	return (
		renderProviderUsage(
			targets,
			styledTheme,
			activeOnly,
			(text) => `<model>${text}</model>`,
			activeFamilyOverride,
		) ?? ""
	);
}

function jwtWithPayload(payload: Record<string, unknown>): string {
	const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
		"base64url",
	);
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return `${header}.${body}.signature`;
}

const sharedTestRoot = join(tmpdir(), `pi-provider-usage-test-${process.pid}`);
const sharedTestCachePath = join(sharedTestRoot, "provider-usage.json");
mkdirSync(sharedTestRoot, { recursive: true });
process.env.PI_PROVIDER_USAGE_CACHE_PATH = sharedTestCachePath;
const originalEnv = { ...process.env };

function stubEnv(name: string, value: string): void {
	process.env[name] = value;
}

function llmHubContext({
	baseUrl = "https://llmhub.example.com",
	token = "llmhub-token",
	authenticated = true,
	includeProvider = true,
	active = false,
}: {
	baseUrl?: string;
	token?: string;
	authenticated?: boolean;
	includeProvider?: boolean;
	active?: boolean;
} = {}): ProviderUsageContext {
	const model = {
		id: "claude-sonnet-5",
		provider: "llm-hub",
		baseUrl,
	};
	return {
		model: active && includeProvider ? model : undefined,
		modelRegistry: {
			getAll: () => (includeProvider ? [model] : []),
			getAvailable: () => (includeProvider && authenticated ? [model] : []),
			hasConfiguredAuth: () => authenticated,
			getProvider: (provider) =>
				provider === "llm-hub" && includeProvider
					? { name: "LLM Hub", baseUrl }
					: undefined,
			getProviderAuthStatus: (provider) => ({
				configured: provider === "llm-hub" && includeProvider && authenticated,
				source: "stored",
			}),
			getProviderAuth: async (provider) =>
				provider === "llm-hub" && includeProvider && authenticated
					? { auth: { apiKey: token } }
					: undefined,
			getApiKeyForProvider: async (provider) =>
				provider === "llm-hub" && includeProvider && authenticated
					? token
					: undefined,
		},
		readStoredCredential: (provider) =>
			provider === "llm-hub" && includeProvider && authenticated
				? { type: "api_key" }
				: undefined,
	};
}

afterEach(() => {
	invalidateProviderUsageCache();
	process.env = { ...originalEnv };
	vi.unstubAllGlobals();
	googleAuthMock.reset();
	vi.restoreAllMocks();
});

describe("provider usage", () => {
	test("hydrates credential-scoped usage from a compatible legacy cache", async () => {
		const token = "stored-anthropic-token";
		const targetKey = "anthropic:oauth";
		const fingerprint = createHash("sha256")
			.update(`${targetKey}\0${token}`)
			.digest("hex")
			.slice(0, 16);
		writeFileSync(
			sharedTestCachePath,
			JSON.stringify({
				version: 5,
				entries: {
					[`${targetKey}:${fingerprint}`]: {
						providerId: "anthropic",
						authKind: "oauth",
						state: "ready",
						scope: { sessionPercentUsed: 12, weeklyPercentUsed: 55 },
						lastAttemptAt: Date.now(),
					},
				},
			}),
		);
		const targets: ProviderUsageTarget[] = [
			{ providerId: "anthropic", authKind: "oauth", active: true },
		];
		const ctx: ProviderUsageContext = {
			readStoredCredential: (provider) =>
				provider === "anthropic" ? { type: "oauth", access: token } : undefined,
		};

		await refreshAndWait(ctx, targets);

		expect(formatProviderUsage(targets)).toBe("Anthropic S12%/W55%");
		expect(render(targets)).toBe(formatProviderUsage(targets));
	});

	test("does not reuse cached usage across different credentials", async () => {
		let percentUsed = 10;
		const { fetchMock } = fetchCalls(() =>
			Response.json({ five_hour: { used_percent: percentUsed } }),
		);
		const targets: ProviderUsageTarget[] = [
			{ providerId: "anthropic", authKind: "oauth", active: true },
		];
		const contextForToken = (token: string): ProviderUsageContext => ({
			readStoredCredential: (provider) =>
				provider === "anthropic" ? { type: "oauth", access: token } : undefined,
		});

		await refreshAndWait(contextForToken("first-token"), targets);
		expect(render(targets)).toContain("Anthropic 10%");

		percentUsed = 20;
		await refreshAndWait(contextForToken("second-token"), targets);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(render(targets)).toContain("Anthropic 20%");
	});

	test("uses one resolved credential for both the cache key and request", async () => {
		const credentialReads = ["token-a", "token-b"];
		const { calls, fetchMock } = fetchCalls((_url, init) => {
			const authorization = headersRecord(init.headers).Authorization;
			return Response.json({
				five_hour: {
					used_percent: authorization === "Bearer token-a" ? 10 : 20,
				},
			});
		});
		const targets: ProviderUsageTarget[] = [
			{ providerId: "anthropic", authKind: "oauth", active: true },
		];
		const rotatingCtx: ProviderUsageContext = {
			modelRegistry: {
				async getApiKeyForProvider() {
					return credentialReads.shift() ?? "token-b";
				},
			},
		};

		await refreshAndWait(rotatingCtx, targets);
		await refreshAndWait(
			{
				modelRegistry: {
					async getApiKeyForProvider() {
						return "token-a";
					},
				},
			},
			targets,
		);

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(headersRecord(calls[0].init.headers).Authorization).toBe(
			"Bearer token-a",
		);
		expect(render(targets)).toContain("Anthropic 10%");
	});

	test("does not coalesce concurrent refreshes for different credentials", async () => {
		const { fetchMock } = fetchCalls((_url, init) => {
			const authorization = headersRecord(init.headers).Authorization;
			return Response.json({
				five_hour: {
					used_percent: authorization === "Bearer first-token" ? 10 : 20,
				},
			});
		});
		const targets: ProviderUsageTarget[] = [
			{ providerId: "anthropic", authKind: "oauth", active: true },
		];
		const contextForToken = (token: string): ProviderUsageContext => ({
			readStoredCredential: (provider) =>
				provider === "anthropic" ? { type: "oauth", access: token } : undefined,
		});

		await Promise.all([
			refreshAndWait(contextForToken("first-token"), targets),
			refreshAndWait(contextForToken("second-token"), targets),
		]);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		await refreshAndWait(contextForToken("first-token"), targets);
		await refreshAndWait(contextForToken("second-token"), targets);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test("keeps the latest credential mapping after out-of-order resolution", async () => {
		const firstToken = deferredValue<string | undefined>();
		const secondToken = deferredValue<string | undefined>();
		let credentialRead = 0;
		const { fetchMock } = fetchCalls((_url, init) => {
			const authorization = headersRecord(init.headers).Authorization;
			return Response.json({
				five_hour: {
					used_percent: authorization === "Bearer token-b" ? 20 : 10,
				},
			});
		});
		const ctx: ProviderUsageContext = {
			modelRegistry: {
				getApiKeyForProvider() {
					credentialRead++;
					return credentialRead === 1
						? firstToken.promise
						: secondToken.promise;
				},
			},
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "anthropic", authKind: "oauth", active: true },
		];

		const firstRefresh = refreshProviderUsage(ctx, targets, vi.fn());
		const secondRefresh = refreshProviderUsage(ctx, targets, vi.fn());
		await vi.waitFor(() => expect(credentialRead).toBe(2));
		secondToken.resolve("token-b");
		await secondRefresh;
		firstToken.resolve("token-a");
		await firstRefresh;

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(render(targets)).toContain("Anthropic 20%");
	});
	test("resolves async available models before discovering provider targets", async () => {
		const { fetchMock } = fetchCalls(() =>
			Response.json({ data: { limit_remaining: 8.5 } }),
		);
		const getAvailable = vi.fn(async () => [{ provider: "openrouter" }]);
		const ctx: ProviderUsageContext = {
			modelRegistry: {
				getAvailable,
				async getApiKeyForProvider(provider) {
					return provider === "openrouter" ? "openrouter-token" : undefined;
				},
			},
		};
		const onUpdate = vi.fn();

		expect(discoverProviderUsageTargets(ctx)).toEqual([]);
		refreshProviderUsage(ctx, [], onUpdate);
		await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled());

		const targets = discoverProviderUsageTargets(ctx);
		expect(targets).toEqual([
			{ providerId: "openrouter", authKind: "api_key", active: false },
		]);
		await refreshAndWait(ctx, targets);

		expect(fetchMock).toHaveBeenCalled();
		expect(render(targets)).toContain("OpenRouter $8.50");
	});

	test("falls back from OpenRouter key status to credits", async () => {
		const { calls } = fetchCalls((url) => {
			if (url.endsWith("/key")) return Response.json({ data: {} });
			return Response.json({ data: { total_credits: 10, total_usage: 3.25 } });
		});
		const ctx: ProviderUsageContext = {
			modelRegistry: {
				async getApiKeyForProvider() {
					return "openrouter-token";
				},
			},
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "openrouter", authKind: "api_key", active: true },
		];

		await refreshAndWait(ctx, targets);

		expect(calls.map((call) => call.url)).toEqual([
			"https://openrouter.ai/api/v1/key",
			"https://openrouter.ai/api/v1/credits",
		]);
		expect(headersRecord(calls[0].init.headers)).toMatchObject({
			Authorization: "Bearer openrouter-token",
		});
		expect(render(targets)).toContain("OpenRouter $6.75");
	});

	test("falls back to OpenRouter credits after key status retries fail", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0);
		const { calls } = fetchCalls((url) => {
			if (url.endsWith("/key")) throw new Error("connection reset");
			return Response.json({ data: { total_credits: 10, total_usage: 3.25 } });
		});
		const ctx: ProviderUsageContext = {
			modelRegistry: {
				async getApiKeyForProvider() {
					return "openrouter-token";
				},
			},
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "openrouter", authKind: "api_key", active: false },
		];

		await refreshAndWait(ctx, targets);

		expect(calls.map((call) => call.url)).toEqual([
			"https://openrouter.ai/api/v1/key",
			"https://openrouter.ai/api/v1/key",
			"https://openrouter.ai/api/v1/key",
			"https://openrouter.ai/api/v1/credits",
		]);
		expect(render(targets)).toContain("OpenRouter $6.75");
	});

	test("retries transient provider responses up to the maximum attempts", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0);
		let attempts = 0;
		const { fetchMock } = fetchCalls(() => {
			attempts++;
			return attempts < 3
				? new Response("busy", { status: 503 })
				: Response.json({ five_hour: { used_percent: 10 } });
		});
		const ctx: ProviderUsageContext = {
			modelRegistry: {
				async getApiKeyForProvider() {
					return "anthropic-token";
				},
			},
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "anthropic", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);

		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(render(targets)).toContain("Anthropic 10%");
	});

	test("does not retry non-transient provider responses", async () => {
		const { fetchMock } = fetchCalls(
			() => new Response("unauthorized", { status: 401 }),
		);
		const ctx: ProviderUsageContext = {
			modelRegistry: {
				async getApiKeyForProvider() {
					return "anthropic-token";
				},
			},
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "anthropic", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(render(targets)).toContain("Anthropic ?");
	});

	test("keeps last-known usage visible across failed and empty refreshes", async () => {
		const start = Date.now();
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(start);
		try {
			let responseKind: "ready" | "error" | "unknown" = "ready";
			fetchCalls(() => {
				if (responseKind === "error") {
					return new Response("unauthorized", { status: 401 });
				}
				return responseKind === "ready"
					? Response.json({ five_hour: { used_percent: 42 } })
					: Response.json({});
			});
			const ctx: ProviderUsageContext = {
				readStoredCredential: (provider) =>
					provider === "anthropic"
						? { type: "oauth", access: "stable-anthropic-token" }
						: undefined,
			};
			const targets: ProviderUsageTarget[] = [
				{ providerId: "anthropic", authKind: "oauth", active: true },
			];

			await refreshAndWait(ctx, targets);
			expect(render(targets)).toContain("Anthropic 42%");

			responseKind = "error";
			vi.setSystemTime(start + 5 * 60 * 1000 + 1);
			await refreshAndWait(ctx, targets);
			expect(render(targets)).toContain("Anthropic 42%");

			responseKind = "unknown";
			vi.setSystemTime(start + 6 * 60 * 1000 + 2);
			await refreshAndWait(ctx, targets);
			expect(render(targets)).toContain("Anthropic 42%");
		} finally {
			vi.useRealTimers();
		}
	});
	test("retries unsuccessful usage after the shorter failure TTL", async () => {
		const start = Date.now();
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(start);
		try {
			const { fetchMock } = fetchCalls(
				() => new Response("unauthorized", { status: 401 }),
			);
			const reportError = vi.fn();
			const ctx: ProviderUsageContext = {
				modelRegistry: {
					async getApiKeyForProvider() {
						return "anthropic-token";
					},
				},
				reportError,
			};
			const targets: ProviderUsageTarget[] = [
				{ providerId: "anthropic", authKind: "oauth", active: true },
			];

			await refreshAndWait(ctx, targets);
			await refreshAndWait(ctx, targets);
			expect(fetchMock).toHaveBeenCalledOnce();

			vi.setSystemTime(start + 60_001);
			await refreshAndWait(ctx, targets);

			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(reportError).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	test("honors Retry-After for throttled provider responses", async () => {
		let attempts = 0;
		const { fetchMock } = fetchCalls(() => {
			attempts++;
			return attempts === 1
				? new Response("throttled", {
						status: 429,
						headers: { "Retry-After": "0" },
					})
				: Response.json({ five_hour: { used_percent: 10 } });
		});
		const ctx: ProviderUsageContext = {
			modelRegistry: {
				async getApiKeyForProvider() {
					return "anthropic-token";
				},
			},
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "anthropic", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(render(targets)).toContain("Anthropic 10%");
	});

	test("uses stored Anthropic OAuth access and renders session and weekly percentages", async () => {
		const { calls } = fetchCalls(() =>
			Response.json({
				five_hour: { utilization: 12.4 },
				seven_day: { used_percent: 48 },
				seven_day_opus: { used_percentage: 55.2 },
			}),
		);
		const getApiKeyForProvider = vi.fn(async () => "provider-token");
		const ctx: ProviderUsageContext = {
			modelRegistry: { getApiKeyForProvider },
			readStoredCredential: (provider) =>
				provider === "anthropic"
					? { type: "oauth", access: "stored-anthropic-token" }
					: undefined,
		};
		const targets = discoverProviderUsageTargets(ctx);

		expect(targets).toEqual([
			{ providerId: "anthropic", authKind: "oauth", active: false },
		]);
		await refreshAndWait(ctx, targets);

		expect(getApiKeyForProvider).not.toHaveBeenCalled();
		expect(headersRecord(calls[0].init.headers)).toMatchObject({
			Authorization: "Bearer stored-anthropic-token",
		});
		expect(render(targets)).toContain("Anthropic S12%/W55%");
	});

	test("uses OpenAI Codex JWT account header and renders credit balance", async () => {
		const token = jwtWithPayload({
			"https://api.openai.com/auth": { chatgpt_account_id: "account-123" },
		});
		const { calls } = fetchCalls(() =>
			Response.json({ credits: { has_credits: true, balance: 4.5 } }),
		);
		const ctx: ProviderUsageContext = {
			modelRegistry: {
				async getApiKeyForProvider() {
					return undefined;
				},
			},
			readStoredCredential: (provider) =>
				provider === "openai-codex"
					? { type: "oauth", access: token }
					: undefined,
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "openai-codex", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);

		expect(headersRecord(calls[0].init.headers)).toMatchObject({
			Authorization: `Bearer ${token}`,
			"chatgpt-account-id": "account-123",
		});
		expect(render(targets)).toContain("OpenAI $4.50");
	});

	test("classifies a seven-day OpenAI primary window as weekly usage", async () => {
		const token = jwtWithPayload({
			"https://api.openai.com/auth": { chatgpt_account_id: "account-123" },
		});
		fetchCalls(() =>
			Response.json({
				rate_limit: {
					primary_window: {
						used_percent: 12,
						limit_window_seconds: 7 * 24 * 60 * 60,
					},
					secondary_window: null,
				},
			}),
		);
		const ctx: ProviderUsageContext = {
			readStoredCredential: (provider) =>
				provider === "openai-codex"
					? { type: "oauth", access: token }
					: undefined,
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "openai-codex", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);

		expect(render(targets)).toContain("OpenAI 12%");
		expect(render(targets)).not.toContain("W12%");
		expect(render(targets)).not.toContain("S12%");
	});

	test("labels both OpenAI usage windows when both are returned", async () => {
		const token = jwtWithPayload({
			"https://api.openai.com/auth": { chatgpt_account_id: "account-123" },
		});
		fetchCalls(() =>
			Response.json({
				rate_limit: {
					primary_window: {
						used_percent: 12,
						limit_window_seconds: 5 * 60 * 60,
					},
					secondary_window: {
						used_percent: 48,
						limit_window_seconds: 7 * 24 * 60 * 60,
					},
				},
			}),
		);
		const ctx: ProviderUsageContext = {
			readStoredCredential: (provider) =>
				provider === "openai-codex"
					? { type: "oauth", access: token }
					: undefined,
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "openai-codex", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);

		expect(render(targets)).toContain("OpenAI S12%/W48%");
	});

	test("parses Google stored OAuth JSON token and quota buckets", async () => {
		const { calls } = fetchCalls(() =>
			Response.json({
				buckets: [{ remainingFraction: 0.25 }, { usedPercent: 60 }],
			}),
		);
		const ctx: ProviderUsageContext = {
			modelRegistry: {
				async getApiKeyForProvider() {
					return undefined;
				},
			},
			readStoredCredential: (provider) =>
				provider === "google-gemini-cli" || provider === "google-antigravity"
					? {
							type: "oauth",
							access: JSON.stringify({
								token: "google-token",
								projectId: "project-1",
							}),
						}
					: undefined,
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "google-gemini-cli", authKind: "oauth", active: true },
			{ providerId: "google-antigravity", authKind: "oauth", active: false },
		];

		await refreshAndWait(ctx, targets);

		expect(headersRecord(calls[0].init.headers)).toMatchObject({
			Authorization: "Bearer google-token",
		});
		expect(calls[0].init.body).toBe(JSON.stringify({ project: "project-1" }));
		expect(render(targets)).toBe("󰊭 75% · 󰊭 75%");
	});

	test("does not render persisted Vertex usage before resolving its credential", () => {
		const targetKey = "google-vertex:oauth";
		writeFileSync(
			sharedTestCachePath,
			JSON.stringify({
				version: 9,
				entries: {
					[`${targetKey}:unrelated-credential`]: {
						providerId: "google-vertex",
						authKind: "oauth",
						state: "ready",
						scope: { percentUsed: 99 },
						lastAttemptAt: Date.now(),
					},
				},
			}),
		);
		const targets: ProviderUsageTarget[] = [
			{ providerId: "google-vertex", authKind: "oauth", active: true },
		];

		expect(render(targets)).toContain("󰊭 ?");
		expect(render(targets)).not.toContain("99%");
	});

	test("redraws after resolving a fresh persisted Vertex cache entry", async () => {
		const targetKey = "google-vertex:oauth";
		const token = "persisted-vertex-token";
		const projectId = "persisted-vertex-project";
		const fingerprint = createHash("sha256")
			.update(
				`${targetKey}\0${projectId}\0\0${token}\0monitoring-sequential-v2`,
			)
			.digest("hex")
			.slice(0, 16);
		writeFileSync(
			sharedTestCachePath,
			JSON.stringify({
				version: 9,
				entries: {
					[`${targetKey}:${fingerprint}`]: {
						providerId: "google-vertex",
						authKind: "oauth",
						state: "ready",
						scope: { percentUsed: 33 },
						lastAttemptAt: Date.now(),
					},
				},
			}),
		);
		const ctx: ProviderUsageContext = {
			readStoredCredential: (provider) =>
				provider === "google-vertex"
					? {
							type: "oauth",
							access: JSON.stringify({ token, projectId }),
						}
					: undefined,
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "google-vertex", authKind: "oauth", active: true },
		];
		const onUpdate = vi.fn();

		expect(render(targets)).toContain("󰊭 ?");
		await refreshProviderUsage(ctx, targets, onUpdate);

		expect(onUpdate).toHaveBeenCalledOnce();
		expect(render(targets)).toBe("󰊭 33%");
	});
	test("delegates external-account ADC resolution to GoogleAuth", async () => {
		delete process.env.GOOGLE_CLOUD_API_KEY;
		delete process.env.GOOGLE_CLOUD_PROJECT;
		delete process.env.GCLOUD_PROJECT;
		delete process.env.CLOUDSDK_CORE_PROJECT;
		googleAuthMock.setJsonContent({
			type: "external_account",
			audience: "test-workload-identity-pool",
		});
		googleAuthMock.getProjectId.mockResolvedValue("external-account-project");
		const getAccessToken = vi
			.fn<() => Promise<{ token: string }>>()
			.mockResolvedValueOnce({ token: "external-token-a" })
			.mockResolvedValue({ token: "external-token-b" });
		googleAuthMock.getClient.mockResolvedValue({ getAccessToken });
		const { calls, fetchMock } = fetchCalls(() =>
			Response.json({ buckets: [{ remainingFraction: 0.6 }] }),
		);
		const targets: ProviderUsageTarget[] = [
			{ providerId: "google-vertex", authKind: "api_key", active: true },
		];

		await refreshAndWait({}, targets);
		await refreshAndWait({}, targets);

		expect(googleAuthMock.getClient).toHaveBeenCalledTimes(2);
		expect(getAccessToken).toHaveBeenCalledTimes(2);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(
			calls.map((call) => headersRecord(call.init.headers).Authorization),
		).toEqual(["Bearer external-token-a", "Bearer external-token-b"]);
		expect(calls[0].init.body).toBe(
			JSON.stringify({ project: "external-account-project" }),
		);
		expect(render(targets)).toBe("󰊭 40%");
	});

	test("scopes Vertex OAuth cache entries by project", async () => {
		stubEnv("GOOGLE_CLOUD_PROJECT", "vertex-project-a");
		const { calls, fetchMock } = fetchCalls((_url, init) => {
			const body = JSON.parse(String(init.body));
			return Response.json({
				buckets: [
					{
						remainingFraction: body.project === "vertex-project-a" ? 0.9 : 0.8,
					},
				],
			});
		});
		const ctx: ProviderUsageContext = {
			readStoredCredential: (provider) =>
				provider === "google-vertex"
					? { type: "oauth", access: "shared-vertex-token" }
					: undefined,
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "google-vertex", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);
		stubEnv("GOOGLE_CLOUD_PROJECT", "vertex-project-b");
		await refreshAndWait(ctx, targets);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(calls.map((call) => call.init.body)).toEqual([
			JSON.stringify({ project: "vertex-project-a" }),
			JSON.stringify({ project: "vertex-project-b" }),
		]);
		expect(render(targets)).toBe("󰊭 20%");
	});
	test("discovers Google Vertex target and uses ADC / environment project", async () => {
		stubEnv("GOOGLE_CLOUD_PROJECT", "test-project-vertex");
		stubEnv("GOOGLE_CLOUD_API_KEY", "ignored-vertex-api-key");
		googleAuthMock.setJsonContent({
			type: "authorized_user",
			refresh_token: "test-refresh-token",
		});
		googleAuthMock.getClient.mockResolvedValue({
			getAccessToken: async () => ({ token: "test-adc-token" }),
		});
		const { calls } = fetchCalls((url) => {
			if (url.includes("cloudcode-pa.googleapis.com")) {
				return new Response("disabled", { status: 403 });
			}
			const filter = new URL(url).searchParams.get("filter") ?? "";
			if (filter.includes("quota/exceeded")) {
				return Response.json({ timeSeries: [] });
			}
			return Response.json({
				timeSeries: [
					{
						points: [
							{
								value: {
									int64Value: filter.includes("quota/limit") ? "200" : "15",
								},
							},
						],
					},
				],
			});
		});
		const ctx: ProviderUsageContext = {
			model: { id: "gemini-3.7-flash", provider: "google-vertex" },
			modelRegistry: {
				getAvailable() {
					return [{ provider: "google-vertex" }];
				},
				async getApiKeyForProvider() {
					return undefined;
				},
				getProviderAuthStatus(provider) {
					return {
						configured: provider === "google-vertex",
						source: "environment",
					};
				},
			},
		};

		const targets = discoverProviderUsageTargets(ctx);
		expect(targets).toEqual([
			{ providerId: "google-vertex", authKind: "api_key", active: true },
		]);

		await refreshAndWait(ctx, targets);

		const monitoringCall = calls.find((c) =>
			c.url.includes("monitoring.googleapis.com"),
		);
		expect(monitoringCall).toBeDefined();
		expect(monitoringCall?.url).toContain(
			"https://monitoring.googleapis.com/v3/projects/test-project-vertex/timeSeries",
		);
		expect(headersRecord(monitoringCall?.init.headers)).toMatchObject({
			Authorization: "Bearer test-adc-token",
			"X-Goog-User-Project": "test-project-vertex",
		});
		expect(render(targets)).toContain("󰊭 8%");
		expect(renderStyled(targets)).toBe("<model>󰊭 8%</model>");
	});

	test("uses auth.json provider environment for Vertex without ambient Google env", async () => {
		for (const name of [
			"GOOGLE_APPLICATION_CREDENTIALS",
			"GOOGLE_CLOUD_API_KEY",
			"GOOGLE_CLOUD_LOCATION",
			"GOOGLE_CLOUD_PROJECT",
			"GOOGLE_CLOUD_QUOTA_PROJECT",
			"GCLOUD_PROJECT",
		]) {
			delete process.env[name];
		}
		googleAuthMock.setJsonContent({
			type: "authorized_user",
			refresh_token: "stored-adc-refresh-token",
		});
		googleAuthMock.getClient.mockResolvedValue({
			quotaProjectId: "stored-billing-project",
			getAccessToken: async () => ({ token: "stored-adc-access-token" }),
		});
		const { calls } = fetchCalls(() =>
			Response.json({ buckets: [{ remainingFraction: 0.7 }] }),
		);
		const ctx: ProviderUsageContext = {
			modelRegistry: {
				getProviderAuthStatus(provider) {
					return {
						configured: provider === "google-vertex",
						source: "stored",
					};
				},
				async getProviderAuth(provider) {
					return provider === "google-vertex"
						? {
								auth: {},
								env: {
									GOOGLE_CLOUD_PROJECT: "stored-vertex-project",
									GOOGLE_CLOUD_LOCATION: "stored-vertex-location",
								},
							}
						: undefined;
				},
			},
		};
		const targets = discoverProviderUsageTargets(ctx);
		expect(targets).toEqual([
			{ providerId: "google-vertex", authKind: "api_key", active: false },
		]);

		await refreshAndWait(ctx, targets);

		expect(googleAuthMock.construct).toHaveBeenCalledWith(
			expect.objectContaining({
				projectId: "stored-vertex-project",
				keyFilename: undefined,
			}),
		);
		expect(calls[0].init.body).toBe(
			JSON.stringify({ project: "stored-vertex-project" }),
		);
		expect(headersRecord(calls[0].init.headers)).toMatchObject({
			Authorization: "Bearer stored-adc-access-token",
			"X-Goog-User-Project": "stored-billing-project",
		});
		expect(render(targets)).toBe("󰊭 30%");
	});

	test("bounds Google ADC discovery latency", async () => {
		delete process.env.GOOGLE_CLOUD_PROJECT;
		delete process.env.GCLOUD_PROJECT;
		delete process.env.CLOUDSDK_CORE_PROJECT;
		vi.useFakeTimers();
		try {
			googleAuthMock.getClient.mockReturnValue(
				new Promise(() => {
					// Intentionally unresolved to exercise the outer credential timeout.
				}),
			);
			const targets: ProviderUsageTarget[] = [
				{ providerId: "google-vertex", authKind: "api_key", active: true },
			];
			const refresh = refreshProviderUsage({}, targets, vi.fn());

			await vi.advanceTimersByTimeAsync(5_001);
			vi.useRealTimers();
			await refresh;

			expect(render(targets)).toBe("󰊭 ?");
		} finally {
			vi.useRealTimers();
		}
	});
	test("falls back from Cloud Code PA to Cloud Monitoring for Google Vertex", async () => {
		stubEnv("GOOGLE_CLOUD_PROJECT", "test-vertex-gcp");
		const { calls } = fetchCalls((url) => {
			if (url.includes("cloudcode-pa.googleapis.com")) {
				return new Response(
					JSON.stringify({ error: { code: 403, message: "Disabled" } }),
					{ status: 403 },
				);
			}
			if (url.includes("monitoring.googleapis.com")) {
				const filter = new URL(url).searchParams.get("filter") ?? "";
				if (filter.includes("quota/exceeded")) {
					return Response.json({ timeSeries: [] });
				}
				return Response.json({
					timeSeries: [
						{
							points: [
								{
									value: {
										int64Value: filter.includes("quota/limit") ? "200" : "40",
									},
								},
							],
						},
					],
				});
			}
			return new Response("Not found", { status: 404 });
		});

		const ctx: ProviderUsageContext = {
			readStoredCredential: (provider) =>
				provider === "google-vertex"
					? {
							type: "oauth",
							access: JSON.stringify({
								token: "vertex-oauth-token",
								projectId: "test-vertex-gcp",
							}),
						}
					: undefined,
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "google-vertex", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);

		expect(calls.map((c) => c.url)).toEqual([
			"https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota",
			expect.stringContaining(
				"https://monitoring.googleapis.com/v3/projects/test-vertex-gcp/timeSeries",
			),
			expect.stringContaining(
				"https://monitoring.googleapis.com/v3/projects/test-vertex-gcp/timeSeries",
			),
		]);
		expect(render(targets)).toBe("󰊭 20%");
	});

	test("queries stable Vertex Monitoring metrics without a concurrent burst", async () => {
		stubEnv("GOOGLE_CLOUD_PROJECT", "test-vertex-priority");
		stubEnv("GOOGLE_CLOUD_QUOTA_PROJECT", "test-vertex-billing");
		const { calls } = fetchCalls((url) => {
			if (url.includes("cloudcode-pa.googleapis.com")) {
				return new Response("disabled", { status: 403 });
			}
			const filter = new URL(url).searchParams.get("filter") ?? "";
			if (filter.includes("quota/exceeded")) {
				return Response.json({ timeSeries: [] });
			}
			if (filter.includes("api/request_count")) {
				return Response.json({
					timeSeries: [
						{
							points: [
								{
									interval: { startTime: "2026-08-19T18:00:00Z" },
									value: { int64Value: "40" },
								},
							],
						},
					],
				});
			}
			return new Response("unexpected quota query", { status: 500 });
		});
		const ctx: ProviderUsageContext = {
			readStoredCredential: (provider) =>
				provider === "google-vertex"
					? {
							type: "oauth",
							access: JSON.stringify({
								token: "priority-vertex-token",
								projectId: "test-vertex-priority",
							}),
						}
					: undefined,
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "google-vertex", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);

		const monitoringCalls = calls.filter((call) =>
			call.url.includes("monitoring.googleapis.com"),
		);
		expect(monitoringCalls).toHaveLength(2);
		const urls = monitoringCalls.map((call) => new URL(call.url));
		expect(urls.map((url) => url.searchParams.get("filter"))).toEqual([
			expect.stringContaining("quota/exceeded"),
			expect.stringContaining("api/request_count"),
		]);
		expect(
			new Set(urls.map((url) => url.searchParams.get("interval.startTime")))
				.size,
		).toBe(1);
		expect(
			new Set(urls.map((url) => url.searchParams.get("interval.endTime"))).size,
		).toBe(1);
		for (const call of monitoringCalls) {
			expect(headersRecord(call.init.headers)).toMatchObject({
				Authorization: "Bearer priority-vertex-token",
				"X-Goog-User-Project": "test-vertex-billing",
			});
		}
		expect(render(targets)).toBe("󰊭 20%");
	});

	test("treats successful empty Monitoring responses as zero usage", async () => {
		const { calls } = fetchCalls((url) =>
			url.includes("cloudcode-pa.googleapis.com")
				? new Response("disabled", { status: 403 })
				: Response.json({}),
		);
		const ctx: ProviderUsageContext = {
			readStoredCredential: (provider) =>
				provider === "google-vertex"
					? {
							type: "oauth",
							access: JSON.stringify({
								token: "empty-monitoring-token",
								projectId: "empty-monitoring-project",
							}),
						}
					: undefined,
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "google-vertex", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);

		expect(
			calls.filter((call) => call.url.includes("monitoring.googleapis.com")),
		).toHaveLength(2);
		expect(render(targets)).toBe("󰊭 0%");
	});
	test("falls back to request-count usage when quota metrics are unavailable", async () => {
		vi.spyOn(Math, "random").mockReturnValue(0);
		stubEnv("GOOGLE_CLOUD_PROJECT", "test-vertex-partial");
		fetchCalls((url) => {
			if (url.includes("cloudcode-pa.googleapis.com")) {
				return new Response("disabled", { status: 403 });
			}
			const filter = new URL(url).searchParams.get("filter") ?? "";
			if (filter.includes("api/request_count")) {
				return Response.json({
					timeSeries: [
						{
							points: [
								{
									interval: { startTime: "2026-08-19T18:00:00Z" },
									value: { int64Value: "14" },
								},
							],
						},
					],
				});
			}
			throw new Error("quota metrics unavailable");
		});
		const ctx: ProviderUsageContext = {
			readStoredCredential: (provider) =>
				provider === "google-vertex"
					? {
							type: "oauth",
							access: JSON.stringify({
								token: "partial-vertex-token",
								projectId: "test-vertex-partial",
							}),
						}
					: undefined,
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "google-vertex", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);

		expect(render(targets)).toBe("󰊭 7%");
	});

	test("reports 100% when Cloud Monitoring reports quota exceeded for Google Vertex", async () => {
		stubEnv("GOOGLE_CLOUD_PROJECT", "test-vertex-exceeded");
		fetchCalls((url) => {
			if (url.includes("cloudcode-pa.googleapis.com")) {
				return new Response("disabled", { status: 403 });
			}
			if (url.includes("quota%2Fexceeded")) {
				return Response.json({
					timeSeries: [
						{
							metric: {
								type: "serviceruntime.googleapis.com/quota/exceeded",
							},
							points: [{ value: { int64Value: "3" } }],
						},
					],
				});
			}
			return Response.json({ timeSeries: [] });
		});

		const ctx: ProviderUsageContext = {
			readStoredCredential: (provider) =>
				provider === "google-vertex"
					? {
							type: "oauth",
							access: JSON.stringify({
								token: "vertex-token",
								projectId: "test-vertex-exceeded",
							}),
						}
					: undefined,
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "google-vertex", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);
		expect(render(targets)).toBe("󰊭 100%");
	});

	test("renders unknown active provider usage for non-OK and throwing responses", async () => {
		fetchCalls(() => new Response("nope", { status: 500 }));
		const openRouterCtx: ProviderUsageContext = {
			modelRegistry: {
				async getApiKeyForProvider() {
					return "openrouter-token";
				},
			},
		};
		const openRouterTargets: ProviderUsageTarget[] = [
			{ providerId: "openrouter", authKind: "api_key", active: true },
		];

		await refreshAndWait(openRouterCtx, openRouterTargets);
		expect(render(openRouterTargets)).toContain("OpenRouter ?");
		expect(renderStyled(openRouterTargets)).toBe("<model>OpenRouter ?</model>");

		invalidateProviderUsageCache();
		fetchCalls(() => {
			throw new Error("network down");
		});
		const anthropicCtx: ProviderUsageContext = {
			modelRegistry: {
				async getApiKeyForProvider() {
					return "anthropic-token";
				},
			},
		};
		const anthropicTargets: ProviderUsageTarget[] = [
			{ providerId: "anthropic", authKind: "oauth", active: true },
		];

		await refreshAndWait(anthropicCtx, anthropicTargets);
		expect(render(anthropicTargets)).toContain("Anthropic ?");
		expect(renderStyled(anthropicTargets)).toBe("<model>Anthropic ?</model>");
	});

	test("renders multiple provider badges and filters active-only output", async () => {
		fetchCalls((url) => {
			if (url.includes("openrouter")) {
				return Response.json({ data: { limit_remaining: 2.5 } });
			}
			return Response.json({ five_hour: { used_percent: 10 } });
		});
		const ctx: ProviderUsageContext = {
			modelRegistry: {
				async getApiKeyForProvider(provider) {
					return `${provider}-token`;
				},
			},
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "openrouter", authKind: "api_key", active: false },
			{ providerId: "anthropic", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);

		expect(formatProviderUsage(targets)).toBe(
			"OpenRouter $2.50 · Anthropic 10%",
		);
		expect(render(targets)).toBe("OpenRouter $2.50 · Anthropic 10%");
		expect(render(targets, true)).toBe("Anthropic 10%");
		expect(renderStyled(targets)).toBe(
			"<dim>OpenRouter $2.50</dim><dim> · </dim><model>Anthropic 10%</model>",
		);
		expect(renderStyled(targets, true)).toBe("<model>Anthropic 10%</model>");

		const noActiveTargets = targets.map((target) => ({
			...target,
			active: false,
		}));
		expect(renderStyled(noActiveTargets)).toBe(
			"<dim>OpenRouter $2.50</dim><dim> · </dim><dim>Anthropic 10%</dim>",
		);
	});

	test("orders provider targets consistently regardless of active provider", () => {
		const credentials = new Map<string, AuthCredentialLike>([
			["openrouter", { type: "api_key" }],
			["anthropic", { type: "oauth", access: "anthropic-token" }],
			["openai", { type: "api_key" }],
			["github-copilot", { type: "oauth", access: "copilot-token" }],
			["litellm", { type: "api_key" }],
			["google-gemini-cli", { type: "oauth", access: "google-token" }],
			["llm-hub", { type: "api_key" }],
		]);
		const llmHubModel = {
			id: "claude-sonnet-5",
			provider: "llm-hub",
			baseUrl: "https://llmhub.example.com",
		};
		const ctx: ProviderUsageContext = {
			model: { id: "openrouter/model", provider: "openrouter" },
			modelRegistry: {
				getAll: () => [llmHubModel],
				getAvailable: () => [llmHubModel],
				getProviderAuthStatus: (provider) => ({
					configured: provider === "llm-hub",
				}),
			},
			readStoredCredential: (provider) => credentials.get(provider),
		};

		expect(
			discoverProviderUsageTargets(ctx).map((target) => target.providerId),
		).toEqual([
			"llm-hub",
			"github-copilot",
			"openai",
			"openrouter",
			"anthropic",
			"google-gemini-cli",
		]);
	});

	test("uses GitHub Copilot refresh token instead of access token for usage endpoint", async () => {
		const { calls } = fetchCalls(() =>
			Response.json({
				quotaSnapshots: {
					premiumInteractions: { percent_used: 30 },
				},
			}),
		);
		const ctx: ProviderUsageContext = {
			modelRegistry: {
				async getApiKeyForProvider() {
					return "fallback-token";
				},
			},
			readStoredCredential: (provider) =>
				provider === "github-copilot"
					? {
							type: "oauth",
							access: "copilot-session-token",
							refresh: "github-oauth-token",
						}
					: undefined,
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "github-copilot", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);

		expect(headersRecord(calls[0].init.headers)).toMatchObject({
			Authorization: "token github-oauth-token",
		});
		expect(render(targets)).toContain(" 30%");
	});

	test("falls back to getApiKeyForProvider when GitHub Copilot has no refresh token", async () => {
		const { calls } = fetchCalls(() =>
			Response.json({
				quotaSnapshots: {
					premiumInteractions: { percent_used: 50 },
				},
			}),
		);
		const ctx: ProviderUsageContext = {
			modelRegistry: {
				async getApiKeyForProvider(provider) {
					return provider === "github-copilot"
						? "fallback-api-token"
						: undefined;
				},
			},
			readStoredCredential: (provider) =>
				provider === "github-copilot"
					? {
							type: "oauth",
							access: "copilot-session-token",
						}
					: undefined,
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "github-copilot", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);

		expect(headersRecord(calls[0].init.headers)).toMatchObject({
			Authorization: "token fallback-api-token",
		});
		expect(render(targets)).toContain(" 50%");
	});

	test("discovers an authenticated static LLM Hub provider from Pi", () => {
		const targets = discoverProviderUsageTargets(llmHubContext());

		expect(targets).toEqual([
			{ providerId: "llm-hub", authKind: "api_key", active: false },
		]);
	});

	test("uses Pi-resolved LLM Hub endpoint and authorization", async () => {
		const { calls } = fetchCalls(() =>
			Response.json({ info: { spend: 123.456 } }),
		);
		const ctx = llmHubContext({
			baseUrl: "https://llmhub.example.com/",
			token: "pi-resolved-token",
		});
		const targets = discoverProviderUsageTargets(ctx);

		await refreshAndWait(ctx, targets);

		expect(calls.map((call) => call.url)).toEqual([
			"https://llmhub.example.com/key/info",
		]);
		expect(headersRecord(calls[0].init.headers)).toMatchObject({
			Authorization: "Bearer pi-resolved-token",
		});
		expect(render(targets)).toBe("LLMHub $123.46");
	});

	test("scopes LLM Hub usage by both Pi base URL and token", async () => {
		const { calls, fetchMock } = fetchCalls((url, init) => {
			const authorization = headersRecord(init.headers).Authorization;
			const spend = url.includes("second-llmhub")
				? 30
				: authorization === "Bearer second-token"
					? 20
					: 10;
			return Response.json({ info: { spend } });
		});
		const contexts = [
			llmHubContext({
				baseUrl: "https://first-llmhub.example.com",
				token: "first-token",
			}),
			llmHubContext({
				baseUrl: "https://first-llmhub.example.com",
				token: "second-token",
			}),
			llmHubContext({
				baseUrl: "https://second-llmhub.example.com",
				token: "second-token",
			}),
		];

		for (const ctx of contexts) {
			await refreshAndWait(ctx, discoverProviderUsageTargets(ctx));
		}

		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(calls.map((call) => call.url)).toEqual([
			"https://first-llmhub.example.com/key/info",
			"https://first-llmhub.example.com/key/info",
			"https://second-llmhub.example.com/key/info",
		]);
	});

	test("parses LLMHub spend from budget exceeded responses", async () => {
		fetchCalls(() =>
			Response.json(
				{
					error: {
						type: "budget_exceeded",
						message:
							"Budget has been exceeded! Current cost: 322.29367038, Max budget: 320.0",
					},
				},
				{ status: 400 },
			),
		);
		const ctx = llmHubContext();
		const targets = discoverProviderUsageTargets(ctx);

		await refreshAndWait(ctx, targets);

		expect(render(targets)).toBe("LLMHub $322.29");
	});

	test("does not discover LLM Hub when the Pi provider is absent", () => {
		const ctx = llmHubContext({ includeProvider: false });
		ctx.readStoredCredential = (provider) =>
			provider === "llm-hub" ? { type: "api_key" } : undefined;

		expect(discoverProviderUsageTargets(ctx)).toEqual([]);
	});

	test("does not discover LLM Hub without configured Pi authentication", () => {
		expect(
			discoverProviderUsageTargets(llmHubContext({ authenticated: false })),
		).toEqual([]);
	});

	test("maps only exact ChatGPT and OpenAI LiteLLM route segments", () => {
		for (const id of ["chatgpt/gpt-5.6-sol", " OpenAI/gpt-5 "]) {
			expect(mappedProviderUsageFamily({ provider: "LiteLLM", id })).toBe(
				"openai",
			);
		}

		for (const id of [
			"openrouter/openai/gpt-5",
			"my-chatgpt/gpt-5",
			"gpt-5.6-sol",
			undefined,
		]) {
			expect(
				mappedProviderUsageFamily({ provider: "litellm", id }),
			).toBeUndefined();
		}
		expect(
			mappedProviderUsageFamily({
				provider: "llm-hub",
				id: "chatgpt/gpt-5.6-sol",
			}),
		).toBeUndefined();
	});

	test("activates the resolved OpenAI family badge only while rendering", () => {
		const ctx: ProviderUsageContext = {
			model: { provider: "litellm", id: "chatgpt/gpt-5.6-sol" },
			modelRegistry: { getAvailable: () => [] },
			readStoredCredential(provider) {
				if (provider === "openai-codex") {
					return { type: "oauth", access: "codex-token" };
				}
				return provider === "openai" ? { type: "api_key" } : undefined;
			},
		};
		const targets = discoverProviderUsageTargets(ctx);
		const activeFamily = mappedProviderUsageFamily(ctx.model);

		expect(targets).toEqual([
			{ providerId: "openai-codex", authKind: "oauth", active: false },
		]);
		expect(formatProviderUsage(targets)).toBeUndefined();
		expect(renderStyled(targets, false, activeFamily)).toBe(
			"<model>OpenAI ?</model>",
		);
		expect(renderStyled(targets, true, activeFamily)).toBe(
			"<model>OpenAI ?</model>",
		);
	});

	test("does not fabricate an OpenAI target for mapped LiteLLM models", () => {
		const ctx: ProviderUsageContext = {
			model: { provider: "litellm", id: "openai/gpt-5" },
			modelRegistry: { getAvailable: () => [] },
			readStoredCredential(provider) {
				return provider === "anthropic"
					? { type: "oauth", access: "anthropic-token" }
					: undefined;
			},
		};
		const targets = discoverProviderUsageTargets(ctx);
		const activeFamily = mappedProviderUsageFamily(ctx.model);

		expect(targets).toEqual([
			{ providerId: "anthropic", authKind: "oauth", active: false },
		]);
		expect(renderStyled(targets, false, activeFamily)).toBe("");
		expect(renderStyled(targets, true, activeFamily)).toBe("");
	});

	test("highlights mapped OpenAI unknown usage after a fetch failure", async () => {
		fetchCalls(() => new Response("unauthorized", { status: 401 }));
		const ctx: ProviderUsageContext = {
			model: { provider: "litellm", id: "chatgpt/gpt-5.6-sol" },
			modelRegistry: { getAvailable: () => [] },
			readStoredCredential(provider) {
				return provider === "openai-codex"
					? { type: "oauth", access: "codex-token" }
					: undefined;
			},
		};
		const targets = discoverProviderUsageTargets(ctx);

		await refreshAndWait(ctx, targets);

		expect(formatProviderUsage(targets)).toBeUndefined();
		expect(
			renderStyled(targets, false, mappedProviderUsageFamily(ctx.model)),
		).toBe("<model>OpenAI ?</model>");
	});

	test("ignores LiteLLM providers for usage discovery", async () => {
		stubEnv("LITELLM_BASE_URL", "http://localhost:4000");
		const { fetchMock } = fetchCalls(() => Response.json({}));
		const ctx: ProviderUsageContext = {
			model: { id: "openrouter/z-ai/glm-5.2", provider: "litellm" },
			modelRegistry: {
				getAvailable() {
					return [{ provider: "litellm", baseUrl: "http://localhost:4000/v1" }];
				},
				async getApiKeyForProvider(provider) {
					return provider === "litellm" ? "litellm-key" : undefined;
				},
				getProviderAuthStatus(provider) {
					return { configured: provider === "litellm", source: "environment" };
				},
			},
			readStoredCredential(provider) {
				return provider === "litellm" ? { type: "api_key" } : undefined;
			},
		};

		const targets = discoverProviderUsageTargets(ctx);
		expect(targets).toEqual([]);
		await refreshProviderUsage(ctx, targets, vi.fn());

		expect(fetchMock).not.toHaveBeenCalled();
		expect(render(targets)).toBe("");
	});
});
