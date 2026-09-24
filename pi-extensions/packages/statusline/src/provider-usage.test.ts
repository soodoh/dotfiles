import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
const OPENAI_LOGO = "\u{F0004}";
const OPENROUTER_LOGO = "\u{F0469}";
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

beforeEach(() => {
	delete process.env.CLIPROXYAPI_MANAGEMENT_KEY;
});

afterEach(() => {
	invalidateProviderUsageCache();
	process.env = { ...originalEnv };
	vi.unstubAllGlobals();
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

	test("refreshes legacy OpenAI cache entries for reset details", async () => {
		const token = jwtWithPayload({
			"https://api.openai.com/auth": { chatgpt_account_id: "account-123" },
		});
		const targetKey = "openai-codex:oauth";
		const fingerprint = createHash("sha256")
			.update(`${targetKey}\0${token}`)
			.digest("hex")
			.slice(0, 16);
		writeFileSync(
			sharedTestCachePath,
			JSON.stringify({
				version: 9,
				entries: {
					[`${targetKey}:${fingerprint}`]: {
						providerId: "openai-codex",
						authKind: "oauth",
						state: "ready",
						scope: { weeklyPercentUsed: 94 },
						lastAttemptAt: Date.now(),
					},
				},
			}),
		);
		const resetAt = new Date(2030, 8, 6).getTime();
		const { fetchMock } = fetchCalls((url) =>
			url.endsWith("/rate-limit-reset-credits")
				? Response.json({ available_count: 3 })
				: Response.json({
						rate_limit: {
							primary_window: {
								used_percent: 95,
								limit_window_seconds: 7 * 24 * 60 * 60,
								reset_at: resetAt / 1000,
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

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(render(targets)).toContain(
			`${OPENAI_LOGO} 95% (${Math.ceil((resetAt - Date.now()) / 86_400_000)}d ↻3)`,
		);
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
		expect(render(targets)).toContain(`${OPENROUTER_LOGO} $8.50`);
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
		expect(render(targets)).toContain(`${OPENROUTER_LOGO} $6.75`);
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
		expect(render(targets)).toContain(`${OPENROUTER_LOGO} $6.75`);
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
			expect(render(targets)).toContain("Anthropic 42% !");

			responseKind = "unknown";
			vi.setSystemTime(start + 6 * 60 * 1000 + 2);
			await refreshAndWait(ctx, targets);
			expect(render(targets)).toContain("Anthropic 42% !");

			vi.setSystemTime(start + 15 * 60 * 1000 + 1);
			expect(render(targets)).toContain("Anthropic ?");
			expect(render([{ ...targets[0], active: false }])).toBe("");
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
		expect(render(targets)).toContain(`${OPENAI_LOGO} $4.50`);
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

		expect(render(targets)).toContain(`${OPENAI_LOGO} 12%`);
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

		expect(render(targets)).toContain(`${OPENAI_LOGO} S12%/W48%`);
	});

	test("formats an OpenAI reset date and available reset credits", async () => {
		const token = jwtWithPayload({
			"https://api.openai.com/auth": { chatgpt_account_id: "account-123" },
		});
		const sessionResetAt = new Date(2030, 8, 6, 15).getTime();
		let availableResets = 3;
		const { calls } = fetchCalls((url) =>
			url.endsWith("/rate-limit-reset-credits")
				? Response.json({ available_count: availableResets })
				: Response.json({
						rate_limit: {
							primary_window: {
								used_percent: 93,
								limit_window_seconds: 5 * 60 * 60,
								reset_at: sessionResetAt / 1000,
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

		expect(calls.map(({ url }) => url)).toEqual([
			"https://chatgpt.com/backend-api/wham/usage",
			"https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
		]);
		expect(headersRecord(calls[1].init.headers)).toMatchObject({
			Authorization: `Bearer ${token}`,
			"chatgpt-account-id": "account-123",
			"OpenAI-Beta": "codex-1",
			originator: "Codex Desktop",
		});
		expect(render(targets)).toContain(
			`${OPENAI_LOGO} 93% (${Math.ceil((sessionResetAt - Date.now()) / 86_400_000)}d ↻3)`,
		);

		availableResets = 0;
		invalidateProviderUsageCache();
		await refreshAndWait(ctx, targets);

		expect(render(targets)).toContain(
			`${OPENAI_LOGO} 93% (${Math.ceil((sessionResetAt - Date.now()) / 86_400_000)}d)`,
		);
		expect(render(targets)).not.toContain("↻");
		expect(render(targets)).not.toContain(" · ");
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
		expect(render(openRouterTargets)).toContain(`${OPENROUTER_LOGO} ?`);
		expect(renderStyled(openRouterTargets)).toBe(
			`<model>${OPENROUTER_LOGO} ?</model>`,
		);

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
			`${OPENROUTER_LOGO} $2.50 · Anthropic 10%`,
		);
		expect(render(targets)).toBe(`${OPENROUTER_LOGO} $2.50 · Anthropic 10%`);
		expect(render(targets, true)).toBe("Anthropic 10%");
		expect(renderStyled(targets)).toBe(
			`<dim>${OPENROUTER_LOGO} $2.50</dim><dim> · </dim><model>Anthropic 10%</model>`,
		);
		expect(renderStyled(targets, true)).toBe("<model>Anthropic 10%</model>");

		const noActiveTargets = targets.map((target) => ({
			...target,
			active: false,
		}));
		expect(renderStyled(noActiveTargets)).toBe(
			`<dim>${OPENROUTER_LOGO} $2.50</dim><dim> · </dim><dim>Anthropic 10%</dim>`,
		);
	});

	test("omits unsupported providers from discovery, refresh, and rendering", async () => {
		const unsupportedModel = {
			id: "gemini-model",
			provider: "google-vertex",
		};
		const ctx: ProviderUsageContext = {
			model: unsupportedModel,
			modelRegistry: {
				getAvailable: () => [unsupportedModel],
				isUsingOAuth: () => true,
			},
			readStoredCredential: (provider) =>
				provider === "google-vertex"
					? { type: "oauth", access: "unused-token" }
					: undefined,
		};
		const unsupportedTargets: ProviderUsageTarget[] = [
			{ providerId: "google-vertex", authKind: "oauth", active: true },
		];
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		expect(discoverProviderUsageTargets(ctx)).toEqual([]);
		await refreshAndWait(ctx, unsupportedTargets);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(render(unsupportedTargets)).toBe("");
	});

	test("orders provider targets consistently regardless of active provider", () => {
		const credentials = new Map<string, AuthCredentialLike>([
			["openrouter", { type: "api_key" }],
			["anthropic", { type: "oauth", access: "anthropic-token" }],
			["openai", { type: "api_key" }],
			["github-copilot", { type: "oauth", access: "copilot-token" }],
			["litellm", { type: "api_key" }],
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
			`<model>${OPENAI_LOGO} ?</model>`,
		);
		expect(renderStyled(targets, true, activeFamily)).toBe(
			`<model>${OPENAI_LOGO} ?</model>`,
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
		).toBe(`<model>${OPENAI_LOGO} ?</model>`);
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
