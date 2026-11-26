import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ExtensionAPI,
	type ExtensionToolContext,
	readStoredCredential,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";
import { invalidateProviderUsageCache } from "./provider-usage";
import { registerReviewModels } from "./review-models";

vi.mock("@earendil-works/pi-coding-agent", async (original) => ({
	...(await original<typeof import("@earendil-works/pi-coding-agent")>()),
	readStoredCredential: vi.fn(),
}));

const copilot = {
	provider: "github-copilot",
	id: "candidate",
	reasoning: true,
};
const proxy = { provider: "cliproxyapi", id: "candidate", reasoning: true };
const vertex = { provider: "google-vertex", id: "candidate", reasoning: true };
const other = { provider: "google-vertex", id: "outside", reasoning: true };
const modelId = (model: typeof copilot) => `${model.provider}/${model.id}`;

const tempDirs: string[] = [];

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function seedSharedUsageCaches(usage?: {
	copilot?: number;
	cliproxyapi?: number;
}) {
	const dir = mkdtempSync(join(tmpdir(), "review-models-test-"));
	tempDirs.push(dir);
	const providerCachePath = join(dir, "provider-usage.json");
	const proxyCachePath = join(dir, "cliproxy-usage.json");
	const baseUrl = "https://proxy.example.test";
	const managementKey = "test-management-key";
	const copilotToken = "copilot-oauth-token";

	vi.stubEnv("PI_PROVIDER_USAGE_CACHE_PATH", providerCachePath);
	vi.stubEnv("PI_CLIPROXY_USAGE_CACHE_PATH", proxyCachePath);
	vi.stubEnv("CLIPROXYAPI_BASE_URL", baseUrl);
	vi.stubEnv("CLIPROXYAPI_MANAGEMENT_KEY", managementKey);
	vi.mocked(readStoredCredential).mockImplementation((provider) =>
		provider === "github-copilot"
			? {
					type: "oauth",
					access: copilotToken,
					refresh: copilotToken,
					expires: Date.now() + 120_000,
				}
			: undefined,
	);

	if (usage?.copilot !== undefined) {
		const targetKey = "github-copilot:oauth";
		const key = `${targetKey}:${sha256(`${targetKey}\0${copilotToken}`).slice(0, 16)}`;
		writeFileSync(
			providerCachePath,
			JSON.stringify({
				entries: {
					[key]: {
						providerId: "github-copilot",
						authKind: "oauth",
						state: "ready",
						fetchedAt: Date.now(),
						copilot: {
							premium: {
								unit: "requests",
								percentUsed: usage.copilot,
							},
						},
					},
				},
			}),
		);
	}

	if (usage?.cliproxyapi !== undefined) {
		writeFileSync(
			proxyCachePath,
			JSON.stringify({
				source: sha256(`${baseUrl}\0${managementKey}`),
				fetchedAt: Date.now(),
				accounts: [
					{
						provider: "codex",
						identity: sha256("proxy-acct-1"),
						scope: { sessionPercentUsed: usage.cliproxyapi },
						observedAt: Date.now(),
					},
				],
			}),
		);
	}
}

afterEach(() => {
	invalidateProviderUsageCache();
	vi.unstubAllEnvs();
	vi.mocked(readStoredCredential).mockReset();
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

async function listModels(
	patterns: string[],
	options: {
		scoped?: (typeof copilot)[];
		usage?: { copilot?: number; cliproxyapi?: number };
	} = {},
) {
	seedSharedUsageCaches(options.usage);
	const registerTool = vi.fn<ExtensionAPI["registerTool"]>();
	registerReviewModels({
		getSettings: () => ({ enabledModels: patterns }),
		registerTool,
	} as unknown as ExtensionAPI);
	const tool = registerTool.mock.calls[0]?.[0];
	if (!tool) throw new Error("review model tool was not registered");
	const result = await tool.execute("test", {}, undefined, undefined, {
		model: copilot,
		scopedModels: (options.scoped ?? []).map((model) => ({ model })),
		modelRegistry: { getAvailable: () => [copilot, proxy, vertex, other] },
	} as unknown as ExtensionToolContext);
	return result.details;
}

const enabled = [modelId(copilot), modelId(proxy), modelId(vertex)];

test("excludes providers at or above the 95% cutoff while keeping unaffected providers", async () => {
	expect(
		await listModels(enabled, {
			usage: { copilot: 95, cliproxyapi: 98 },
		}),
	).toMatchObject({
		eligible: [expect.objectContaining({ id: modelId(vertex) })],
		blockedProviders: { "github-copilot": 95, cliproxyapi: 98 },
	});
});

test("keeps providers strictly below the 95% cutoff without rounding up", async () => {
	expect(
		await listModels(enabled, {
			usage: { copilot: undefined, cliproxyapi: 94.99 },
		}),
	).toMatchObject({
		eligible: enabled.map((id) => expect.objectContaining({ id })),
		blockedProviders: {},
	});
});

test("missing usage allows an enabled model without widening the configured or live scope", async () => {
	expect(
		await listModels([modelId(proxy), "google-vertex/cand*:medium"], {
			scoped: [vertex, other],
		}),
	).toMatchObject({
		eligible: [
			expect.objectContaining({
				id: modelId(vertex),
				preferredThinking: "medium",
			}),
		],
		blockedProviders: {},
	});
	expect(await listModels([])).toMatchObject({
		eligible: [],
		enabledModelsConfigured: false,
	});
});
