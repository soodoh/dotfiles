import { afterEach, describe, expect, test, vi } from "vitest";
import type { ProviderUsageContext } from "./pi-types";

import {
	discoverProviderUsageTargets,
	invalidateProviderUsageCache,
	type ProviderUsageTarget,
	refreshProviderUsage,
	renderProviderUsage,
} from "./provider-usage";

const theme = { fg: (_color: string, text: string) => text };
type FetchCall = {
	url: string;
	init: RequestInit;
};

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
	refreshProviderUsage(ctx, targets, onUpdate);
	await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled());
}

function render(targets: ProviderUsageTarget[], activeOnly = false): string {
	return renderProviderUsage(targets, theme, activeOnly) ?? "";
}

function jwtWithPayload(payload: Record<string, unknown>): string {
	const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
		"base64url",
	);
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return `${header}.${body}.signature`;
}

const originalEnv = { ...process.env };

function stubEnv(name: string, value: string): void {
	process.env[name] = value;
}

afterEach(() => {
	invalidateProviderUsageCache();
	process.env = { ...originalEnv };
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("provider usage", () => {
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
		expect(render(targets)).toContain("OR $8.50");
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
		expect(render(targets)).toContain("OR $6.75");
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
			modelRegistry: {
				getApiKeyForProvider,
				authStorage: {
					list: () => ["anthropic"],
					get: (provider) =>
						provider === "anthropic"
							? { type: "oauth", access: "stored-anthropic-token" }
							: undefined,
				},
			},
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
		expect(render(targets)).toContain("Anth S12%/W55%");
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
				authStorage: {
					get: (provider) =>
						provider === "openai-codex"
							? { type: "oauth", access: token }
							: undefined,
				},
			},
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "openai-codex", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);

		expect(headersRecord(calls[0].init.headers)).toMatchObject({
			Authorization: `Bearer ${token}`,
			"chatgpt-account-id": "account-123",
		});
		expect(render(targets)).toContain("OAI $4.50");
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
			modelRegistry: {
				authStorage: {
					get: (provider) =>
						provider === "openai-codex"
							? { type: "oauth", access: token }
							: undefined,
				},
			},
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "openai-codex", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);

		expect(render(targets)).toContain("OAI W12%");
		expect(render(targets)).not.toContain("S12%");
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
				authStorage: {
					get: (provider) =>
						provider === "google-gemini-cli"
							? {
									type: "oauth",
									access: JSON.stringify({
										token: "google-token",
										projectId: "project-1",
									}),
								}
							: undefined,
				},
			},
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "google-gemini-cli", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);

		expect(headersRecord(calls[0].init.headers)).toMatchObject({
			Authorization: "Bearer google-token",
		});
		expect(calls[0].init.body).toBe(JSON.stringify({ project: "project-1" }));
		expect(render(targets)).toContain("Gem 75%");
	});

	test("omits Google Vertex from provider usage targets", () => {
		const ctx: ProviderUsageContext = {
			model: { id: "gemini-3.1-pro-preview", provider: "google-vertex" },
			modelRegistry: {
				getAvailable() {
					return [{ provider: "google-vertex" }];
				},
				async getApiKeyForProvider() {
					return "vertex-token";
				},
			},
		};

		expect(discoverProviderUsageTargets(ctx)).toEqual([]);
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
		expect(render(openRouterTargets)).toContain("OR ?");

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
		expect(render(anthropicTargets)).toContain("Anth ?");
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

		expect(render(targets)).toBe("OR $2.50 · Anth S10%");
		expect(render(targets, true)).toBe("Anth S10%");
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
				authStorage: {
					get: (provider) =>
						provider === "github-copilot"
							? {
									type: "oauth",
									access: "copilot-session-token",
									refresh: "github-oauth-token",
								}
							: undefined,
				},
			},
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "github-copilot", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);

		expect(headersRecord(calls[0].init.headers)).toMatchObject({
			Authorization: "token github-oauth-token",
		});
		expect(render(targets)).toContain("GH M30%");
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
				authStorage: {
					get: (provider) =>
						provider === "github-copilot"
							? {
									type: "oauth",
									access: "copilot-session-token",
								}
							: undefined,
				},
			},
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "github-copilot", authKind: "oauth", active: true },
		];

		await refreshAndWait(ctx, targets);

		expect(headersRecord(calls[0].init.headers)).toMatchObject({
			Authorization: "token fallback-api-token",
		});
		expect(render(targets)).toContain("GH M50%");
	});

	test("fetches LiteLLM proxied OpenRouter and ChatGPT usage via passthrough endpoints", async () => {
		stubEnv("LITELLM_BASE_URL", "http://localhost:4000");
		const { calls } = fetchCalls((url) => {
			if (url.endsWith("/chatgpt/usage")) {
				return Response.json({
					rate_limit: {
						primary_window: { used_percent: 25 },
						secondary_window: { used_percent: 50 },
					},
				});
			}
			return Response.json({ data: { total_credits: 10, total_usage: 1.25 } });
		});
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
		};

		const targets = discoverProviderUsageTargets(ctx);
		expect(targets).toEqual([
			{ providerId: "litellm", authKind: "api_key", active: true },
		]);
		await refreshAndWait(ctx, targets);

		expect(calls.map((call) => call.url)).toEqual([
			"http://localhost:4000/openrouter/credits",
			"http://localhost:4000/chatgpt/usage",
		]);
		expect(headersRecord(calls[0].init.headers)).toMatchObject({
			Authorization: "Bearer litellm-key",
		});
		expect(headersRecord(calls[1].init.headers)).toMatchObject({
			Authorization: "Bearer litellm-key",
		});
		expect(render(targets)).toContain("OR $8.75 · OAI S25%/W50%");
	});

	test("derives LiteLLM base url from model baseUrl when env is unset", async () => {
		stubEnv("LITELLM_BASE_URL", "");
		const { calls } = fetchCalls(() =>
			Response.json({ data: { total_credits: 5, total_usage: 0 } }),
		);
		const ctx: ProviderUsageContext = {
			model: { id: "m", provider: "litellm" },
			modelRegistry: {
				getAvailable() {
					return [
						{ provider: "litellm", baseUrl: "https://litellm.example.com/v1/" },
					];
				},
				async getApiKeyForProvider() {
					return "litellm-key";
				},
				getProviderAuthStatus(provider) {
					return { configured: provider === "litellm" };
				},
			},
		};

		const targets = discoverProviderUsageTargets(ctx);
		await refreshAndWait(ctx, targets);

		expect(calls.map((call) => call.url)).toEqual([
			"https://litellm.example.com/openrouter/credits",
			"https://litellm.example.com/chatgpt/usage",
		]);
		expect(render(targets)).toContain("OR $5.00");
	});

	test("surfaces non-active LiteLLM when configured even without models", () => {
		const ctx: ProviderUsageContext = {
			model: { id: "claude", provider: "anthropic" },
			modelRegistry: {
				getAvailable() {
					return [{ provider: "anthropic" }];
				},
				isUsingOAuth() {
					return true;
				},
				getProviderAuthStatus(provider) {
					return { configured: provider === "litellm" };
				},
				async getApiKeyForProvider() {
					return undefined;
				},
			},
		};

		const litellm = discoverProviderUsageTargets(ctx).find(
			(target) => target.providerId === "litellm",
		);
		expect(litellm).toEqual({
			providerId: "litellm",
			authKind: "api_key",
			active: false,
		});
	});
});
