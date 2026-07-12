type ModelRefLike = {
	provider: string;
	id: string;
};

interface ResolvedModel<TModel extends ModelRefLike> {
	model: TModel;
	configuredRef: string | undefined;
}

function normalizeModelRefs(
	modelRefs: string | string[] | undefined,
): string[] {
	const refs = Array.isArray(modelRefs) ? modelRefs : [modelRefs];
	return refs
		.map((entry) => entry?.trim() ?? "")
		.filter((entry) => entry.length > 0);
}

function lookupConfiguredModel<TModel extends ModelRefLike>(
	modelRef: string,
	allModels: TModel[],
): { model?: TModel; error?: string } {
	if (modelRef.includes("/")) {
		const [provider, ...rest] = modelRef.split("/");
		const id = rest.join("/");
		const exact = allModels.find(
			(entry) => entry.provider === provider && entry.id === id,
		);
		return exact
			? { model: exact }
			: { error: `Configured suggester model not found: ${modelRef}` };
	}

	const candidates = allModels.filter((entry) => entry.id === modelRef);
	if (candidates.length === 1) return { model: candidates[0] };
	if (candidates.length > 1) {
		return {
			error: `Configured suggester model '${modelRef}' is ambiguous. Use provider/id, e.g. ${candidates[0].provider}/${candidates[0].id}`,
		};
	}
	return { error: `Configured suggester model not found: ${modelRef}` };
}

export function resolveFirstAvailableModel<
	TModel extends ModelRefLike,
>(params: {
	currentModel: TModel;
	configuredModelRefs: string | string[] | undefined;
	allModels: TModel[];
}): ResolvedModel<TModel> {
	const refs = normalizeModelRefs(params.configuredModelRefs);
	if (refs.length === 0) {
		return { model: params.currentModel, configuredRef: undefined };
	}

	const errors: string[] = [];
	for (const ref of refs) {
		if (ref === "session-default") {
			return { model: params.currentModel, configuredRef: ref };
		}
		const resolved = lookupConfiguredModel(ref, params.allModels);
		if (resolved.model) {
			return { model: resolved.model, configuredRef: ref };
		}
		if (resolved.error) errors.push(resolved.error);
	}

	throw new Error(
		`No configured suggester models are available: ${refs.join(", ")}. ${errors.join("; ")}`,
	);
}
