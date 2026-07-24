import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ProviderUsageContext } from "./pi-types";

import {
	discoverProviderUsageTargets,
	formatProviderUsage,
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
	await refreshProviderUsage(ctx, targets, onUpdate);
	expect(onUpdate).toHaveBeenCalled();
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

const sharedTestRoot = join(tmpdir(), `pi-provider-usage-test-${process.pid}`);
const sharedTestCachePath = join(sharedTestRoot, "provider-usage.json");
const claudeConfigDir = join(sharedTestRoot, "claude");
mkdirSync(claudeConfigDir, { recursive: true });
process.env.PI_PROVIDER_USAGE_CACHE_PATH = sharedTestCachePath;
process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
const originalEnv = { ...process.env };

function stubEnv(name: string, value: string): void {
	process.env[name] = value;
}

function writeClaudeSettings(env: Record<string, string>): void {
	writeFileSync(
		join(claudeConfigDir, "settings.json"),
		JSON.stringify({ env }),
	);
}

afterEach(() => {
	invalidateProviderUsageCache();
	process.env = { ...originalEnv };
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("provider usage", () => {
	test("hydrates formatted usage from the shared persistent cache", () => {
		writeFileSync(
			sharedTestCachePath,
			JSON.stringify({
				version: 4,
				entries: {
					"anthropic:oauth": {
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

		expect(formatProviderUsage(targets)).toBe("Anthropic S12%/W55%");
		expect(render(targets)).toBe(formatProviderUsage(targets));
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
		expect(render(openRouterTargets)).toContain("OpenRouter ?");

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

		expect(render(targets)).toBe("OpenRouter $2.50 · Anthropic 10%");
		expect(render(targets, true)).toBe("Anthropic 10%");
	});

	test("orders provider targets consistently regardless of active provider", () => {
		writeClaudeSettings({
			ANTHROPIC_BASE_URL: "https://llmhub.example.com",
			ANTHROPIC_AUTH_TOKEN: "llmhub-token",
		});
		const credentials = new Map([
			["openrouter", { type: "api_key" as const }],
			["anthropic", { type: "oauth" as const, access: "anthropic-token" }],
			["openai", { type: "api_key" as const }],
			["github-copilot", { type: "oauth" as const, access: "copilot-token" }],
			["litellm", { type: "api_key" as const }],
			["google-gemini-cli", { type: "oauth" as const, access: "google-token" }],
		]);
		const ctx: ProviderUsageContext = {
			model: { id: "openrouter/model", provider: "openrouter" },
			readStoredCredential: (provider) => credentials.get(provider),
		};

		expect(
			discoverProviderUsageTargets(ctx).map((target) => target.providerId),
		).toEqual([
			"llmhub",
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

	test("discovers LLMHub spend from Claude settings without Pi auth", async () => {
		writeClaudeSettings({
			ANTHROPIC_BASE_URL: "https://llmhub.example.com/",
			ANTHROPIC_AUTH_TOKEN: "llmhub-token",
		});
		const { calls } = fetchCalls(() =>
			Response.json({ info: { spend: 123.456 } }),
		);
		const ctx: ProviderUsageContext = {};

		const targets = discoverProviderUsageTargets(ctx);
		expect(targets).toEqual([
			{ providerId: "llmhub", authKind: "api_key", active: false },
		]);
		await refreshAndWait(ctx, targets);

		expect(calls.map((call) => call.url)).toEqual([
			"https://llmhub.example.com/key/info",
		]);
		expect(headersRecord(calls[0].init.headers)).toMatchObject({
			Authorization: "Bearer llmhub-token",
		});
		expect(render(targets)).toBe("LLMHub $123.46");
	});

	test("falls back to ANTHROPIC_API_KEY for LLMHub spend", async () => {
		writeClaudeSettings({
			ANTHROPIC_BASE_URL: "https://llmhub.example.com",
			ANTHROPIC_API_KEY: "llmhub-api-key",
		});
		const { calls } = fetchCalls(() => Response.json({ info: { spend: 10 } }));
		const ctx: ProviderUsageContext = {};
		const targets = discoverProviderUsageTargets(ctx);

		await refreshAndWait(ctx, targets);

		expect(headersRecord(calls[0].init.headers)).toMatchObject({
			Authorization: "Bearer llmhub-api-key",
		});
	});

	test("parses LLMHub spend from budget exceeded responses", async () => {
		writeClaudeSettings({
			ANTHROPIC_BASE_URL: "https://llmhub.example.com",
			ANTHROPIC_AUTH_TOKEN: "llmhub-token",
		});
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
		const ctx: ProviderUsageContext = {};
		const targets = discoverProviderUsageTargets(ctx);

		await refreshAndWait(ctx, targets);

		expect(render(targets)).toBe("LLMHub $322.29");
	});

	test("does not discover LLMHub when Claude settings are missing credentials", () => {
		writeClaudeSettings({ ANTHROPIC_BASE_URL: "https://llmhub.example.com" });

		expect(discoverProviderUsageTargets({})).toEqual([]);
	});

	test("ignores LiteLLM providers for usage discovery", async () => {
		stubEnv("LITELLM_BASE_URL", "http://localhost:4000");
		writeClaudeSettings({});
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
