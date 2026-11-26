import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
	type AuthCredentialLike,
	createProviderUsageStore,
	mappedProviderUsageFamily,
	type ProviderUsageContext,
	type ProviderUsageStore,
	type ProviderUsageTarget,
} from "./provider-usage";
import { formatProviderScope, parseOpenAiUsageBody } from "./usage-quota";

let store: ProviderUsageStore = createProviderUsageStore();
const discoverProviderUsageTargetsAsync = (ctx: ProviderUsageContext) =>
	store.discoverTargetsAsync(ctx);
const refreshProviderUsage: ProviderUsageStore["refresh"] = (...args) =>
	store.refresh(...args);
const renderProviderUsage: ProviderUsageStore["render"] = (...args) =>
	store.render(...args);
const cachedProviderPercentUsed: ProviderUsageStore["cachedPercentUsed"] = (
	...args
) => store.cachedPercentUsed(...args);
const providerUsageCopilot = (targets: ProviderUsageTarget[]) =>
	store.cliSnapshot(targets).copilot;

function resetStore(clearDisk = true): void {
	store = createProviderUsageStore();
	if (clearDisk) {
		rmSync(process.env.PI_PROVIDER_USAGE_CACHE_PATH ?? sharedTestCachePath, {
			force: true,
		});
	}
}

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
	resetStore();
	delete process.env.CLIPROXYAPI_MANAGEMENT_KEY;
});

afterEach(() => {
	resetStore();
	// Preserve the native env object: Node 26 child processes inherit from it.
	for (const key of Object.keys(process.env)) {
		if (!(key in originalEnv)) delete process.env[key];
	}
	Object.assign(process.env, originalEnv);
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("provider usage", () => {
	test.each(["openai", "openai-codex"])(
		"keeps %s as the usage target when both OAuth logins exist",
		async (providerId) => {
			const ctx: ProviderUsageContext = {
				model: { provider: providerId },
				readStoredCredential: (provider) =>
					["openai", "openai-codex"].includes(provider)
						? { type: "oauth", access: `${provider}-token` }
						: undefined,
			};
			expect(await discoverProviderUsageTargetsAsync(ctx)).toEqual([
				{ providerId, authKind: "oauth", active: true },
			]);
		},
	);

	test("native OAuth with no proxy stays unavailable rather than probing legacy endpoints", async () => {
		const { fetchMock } = fetchCalls(() => Response.json({}));
		const ctx: ProviderUsageContext = {
			model: { provider: "openai" },
			modelRegistry: {
				getProviderAuth: async () => ({ auth: { apiKey: "native-token" } }),
			},
			readStoredCredential: (provider) =>
				provider === "openai"
					? {
							type: "oauth",
							access: "native-token",
							clientId: "oaiapp_native",
							scopes: ["chatgpt.tokens.use.direct"],
						}
					: undefined,
		};
		const targets = await discoverProviderUsageTargetsAsync(ctx);
		await refreshAndWait(ctx, targets);
		expect(render(targets)).toBe(`${OPENAI_LOGO} ?`);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("hydrates fresh credential-scoped usage without fetching", async () => {
		const token = "stored-anthropic-token";
		const targetKey = "anthropic:oauth";
		const fingerprint = createHash("sha256")
			.update(`${targetKey}\0${token}`)
			.digest("hex")
			.slice(0, 16);
		writeFileSync(
			sharedTestCachePath,
			JSON.stringify({
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

		const { fetchMock } = fetchCalls(() => Response.json({}));
		await refreshAndWait(ctx, targets);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(renderProviderUsage(targets, theme, false)).toBe(
			"Anthropic S12%/W55%",
		);
		expect(render(targets)).toBe("Anthropic S12%/W55%");
	});

	test.each([0, 6])(
		"refreshes cached OpenAI usage only when its TTL expires (age: %s minutes)",
		async (ageMinutes) => {
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
					entries: {
						[`${targetKey}:${fingerprint}`]: {
							providerId: "openai-codex",
							authKind: "oauth",
							state: "ready",
							scope: { weeklyPercentUsed: 94 },
							lastAttemptAt: Date.now() - ageMinutes * 60_000,
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

			if (ageMinutes === 0) {
				expect(fetchMock).not.toHaveBeenCalled();
				expect(render(targets)).toBe(`${OPENAI_LOGO} 94%`);
			} else {
				expect(fetchMock).toHaveBeenCalledTimes(2);
				expect(render(targets)).toContain(
					`${OPENAI_LOGO} 95% (${Math.ceil((resetAt - Date.now()) / 86_400_000)}d ↻3)`,
				);
			}
		},
	);

	test.each(["{", "null", '{"entries":[]}', '{"entries":{"invalid":null}}'])(
		"refetches usage when the disk cache is malformed: %s",
		async (cache) => {
			writeFileSync(sharedTestCachePath, cache);
			const { fetchMock } = fetchCalls(() =>
				Response.json({ five_hour: { used_percent: 25 } }),
			);
			const targets: ProviderUsageTarget[] = [
				{ providerId: "anthropic", authKind: "oauth", active: true },
			];
			await refreshAndWait(
				{
					readStoredCredential: () => ({
						type: "oauth",
						access: "cache-repair-token",
					}),
				},
				targets,
			);
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(render(targets)).toBe("Anthropic 25%");
		},
	);

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
		const targets = await discoverProviderUsageTargetsAsync(ctx);
		expect(getAvailable).toHaveBeenCalledOnce();
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

	test("keeps routine refreshes quiet but warns if a pending refresh outlasts the grace period", async () => {
		const start = Date.now();
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(start);
		const started = deferredValue<void>();
		const response = deferredValue<Response>();
		let attempts = 0;
		fetchCalls(() => {
			if (++attempts === 1)
				return Response.json({ five_hour: { used_percent: 42 } });
			started.resolve();
			return response.promise;
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
		let refreshing: Promise<void> | undefined;
		try {
			await refreshAndWait(ctx, targets);
			vi.setSystemTime(start + 5 * 60_000 + 1);
			expect(render(targets)).toBe("Anthropic 42%");
			refreshing = refreshAndWait(ctx, targets);
			await started.promise;
			expect(render(targets)).toBe("Anthropic 42%");

			vi.setSystemTime(start + 8 * 60_000 + 1);
			expect(render(targets)).toBe("Anthropic 42% !");
			response.resolve(Response.json({ five_hour: { used_percent: 43 } }));
			await refreshing;
			expect(render(targets)).toBe("Anthropic 43%");
			// Both fetchedAt and lastAttemptAt reflect completion time, not when the slow request started.
			vi.setSystemTime(start + 12 * 60_000);
			await refreshAndWait(ctx, targets);
			expect(attempts).toBe(2);
		} finally {
			response.resolve(Response.json({ five_hour: { used_percent: 43 } }));
			await refreshing;
			vi.useRealTimers();
		}
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
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		vi.spyOn(Math, "random").mockReturnValue(0);
		const firstAttempt = deferredValue<void>();
		let attempts = 0;
		const { fetchMock } = fetchCalls(() => {
			attempts++;
			if (attempts === 1) {
				firstAttempt.resolve();
				return new Response("throttled", {
					status: 429,
					headers: { "Retry-After": "2" },
				});
			}
			return Response.json({ five_hour: { used_percent: 10 } });
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

		try {
			const refreshing = refreshAndWait(ctx, targets);
			await firstAttempt.promise;
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(fetchMock).toHaveBeenCalledOnce();
			await vi.advanceTimersByTimeAsync(1_999);
			expect(fetchMock).toHaveBeenCalledOnce();
			await vi.advanceTimersByTimeAsync(1);
			await refreshing;
			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect(render(targets)).toContain("Anthropic 10%");
		} finally {
			vi.useRealTimers();
		}
	});

	test("refreshes native Anthropic OAuth access before polling session and weekly percentages", async () => {
		const { calls } = fetchCalls(() =>
			Response.json({
				five_hour: { utilization: 12.4 },
				seven_day: { used_percent: 48 },
				seven_day_opus: { used_percentage: 55.2 },
			}),
		);
		const getProviderAuth = vi.fn(async () => ({
			auth: { apiKey: "refreshed-anthropic-token" },
		}));
		const ctx: ProviderUsageContext = {
			modelRegistry: { getProviderAuth },
			readStoredCredential: (provider) =>
				provider === "anthropic"
					? { type: "oauth", access: "stored-anthropic-token" }
					: undefined,
		};
		const targets = await discoverProviderUsageTargetsAsync(ctx);

		expect(targets).toEqual([
			{ providerId: "anthropic", authKind: "oauth", active: false },
		]);
		await refreshAndWait(ctx, targets);

		expect(getProviderAuth).toHaveBeenCalledWith("anthropic");
		expect(headersRecord(calls[0].init.headers)).toMatchObject({
			Authorization: "Bearer refreshed-anthropic-token",
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

	test.each([28, 29, 30, 31])(
		"preserves a %s-day Codex quota as monthly, including zero usage and its reset",
		(days) => {
			const resetAt = Math.floor(Date.now() / 1000) + days * 86400;
			expect(
				parseOpenAiUsageBody({
					rate_limit: {
						primary_window: {
							used_percent: 0,
							limit_window_seconds: days * 86400,
							reset_at: resetAt,
						},
						secondary_window: null,
					},
				}),
			).toMatchObject({
				monthlyPercentUsed: 0,
				monthlyResetAt: resetAt * 1000,
			});
		},
	);

	test.each([86400, 14 * 86400, 90 * 86400])(
		"preserves an unfamiliar %s-second Codex window without inventing a period",
		(seconds) => {
			const parsed = parseOpenAiUsageBody({
				rate_limit: {
					primary_window: {
						used_percent: 23,
						limit_window_seconds: seconds,
						reset_at: 2_000_000_000,
					},
				},
			});
			expect(parsed).toMatchObject({
				percentUsed: 23,
				windowSeconds: seconds,
				resetAt: 2_000_000_000_000,
			});
			expect(parsed?.sessionPercentUsed).toBeUndefined();
			expect(parsed?.weeklyPercentUsed).toBeUndefined();
		},
	);

	test.each([30, 14])(
		"fetches, persists, and hydrates a direct Codex %s-day quota with its countdown",
		async (days) => {
			const token = jwtWithPayload({
				"https://api.openai.com/auth": { chatgpt_account_id: "free-account" },
			});
			const resetAt = Math.floor(Date.now() / 1000) + days * 86400;
			const expected = `${OPENAI_LOGO} ${days === 30 ? "" : `${days}d `}0% (${days}d)`;
			const { fetchMock } = fetchCalls((url) =>
				url.endsWith("/usage")
					? Response.json({
							rate_limit: {
								primary_window: {
									used_percent: 0,
									limit_window_seconds: days * 86400,
									reset_at: resetAt,
								},
								secondary_window: null,
							},
						})
					: Response.json({ available_count: 0 }),
			);
			const ctx: ProviderUsageContext = {
				readStoredCredential: () => ({ type: "oauth", access: token }),
			};
			const targets: ProviderUsageTarget[] = [
				{ providerId: "openai-codex", authKind: "oauth", active: true },
			];
			await refreshAndWait(ctx, targets);
			expect(render(targets)).toBe(expected);
			const cached = readFileSync(sharedTestCachePath, "utf8");
			const entry = Object.values(JSON.parse(cached).entries)[0] as {
				scope: unknown;
			};
			expect(entry.scope).toMatchObject(
				days === 30
					? { monthlyPercentUsed: 0, monthlyResetAt: resetAt * 1000 }
					: {
							percentUsed: 0,
							windowSeconds: days * 86400,
							resetAt: resetAt * 1000,
						},
			);
			resetStore(false);
			writeFileSync(sharedTestCachePath, cached);
			fetchMock.mockClear();
			await refreshAndWait(ctx, targets);
			expect(fetchMock).not.toHaveBeenCalled();
			expect(render(targets)).toBe(expected);
		},
	);

	test("formats shared monthly and unclassified quotas without displaying expired windows", () => {
		const now = Date.now();
		expect(
			formatProviderScope({
				sessionPercentUsed: 12,
				monthlyPercentUsed: 0,
				monthlyResetAt: now + 30 * 86400000,
			}),
		).toBe("S12%/M0% (30d)");
		expect(
			formatProviderScope({ monthlyPercentUsed: 99, monthlyResetAt: now - 1 }),
		).toBeUndefined();
		expect(
			formatProviderScope({
				percentUsed: 0,
				resetAt: now + 3600000,
				windowSeconds: 3600,
			}),
		).toBe("1h 0% (1h)");
		expect(
			formatProviderScope({
				percentUsed: 99,
				resetAt: now - 1,
				windowSeconds: 14 * 86400,
			}),
		).toBeUndefined();
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
		resetStore();
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

		resetStore();
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

		expect(renderProviderUsage(targets, theme, false)).toBe(
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

		expect(await discoverProviderUsageTargetsAsync(ctx)).toEqual([]);
		await refreshAndWait(ctx, unsupportedTargets);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(render(unsupportedTargets)).toBe("");
	});

	test("orders provider targets consistently regardless of active provider", async () => {
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
			(await discoverProviderUsageTargetsAsync(ctx)).map(
				(target) => target.providerId,
			),
		).toEqual([
			"llm-hub",
			"github-copilot",
			"openai",
			"openrouter",
			"anthropic",
		]);
	});

	test("persists Copilot details for the CLI without changing the compact badge or retaining identity", async () => {
		const { fetchMock } = fetchCalls(() =>
			Response.json({
				copilot_plan: "business",
				login: "private-login",
				organization_list: ["private-org"],
				token: "private-response-token",
				token_based_billing: true,
				quota_reset_date_utc: "2035-02-01T00:00:00Z",
				quota_snapshots: {
					premium_interactions: {
						entitlement: 1000,
						quota_remaining: 749.25,
						remaining: 749,
						percent_remaining: 75,
						credits_used: 9000,
						overage_permitted: true,
						overage_count: 0,
					},
				},
			}),
		);
		const ctx: ProviderUsageContext = {
			readStoredCredential: () => ({
				type: "oauth",
				refresh: "private-github-token",
			}),
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "github-copilot", authKind: "oauth", active: true },
		];
		await refreshAndWait(ctx, targets);
		expect(render(targets)).toBe(" 25%");
		const account = providerUsageCopilot(targets);
		expect(account).toMatchObject({
			summary: "25%",
			state: "ready",
			stale: false,
			details: {
				plan: "Business",
				premium: {
					unit: "credits",
					allowance: 1000,
					used: 250.75,
					remaining: 749.25,
					overagePermitted: true,
					overageUsed: 0,
				},
			},
		});
		const cache = readFileSync(sharedTestCachePath, "utf8");
		expect(cache).not.toContain("private-");
		expect(JSON.stringify(account)).not.toContain("private-");
		resetStore(false);
		writeFileSync(sharedTestCachePath, cache);
		fetchMock.mockClear();
		await refreshAndWait(ctx, targets);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(providerUsageCopilot(targets)).toEqual(account);
	});

	test.each(["missing", "error"])(
		"Copilot %s refresh retains the original observation only until expiry",
		async (failure) => {
			let now = Date.now();
			vi.spyOn(Date, "now").mockImplementation(() => now);
			let failed = false;
			fetchCalls(() => {
				if (!failed)
					return Response.json({
						copilot_plan: "pro",
						token_based_billing: false,
						quota_snapshots: {
							premium_interactions: {
								percent_remaining: 100,
								remaining: 300,
								entitlement: 300,
							},
						},
					});
				if (failure === "error") throw new Error("Network unavailable");
				return Response.json({});
			});
			const ctx: ProviderUsageContext = {
				readStoredCredential: () => ({
					type: "oauth",
					refresh: "github-token",
				}),
			};
			const targets: ProviderUsageTarget[] = [
				{ providerId: "github-copilot", authKind: "oauth", active: false },
			];
			await refreshAndWait(ctx, targets);
			const original = providerUsageCopilot(targets);
			failed = true;
			now += 7 * 60_000;
			await refreshAndWait(ctx, targets);
			expect(providerUsageCopilot(targets)).toMatchObject({
				summary: "0%",
				state: failure === "error" ? "error" : "unknown",
				stale: true,
				fetchedAt: original?.fetchedAt,
				lastAttemptAt: now,
				details: original?.details,
			});
			expect(render(targets)).toBe(" 0% !");
			now += 9 * 60_000;
			expect(providerUsageCopilot(targets)).toMatchObject({ summary: "?" });
			expect(providerUsageCopilot(targets)?.details).toBeUndefined();
		},
	);

	test("Copilot details cannot cross credentials or survive logout", async () => {
		let token = "first-token";
		fetchCalls(() =>
			token === "first-token"
				? Response.json({
						copilot_plan: "enterprise",
						quota_snapshots: {
							premium_interactions: { percent_remaining: 80 },
						},
					})
				: new Response(null, { status: 403 }),
		);
		const ctx: ProviderUsageContext = {
			readStoredCredential: () => ({ type: "oauth", refresh: token }),
		};
		const targets: ProviderUsageTarget[] = [
			{ providerId: "github-copilot", authKind: "oauth", active: false },
		];
		await refreshAndWait(ctx, targets);
		expect(providerUsageCopilot(targets)?.details?.plan).toBe("Enterprise");
		token = "second-token";
		await refreshAndWait(ctx, targets);
		expect(providerUsageCopilot(targets)).toMatchObject({
			summary: "?",
			state: "error",
		});
		expect(providerUsageCopilot(targets)?.details).toBeUndefined();
		expect(providerUsageCopilot([])).toBeUndefined();
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

	test("discovers an authenticated static LLM Hub provider from Pi", async () => {
		const targets = await discoverProviderUsageTargetsAsync(llmHubContext());

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
		const targets = await discoverProviderUsageTargetsAsync(ctx);

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
			await refreshAndWait(ctx, await discoverProviderUsageTargetsAsync(ctx));
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
		const targets = await discoverProviderUsageTargetsAsync(ctx);

		await refreshAndWait(ctx, targets);

		expect(render(targets)).toBe("LLMHub $322.29");
	});

	test("does not discover LLM Hub when the Pi provider is absent", async () => {
		const ctx = llmHubContext({ includeProvider: false });
		ctx.readStoredCredential = (provider) =>
			provider === "llm-hub" ? { type: "api_key" } : undefined;

		expect(await discoverProviderUsageTargetsAsync(ctx)).toEqual([]);
	});

	test("does not discover LLM Hub without configured Pi authentication", async () => {
		expect(
			await discoverProviderUsageTargetsAsync(
				llmHubContext({ authenticated: false }),
			),
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

	test("activates the resolved OpenAI family badge only while rendering", async () => {
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
		const targets = await discoverProviderUsageTargetsAsync(ctx);
		const activeFamily = mappedProviderUsageFamily(ctx.model);

		expect(targets).toEqual([
			{ providerId: "openai-codex", authKind: "oauth", active: false },
		]);
		expect(renderProviderUsage(targets, theme, false)).toBeUndefined();
		expect(renderStyled(targets, false, activeFamily)).toBe(
			`<model>${OPENAI_LOGO} ?</model>`,
		);
		expect(renderStyled(targets, true, activeFamily)).toBe(
			`<model>${OPENAI_LOGO} ?</model>`,
		);
	});

	test("does not fabricate an OpenAI target for mapped LiteLLM models", async () => {
		const ctx: ProviderUsageContext = {
			model: { provider: "litellm", id: "openai/gpt-5" },
			modelRegistry: { getAvailable: () => [] },
			readStoredCredential(provider) {
				return provider === "anthropic"
					? { type: "oauth", access: "anthropic-token" }
					: undefined;
			},
		};
		const targets = await discoverProviderUsageTargetsAsync(ctx);
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
		const targets = await discoverProviderUsageTargetsAsync(ctx);

		await refreshAndWait(ctx, targets);

		expect(renderProviderUsage(targets, theme, false)).toBeUndefined();
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

		const targets = await discoverProviderUsageTargetsAsync(ctx);
		expect(targets).toEqual([]);
		await refreshProviderUsage(ctx, targets, vi.fn());

		expect(fetchMock).not.toHaveBeenCalled();
		expect(render(targets)).toBe("");
	});

	test("classifies lock errors accurately and hydrates peer cache on lease compromise without duplicate release errors", async () => {
		const cachePath = process.env.PI_PROVIDER_USAGE_CACHE_PATH as string;
		const errors: string[] = [];
		const ctx: ProviderUsageContext = {
			model: { provider: "anthropic" },
			modelRegistry: {
				getAvailable: () => [{ provider: "anthropic" }],
				getApiKeyForProvider: async () => "anth-token",
				isUsingOAuth: () => true,
			},
			readStoredCredential: (provider) =>
				provider === "anthropic"
					? {
							type: "oauth",
							access: "anth-token",
							refresh: "refresh",
							expires: Date.now() + 60_000,
						}
					: undefined,
			reportError: (message) => errors.push(message),
		};
		const targets = await discoverProviderUsageTargetsAsync(ctx);
		fetchCalls(() => Response.json({ five_hour: { used_percent: 12 } }));
		await refreshAndWait(ctx, targets);
		const seeded = JSON.parse(readFileSync(cachePath, "utf8")) as {
			entries: Record<string, Record<string, unknown>>;
		};
		const [cacheKey] = Object.keys(seeded.entries);
		const staleAt = Date.now() - 6 * 60_000;
		seeded.entries[cacheKey].fetchedAt = staleAt;
		seeded.entries[cacheKey].lastAttemptAt = staleAt;
		resetStore(false);
		writeFileSync(cachePath, JSON.stringify(seeded));

		const lockSpy = vi.spyOn(lockfile, "lock");

		// Non-contention lock error must not misreport contention timeout.
		lockSpy.mockRejectedValueOnce(
			Object.assign(new Error("permission denied"), { code: "EACCES" }),
		);
		await refreshAndWait(ctx, targets);
		expect(errors).toEqual([
			"Provider usage (anthropic): failed to acquire refresh lease: permission denied",
		]);

		// Compromised lease hydrates fresh peer cache and notifies onUpdate even if an
		// intervening render already hydrated memory.
		errors.length = 0;
		const freshAt = Date.now();
		lockSpy.mockImplementationOnce(async (_path, options) => {
			writeFileSync(
				cachePath,
				JSON.stringify({
					entries: {
						[cacheKey]: {
							providerId: "anthropic",
							authKind: "oauth",
							state: "ready",
							scope: { sessionPercentUsed: 27 },
							fetchedAt: freshAt,
							lastAttemptAt: freshAt,
						},
					},
				}),
			);
			// Simulate a concurrent render hydrating the peer cache mid-flight.
			expect(render(targets)).toBe("Anthropic 27%");
			options?.onCompromised?.(
				Object.assign(new Error("lock compromised"), {
					code: "ECOMPROMISED",
				}),
			);
			return async () => {};
		});
		const onUpdate = vi.fn();
		await refreshProviderUsage(ctx, targets, onUpdate);
		expect(onUpdate).toHaveBeenCalled();
		expect(render(targets)).toBe("Anthropic 27%");
		expect(errors).toEqual([
			"Provider usage (anthropic): refresh lease was compromised: lock compromised",
		]);
	});

	test("Copilot usage normalizes entitlement, camelCase requests, reset precedence, unlimited sentinels, invalid fields, and cache validation through ProviderUsageStore", async () => {
		const target: ProviderUsageTarget = {
			providerId: "github-copilot",
			authKind: "oauth",
			active: true,
		};
		const fetchCopilotDetails = async (body: unknown, suffix: string) => {
			const cachePath = join(sharedTestRoot, `copilot-detail-${suffix}.json`);
			const isolated = createProviderUsageStore({
				env: { PI_PROVIDER_USAGE_CACHE_PATH: cachePath },
				fetch: (async () => Response.json(body)) as typeof globalThis.fetch,
			});
			const ctx: ProviderUsageContext = {
				readStoredCredential: (provider) =>
					provider === "github-copilot"
						? { type: "oauth", refresh: `grant-${suffix}`, access: "tok" }
						: undefined,
			};
			await isolated.refresh(ctx, [target], () => {});
			return {
				account: isolated.cliSnapshot([target]).copilot,
				cachePath,
				ctx,
			};
		};

		// Entitlement basis stays separate from aggregate credits and rounded percents.
		const credits = await fetchCopilotDetails(
			{
				copilot_plan: "business",
				token_based_billing: true,
				quota_reset_date: "2035-02-01",
				quota_reset_date_utc: "2035-02-01T00:00:00.000Z",
				quota_snapshots: {
					premium_interactions: {
						entitlement: 1000,
						quota_remaining: 749.25,
						remaining: 749,
						percent_remaining: 75,
						credits_used: 4000,
						overage_count: 0,
						overage_permitted: true,
						quota_reset_at: 0,
					},
				},
			},
			"credits",
		);
		expect(credits.account?.details).toMatchObject({
			plan: "Business",
			premium: {
				unit: "credits",
				allowance: 1000,
				remaining: 749.25,
				used: 250.75,
				percentUsed: 25,
				creditsUsed: 4000,
				overagePermitted: true,
				overageUsed: 0,
				resetAt: Date.parse("2035-02-01T00:00:00Z"),
			},
		});

		// Cache round-trip preserves sanitized details across fresh store instances.
		const rehydrated = createProviderUsageStore({
			env: { PI_PROVIDER_USAGE_CACHE_PATH: credits.cachePath },
		});
		await rehydrated.refresh(credits.ctx, [target], () => {});
		expect(rehydrated.cliSnapshot([target]).copilot?.details).toEqual(
			credits.account?.details,
		);

		// Legacy camelCase requests + plan-only responses.
		const legacy = await fetchCopilotDetails(
			{
				copilotPlan: "individual_pro",
				tokenBasedBilling: false,
				quotaResetDate: "2035-03-01",
				quotaSnapshots: {
					premiumInteractions: {
						entitlement: "300",
						remaining: "0",
						usedPercentage: 100,
						overagePermitted: false,
						overageCount: 2.5,
					},
				},
			},
			"legacy",
		);
		expect(legacy.account?.details).toMatchObject({
			plan: "Pro+",
			premium: {
				unit: "requests",
				allowance: 300,
				remaining: 0,
				used: 300,
				percentUsed: 100,
				overagePermitted: false,
				overageUsed: 2.5,
				resetAt: Date.parse("2035-03-01T00:00:00Z"),
			},
		});
		expect(
			(await fetchCopilotDetails({ copilot_plan: "pro" }, "plan-only")).account
				?.details,
		).toEqual({ plan: "Pro" });

		// Reset precedence: per-quota seconds -> UTC timestamp -> date-only UTC -> undefined.
		const seconds = Date.parse("2035-02-02T04:00:00Z") / 1000;
		expect(
			(
				await fetchCopilotDetails(
					{
						quota_reset_date: "2035-02-01",
						quota_reset_date_utc: "2035-02-03T12:00:00Z",
						quota_snapshots: {
							premium_interactions: { quota_reset_at: seconds },
						},
					},
					"reset-sec",
				)
			).account?.details?.premium?.resetAt,
		).toBe(seconds * 1000);
		expect(
			(
				await fetchCopilotDetails(
					{
						quota_reset_date: "2035-02-01",
						quota_reset_date_utc: "invalid",
						quota_snapshots: {
							premium_interactions: { percent_remaining: 100 },
						},
					},
					"reset-date",
				)
			).account?.details?.premium?.resetAt,
		).toBe(Date.parse("2035-02-01T00:00:00Z"));
		expect(
			(
				await fetchCopilotDetails(
					{
						quota_snapshots: {
							premium_interactions: { percent_remaining: 100 },
						},
					},
					"reset-none",
				)
			).account?.details?.premium?.resetAt,
		).toBeUndefined();

		// Unlimited sentinels never appear as zero usage or allowances.
		for (const [idx, quota] of [
			{ unlimited: true, entitlement: 0, remaining: 0 },
			{ entitlement: -1, remaining: -1 },
		].entries()) {
			const premium = (
				await fetchCopilotDetails(
					{
						copilot_plan: "enterprise",
						token_based_billing: true,
						quota_snapshots: {
							premium_interactions: {
								...quota,
								percent_remaining: 100,
								credits_used: 12.5,
							},
						},
					},
					`unlimited-${idx}`,
				)
			).account?.details?.premium;
			expect(premium).toMatchObject({ unlimited: true, creditsUsed: 12.5 });
			expect(premium?.percentUsed).toBeUndefined();
			expect(premium?.allowance).toBeUndefined();
			expect(premium?.remaining).toBeUndefined();
			expect(premium?.used).toBeUndefined();
		}

		// Invalid numeric fields, empty/inconsistent shapes, and malformed cache entries.
		for (const [idx, bad] of [
			null,
			false,
			"",
			" ",
			"invalid",
			-5,
			{},
		].entries()) {
			const premium = (
				await fetchCopilotDetails(
					{
						copilot_plan: "business",
						token_based_billing: true,
						quota_snapshots: {
							premium_interactions: {
								entitlement: bad,
								remaining: bad,
								percent_remaining: bad,
								overage_count: bad,
								credits_used: bad,
							},
						},
					},
					`bad-${idx}`,
				)
			).account?.details?.premium;
			for (const key of [
				"allowance",
				"remaining",
				"used",
				"percentUsed",
				"overageUsed",
				"creditsUsed",
			] as const) {
				expect(premium?.[key]).toBeUndefined();
			}
		}
		expect((await fetchCopilotDetails(null, "null")).account?.state).toBe(
			"unknown",
		);
		expect(
			(
				await fetchCopilotDetails(
					{ quota_snapshots: { premium_interactions: {} } },
					"empty",
				)
			).account?.state,
		).toBe("unknown");
		expect(
			(await fetchCopilotDetails({ copilot_plan: "constructor" }, "proto"))
				.account?.state,
		).toBe("unknown");
		const inconsistent = (
			await fetchCopilotDetails(
				{
					quota_snapshots: {
						premium_interactions: {
							entitlement: 100,
							remaining: 110,
							percent_remaining: 101,
							overage_permitted: "false",
						},
					},
				},
				"inconsistent",
			)
		).account?.details?.premium;
		expect(inconsistent).toMatchObject({
			unit: "unknown",
			allowance: 100,
			remaining: 110,
		});
		expect(inconsistent?.used).toBeUndefined();
		expect(inconsistent?.percentUsed).toBeUndefined();
		expect(inconsistent?.overagePermitted).toBeUndefined();

		// Malformed cached Copilot details sanitize bad plans/units/numbers.
		const malformedCache = join(sharedTestRoot, "copilot-malformed.json");
		const stamp = Date.now();
		const targetKey = "github-copilot:oauth";
		const grantHash = createHash("sha256")
			.update(`${targetKey}\0malformed-grant`)
			.digest("hex")
			.slice(0, 16);
		writeFileSync(
			malformedCache,
			JSON.stringify({
				entries: {
					[`${targetKey}:${grantHash}`]: {
						providerId: "github-copilot",
						authKind: "oauth",
						state: "ready",
						fetchedAt: stamp,
						lastAttemptAt: stamp,
						copilot: {
							plan: "private-name",
							premium: {
								unit: "bad",
								used: -1,
								allowance: "",
								remaining: null,
								percentUsed: 150,
							},
						},
					},
				},
			}),
		);
		const fromMalformed = createProviderUsageStore({
			env: { PI_PROVIDER_USAGE_CACHE_PATH: malformedCache },
		});
		await fromMalformed.refresh(
			{
				readStoredCredential: (provider) =>
					provider === "github-copilot"
						? { type: "oauth", refresh: "malformed-grant", access: "tok" }
						: undefined,
			},
			[target],
			() => {},
		);
		expect(fromMalformed.cliSnapshot([target]).copilot?.details).toMatchObject({
			plan: undefined,
			premium: { unit: "unknown" },
		});
	});

	test("cachedProviderPercentUsed reads recorded Copilot and proxy values across expired TTLs while ignoring mismatched credentials and disabled accounts", () => {
		const stamp = 946684800000;
		const copilotPath = join(sharedTestRoot, "cached-routing-provider.json");
		const proxyPath = join(sharedTestRoot, "cached-routing-proxy.json");
		vi.stubEnv("PI_PROVIDER_USAGE_CACHE_PATH", copilotPath);
		vi.stubEnv("PI_CLIPROXY_USAGE_CACHE_PATH", proxyPath);
		vi.stubEnv("CLIPROXYAPI_BASE_URL", "https://example.invalid/v1");
		vi.stubEnv("CLIPROXYAPI_MANAGEMENT_KEY", "test-management-key");

		const hash = (value: string) =>
			createHash("sha256").update(value).digest("hex");
		const targetKey = "github-copilot:oauth";
		const writeCopilot = (percent: number, identity: string) =>
			writeFileSync(
				copilotPath,
				JSON.stringify({
					entries: {
						[`${targetKey}:${hash(`${targetKey}\0${identity}`).slice(0, 16)}`]:
							{
								providerId: "github-copilot",
								authKind: "oauth",
								state: "error",
								fetchedAt: stamp,
								lastAttemptAt: stamp + 1000,
								copilot: {
									premium: {
										unit: "credits",
										percentUsed: percent,
										resetAt: stamp,
									},
								},
							},
					},
				}),
			);
		const writeProxy = (activePercent: number) =>
			writeFileSync(
				proxyPath,
				JSON.stringify({
					source: hash("https://example.invalid\0test-management-key"),
					fetchedAt: stamp,
					accounts: [
						{
							provider: "codex",
							scope: {
								sessionPercentUsed: 40,
								weeklyPercentUsed: activePercent,
								weeklyResetAt: stamp,
							},
						},
						{ provider: "codex", scope: { sessionPercentUsed: 1 } },
						{
							provider: "codex",
							disabled: true,
							scope: { sessionPercentUsed: 100 },
						},
					],
				}),
			);

		const ctx = {
			readStoredCredential: () => ({
				type: "oauth" as const,
				refresh: "active-test-grant",
				access: "test-access",
				expires: 0,
			}),
		};

		writeCopilot(95, "active-test-grant");
		writeProxy(98);
		expect(cachedProviderPercentUsed("github-copilot", ctx)).toBe(95);
		expect(cachedProviderPercentUsed("cliproxyapi", ctx)).toBe(98);
		expect(cachedProviderPercentUsed("google-vertex", ctx)).toBeUndefined();

		writeCopilot(100, "different-test-grant");
		writeProxy(94.99);
		expect(cachedProviderPercentUsed("github-copilot", ctx)).toBeUndefined();
		expect(cachedProviderPercentUsed("cliproxyapi", ctx)).toBe(94.99);
	});

	test("mid-refresh cache path env change persists to the locked path without contaminating the new path", async () => {
		const firstPath = join(sharedTestRoot, "env-shift-first.json");
		const secondPath = join(sharedTestRoot, "env-shift-second.json");
		const env: NodeJS.ProcessEnv = { PI_PROVIDER_USAGE_CACHE_PATH: firstPath };
		const fetchMock: typeof globalThis.fetch = async () => {
			env.PI_PROVIDER_USAGE_CACHE_PATH = secondPath;
			return new Response(
				JSON.stringify({
					data: { limit: 100, limit_remaining: 40, usage: 60 },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		};
		const store = createProviderUsageStore({ env, fetch: fetchMock });
		const target = {
			providerId: "openrouter",
			authKind: "api_key" as const,
			active: true,
		};
		const ctx = {
			modelRegistry: {
				getAll: () => [{ provider: "openrouter", id: "model" }],
				getAvailable: async () => [{ provider: "openrouter", id: "model" }],
				hasConfiguredAuth: () => true,
				getProviderAuthStatus: () => ({ configured: true }),
				getApiKeyForProvider: async () => "or-env-shift-key",
				isUsingOAuth: () => false,
			},
		};

		await store.refresh(ctx, [target], () => {});

		const written = JSON.parse(readFileSync(firstPath, "utf8"));
		expect(Object.values(written.entries)).toHaveLength(1);
		expect(
			(
				Object.values(written.entries)[0] as {
					scope?: { balanceUsd?: number };
				}
			).scope?.balanceUsd,
		).toBe(40);
		expect(existsSync(secondPath)).toBe(false);
	});

	test("reports a non-fatal diagnostic when shared cache persistence fails", async () => {
		const persistPath = join(sharedTestRoot, "persist-fail.json");
		const env: NodeJS.ProcessEnv = {
			PI_PROVIDER_USAGE_CACHE_PATH: persistPath,
		};
		const errors: string[] = [];
		const originalLock = lockfile.lock.bind(lockfile);
		const lockSpy = vi.spyOn(lockfile, "lock");
		lockSpy.mockImplementation(async (file, options) => {
			if (file === persistPath) {
				throw Object.assign(new Error("permission denied"), { code: "EACCES" });
			}
			return originalLock(file, options);
		});
		const store = createProviderUsageStore({
			env,
			fetch: async () =>
				new Response(
					JSON.stringify({
						data: { limit: 100, limit_remaining: 55, usage: 45 },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		});
		const target = {
			providerId: "openrouter",
			authKind: "api_key" as const,
			active: true,
		};
		const ctx = {
			modelRegistry: {
				getAll: () => [{ provider: "openrouter", id: "model" }],
				getAvailable: async () => [{ provider: "openrouter", id: "model" }],
				hasConfiguredAuth: () => true,
				getProviderAuthStatus: () => ({ configured: true }),
				getApiKeyForProvider: async () => "or-persist-fail-key",
				isUsingOAuth: () => false,
			},
			reportError: (message: string) => errors.push(message),
		};

		await store.refresh(ctx, [target], () => {});

		expect(errors).toEqual([
			"Provider usage (openrouter): failed to persist shared usage cache",
		]);
		expect(existsSync(persistPath)).toBe(false);
	});
});
