import { matchesGlob } from "node:path";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	readStoredCredential,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { cachedProxyPercentUsed } from "./cliproxy-usage";
import { cachedCopilotPercentUsed } from "./provider-usage";

const USAGE_CUTOFF = 95;
const THINKING_SUFFIX = /:(off|minimal|low|medium|high|xhigh|max)$/;

export function registerReviewModels(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "review_loop_models",
		label: "Review loop models",
		description:
			"List enabled, available Pi models and cached quota exclusions for the review-fix-loop skill. Does not refresh quota or launch a model.",
		exposure: "model-only",
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		},
		parameters: Type.Object({}, { additionalProperties: false }),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const patterns = pi.getSettings().enabledModels ?? [];
			const liveScope = new Set(
				ctx.scopedModels.map(({ model }) => `${model.provider}/${model.id}`),
			);
			const candidates = ctx.modelRegistry.getAvailable().flatMap((model) => {
				const id = `${model.provider}/${model.id}`;
				if (liveScope.size && !liveScope.has(id)) return [];
				const matched = patterns.find((pattern) => {
					const base = pattern.replace(THINKING_SUFFIX, "").toLowerCase();
					return [id, model.id].some((name) => {
						const value = name.toLowerCase();
						return value === base || matchesGlob(value, base);
					});
				});
				if (!matched) return [];
				return [
					{
						id,
						provider: model.provider,
						thinkingLevels: getSupportedThinkingLevels(model),
						preferredThinking: matched.match(THINKING_SUFFIX)?.[1],
					},
				];
			});
			const providers = new Set(candidates.map(({ provider }) => provider));
			const usage = {
				"github-copilot": providers.has("github-copilot")
					? cachedCopilotPercentUsed({ readStoredCredential })
					: undefined,
				cliproxyapi: providers.has("cliproxyapi")
					? cachedProxyPercentUsed()
					: undefined,
			};
			const blockedProviders = new Map(
				Object.entries(usage).filter(
					([, used]) => used !== undefined && used >= USAGE_CUTOFF,
				),
			);
			const result = {
				currentModel: ctx.model
					? `${ctx.model.provider}/${ctx.model.id}`
					: undefined,
				enabledModelsConfigured: patterns.length > 0,
				eligible: candidates.filter(
					({ provider }) => !blockedProviders.has(provider),
				),
				blockedProviders: Object.fromEntries(blockedProviders),
			};
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				details: result,
			};
		},
	});
}
