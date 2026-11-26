import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProxyRequest } from "./cliproxy-usage";
import {
	createProviderUsageStore,
	type ProviderUsageContext,
} from "./provider-usage";

// Pins the JSON contract between ProviderUsageStore.cliSnapshot() and Swift's
// UsageSnapshot.decode(); provider-usage-cli.ts stdout framing is tested separately.
const parsedNow = Number(process.env.CONTRACT_NOW_MS);
const now =
	Number.isFinite(parsedNow) && parsedNow > 0 ? parsedNow : Date.now();
const futureResetSec = Math.floor(now / 1000) + 2 * 86400;
const futureSessionResetSec = Math.floor(now / 1000) + 3 * 3600;
const futureMonthlyResetSec = Math.floor(now / 1000) + 25 * 86400;
const dir = mkdtempSync(join(tmpdir(), "usage-cli-contract-"));

try {
	const env: NodeJS.ProcessEnv = {
		PI_PROVIDER_USAGE_CACHE_PATH: join(dir, "provider-usage.json"),
		PI_CLIPROXY_USAGE_CACHE_PATH: join(dir, "cliproxy-usage.json"),
		CLIPROXYAPI_BASE_URL: "https://proxy.contract.test/v1",
		CLIPROXYAPI_MANAGEMENT_KEY: "contract-management-key",
	};

	const fetchFn: typeof globalThis.fetch = async (input) => {
		const url = String(input);
		if (url.includes("openrouter.ai/api/v1/key")) {
			return new Response(
				JSON.stringify({
					data: { limit: 100, limit_remaining: 75, usage: 25 },
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		if (url.includes("api.github.com/copilot_internal/user")) {
			return new Response(
				JSON.stringify({
					copilot_plan: "pro",
					token_based_billing: false,
					quota_reset_date_utc: new Date(now + 10 * 86400_000).toISOString(),
					quota_snapshots: {
						premium_interactions: {
							entitlement: 300,
							quota_remaining: 225,
							percent_remaining: 75,
							overage_permitted: false,
							overage_count: 0,
						},
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}
		return new Response("not found", { status: 404 });
	};

	const requestProxy = async (request: ProxyRequest) => {
		if (request.path === "v8/management/credentials") {
			return {
				status: 200,
				body: {
					files: [
						{
							provider: "codex",
							auth_index: "acct-pro",
							status: "active",
							id_token: {
								plan_type: "pro",
								chatgpt_account_id: "contract-pro",
							},
							quota: {
								observed_at: new Date(now).toISOString(),
								signals: {
									"X-Codex-Primary-Used-Percent": "12",
									"X-Codex-Primary-Window-Minutes": "300",
									"X-Codex-Primary-Reset-At": String(futureSessionResetSec),
									"X-Codex-Secondary-Used-Percent": "47",
									"X-Codex-Secondary-Window-Minutes": "10080",
									"X-Codex-Secondary-Reset-At": String(futureResetSec),
								},
							},
						},
						{
							provider: "codex",
							auth_index: "acct-team",
							status: "disabled",
							disabled: true,
							id_token: {
								plan_type: "team",
								chatgpt_account_id: "contract-team",
							},
						},
					],
				},
			};
		}
		if (request.path === "v8/management/requests/api-call") {
			const authIndex = request.data?.auth_index;
			const targetUrl = String(request.data?.url ?? "");
			if (targetUrl.endsWith("/wham/usage")) {
				if (authIndex === "acct-pro") {
					return {
						status: 200,
						body: {
							status_code: 200,
							body: JSON.stringify({
								rate_limit: {
									primary_window: {
										used_percent: 12,
										limit_window_seconds: 5 * 3600,
										reset_at: futureSessionResetSec,
									},
									secondary_window: {
										used_percent: 47,
										limit_window_seconds: 7 * 86400,
										reset_at: futureResetSec,
									},
								},
								credits: {
									has_credits: true,
									unlimited: false,
									balance: "125.5",
								},
							}),
						},
					};
				}
				return {
					status: 200,
					body: {
						status_code: 200,
						body: JSON.stringify({
							rate_limit: {
								primary_window: {
									used_percent: 64,
									limit_window_seconds: 30 * 86400,
									reset_at: futureMonthlyResetSec,
								},
							},
							credits: {
								has_credits: true,
								unlimited: true,
							},
						}),
					},
				};
			}
			if (targetUrl.endsWith("/rate-limit-reset-credits")) {
				if (authIndex === "acct-pro") {
					return {
						status: 200,
						body: {
							status_code: 200,
							body: JSON.stringify({
								available_count: 2,
								credits: [
									{
										status: "available",
										expires_at: new Date(now + 3600_000).toISOString(),
										granted_at: new Date(now - 3600_000).toISOString(),
									},
									{ status: "available" },
								],
							}),
						},
					};
				}
				return {
					status: 200,
					body: {
						status_code: 200,
						body: JSON.stringify({ available_count: 0, credits: [] }),
					},
				};
			}
		}
		return { status: 404, body: {} };
	};

	const models = [
		{ provider: "openrouter", id: "anthropic/claude-sonnet-4" },
		{ provider: "github-copilot", id: "gpt-4.1" },
	];
	const ctx: ProviderUsageContext = {
		modelRegistry: {
			getAll: () => models,
			getAvailable: async () => models,
			hasConfiguredAuth: () => true,
			getProviderAuthStatus: () => ({ configured: true }),
			getApiKeyForProvider: async (provider) =>
				provider === "openrouter" ? "or-contract-key" : "gh-contract-token",
			isUsingOAuth: (model) => model.provider === "github-copilot",
		},
		readStoredCredential: (provider) =>
			provider === "github-copilot"
				? {
						type: "oauth",
						access: "gh-contract-token",
						refresh: "gh-contract-refresh",
					}
				: undefined,
	};

	const store = createProviderUsageStore({ env, fetch: fetchFn, requestProxy });
	const targets = await store.discoverTargetsAsync(ctx);
	await store.refresh(ctx, targets, () => {});
	process.stdout.write(`${JSON.stringify(store.cliSnapshot(targets))}\n`);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
