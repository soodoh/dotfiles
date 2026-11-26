import type {
	ExtensionAPI,
	ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { expect, test, vi } from "vitest";
import {
	type CachedProviderUsageReader,
	registerReviewModels,
} from "./review-models";

const copilot = {
	provider: "github-copilot",
	id: "candidate",
	reasoning: true,
};
const proxy = { provider: "cliproxyapi", id: "candidate", reasoning: true };
const vertex = { provider: "google-vertex", id: "candidate", reasoning: true };
const other = { provider: "google-vertex", id: "outside", reasoning: true };
const modelId = (model: typeof copilot) => `${model.provider}/${model.id}`;

async function listModels(
	patterns: string[],
	options: {
		scoped?: (typeof copilot)[];
		usage?: Record<string, number | undefined>;
	} = {},
) {
	const registerTool = vi.fn<ExtensionAPI["registerTool"]>();
	const readCachedUsage: CachedProviderUsageReader = (provider) =>
		options.usage?.[provider];
	registerReviewModels(
		{
			getSettings: () => ({ enabledModels: patterns }),
			registerTool,
		} as unknown as ExtensionAPI,
		readCachedUsage,
	);
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
			usage: { "github-copilot": 95, cliproxyapi: 98 },
		}),
	).toMatchObject({
		eligible: [expect.objectContaining({ id: modelId(vertex) })],
		blockedProviders: { "github-copilot": 95, cliproxyapi: 98 },
	});
});

test("keeps providers strictly below the 95% cutoff without rounding up", async () => {
	expect(
		await listModels(enabled, {
			usage: { "github-copilot": undefined, cliproxyapi: 94.99 },
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
