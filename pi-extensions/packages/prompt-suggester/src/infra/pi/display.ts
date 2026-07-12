import { resolveFirstAvailableModel } from "./model-resolution";

type ModelLike = {
	provider: string;
	id: string;
};

type DisplayContextLike = {
	model?: ModelLike;
	modelRegistry: {
		getAll(): ModelLike[];
	};
};

export function getConfiguredModelDisplay(params: {
	ctx: DisplayContextLike | undefined;
	configuredModel: string[];
	configuredThinking: string;
	getSessionThinkingLevel: () => string;
}): string | undefined {
	const { ctx, configuredModel, configuredThinking, getSessionThinkingLevel } =
		params;
	if (!ctx?.model) return undefined;

	let provider = ctx.model.provider;
	let modelId = ctx.model.id;
	try {
		const resolved = resolveFirstAvailableModel({
			currentModel: ctx.model,
			configuredModelRefs: configuredModel,
			allModels: ctx.modelRegistry.getAll(),
		}).model;
		provider = resolved.provider;
		modelId = resolved.id;
	} catch {
		const firstConfiguredModel = configuredModel[0]?.trim();
		if (firstConfiguredModel) modelId = firstConfiguredModel;
	}

	const thinking =
		configuredThinking === "session-default"
			? getSessionThinkingLevel()
			: configuredThinking;
	const providerCount = new Set(
		ctx.modelRegistry.getAll().map((model) => model.provider),
	).size;
	const modelLabel = providerCount > 1 ? `(${provider}) ${modelId}` : modelId;
	const thinkingLabel = thinking === "off" ? "thinking off" : thinking;
	return `${modelLabel} • ${thinkingLabel}`;
}
