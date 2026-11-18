import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type ExtensionAPI,
	type ExtensionToolContext,
	readStoredCredential,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { registerReviewModels } from "./review-models";

vi.mock("@earendil-works/pi-coding-agent", () => ({
	readStoredCredential: vi.fn(),
}));

const stamp = 946684800000; // Well past both the display TTL and quota resets.
const copilot = {
	provider: "github-copilot",
	id: "candidate",
	reasoning: true,
};
const proxy = { provider: "cliproxyapi", id: "candidate", reasoning: true };
const vertex = { provider: "google-vertex", id: "candidate", reasoning: true };
const other = { provider: "google-vertex", id: "outside", reasoning: true };
const modelId = (model: typeof copilot) => `${model.provider}/${model.id}`;
const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");
let dir: string;

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "review-models-"));
	vi.stubEnv("PI_PROVIDER_USAGE_CACHE_PATH", join(dir, "provider.json"));
	vi.stubEnv("PI_CLIPROXY_USAGE_CACHE_PATH", join(dir, "proxy.json"));
	vi.stubEnv("CLIPROXYAPI_BASE_URL", "https://example.invalid/v1");
	vi.stubEnv("CLIPROXYAPI_MANAGEMENT_KEY", "test-management-key");
	vi.mocked(readStoredCredential).mockReturnValue({
		type: "oauth",
		refresh: "active-test-grant",
		access: "test-access",
		expires: 0,
	});
});

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.clearAllMocks();
	await rm(dir, { force: true, recursive: true });
});

function writeCopilot(percent: number, identity = "active-test-grant") {
	const key = "github-copilot:oauth";
	return writeFile(
		join(dir, "provider.json"),
		JSON.stringify({
			entries: {
				[`${key}:${hash(`${key}\0${identity}`).slice(0, 16)}`]: {
					providerId: "github-copilot",
					authKind: "oauth",
					state: "error",
					fetchedAt: stamp,
					lastAttemptAt: stamp + 1000,
					copilot: {
						premium: { unit: "credits", percentUsed: percent, resetAt: stamp },
					},
				},
			},
		}),
	);
}

function writeProxy(activePercent: number) {
	return writeFile(
		join(dir, "proxy.json"),
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
}

async function listModels(patterns: string[], scoped: (typeof copilot)[] = []) {
	const registerTool = vi.fn<ExtensionAPI["registerTool"]>();
	registerReviewModels({
		getSettings: () => ({ enabledModels: patterns }),
		registerTool,
	} as unknown as ExtensionAPI);
	const tool = registerTool.mock.calls[0]?.[0];
	if (!tool) throw new Error("review model tool was not registered");
	const result = await tool.execute("test", {}, undefined, undefined, {
		model: copilot,
		scopedModels: scoped.map((model) => ({ model })),
		modelRegistry: { getAvailable: () => [copilot, proxy, vertex, other] },
	} as unknown as ExtensionToolContext);
	return result.details;
}

const enabled = [modelId(copilot), modelId(proxy), modelId(vertex)];

test("enforces the cutoff on recorded values even after their quota and display TTL expire", async () => {
	await writeCopilot(95);
	await writeProxy(98);
	expect(await listModels(enabled)).toMatchObject({
		eligible: [expect.objectContaining({ id: modelId(vertex) })],
		blockedProviders: { "github-copilot": 95, cliproxyapi: 98 },
	});
});

test("ignores disabled proxy accounts, another Copilot credential, and rounded display values", async () => {
	await writeCopilot(100, "different-test-grant");
	await writeProxy(94.99);
	expect(await listModels(enabled)).toMatchObject({
		eligible: enabled.map((id) => expect.objectContaining({ id })),
		blockedProviders: {},
	});
});

test("missing usage allows an enabled model without widening the configured or live scope", async () => {
	expect(
		await listModels(
			[modelId(proxy), "google-vertex/cand*:medium"],
			[vertex, other],
		),
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
