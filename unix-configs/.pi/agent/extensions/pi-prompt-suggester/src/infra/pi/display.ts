import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export function getConfiguredModelDisplay(params: {
	ctx: ExtensionContext | undefined;
	configuredModel: string;
	configuredThinking: string;
	getSessionThinkingLevel: () => string;
}): string | undefined {
	const { ctx, configuredModel, configuredThinking, getSessionThinkingLevel } =
		params;
	if (!ctx?.model) return undefined;

	let provider = ctx.model.provider;
	let modelId = ctx.model.id;
	const normalizedModel = configuredModel.trim();
	if (normalizedModel && normalizedModel !== "session-default") {
		if (normalizedModel.includes("/")) {
			const [configuredProvider, ...rest] = normalizedModel.split("/");
			provider = configuredProvider;
			modelId = rest.join("/");
		} else {
			const matches = ctx.modelRegistry
				.getAll()
				.filter((model) => model.id === normalizedModel);
			if (matches.length === 1) {
				provider = matches[0].provider;
				modelId = matches[0].id;
			} else {
				modelId = normalizedModel;
			}
		}
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
