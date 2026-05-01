import type { ModelPolicy, ThinkingLevel } from "./workflow-types.ts";

type ModelLike = {
	provider?: string;
	id?: string;
	name?: string;
	contextWindow?: number;
	cost?: { input?: number; output?: number };
};
type MaybePromise<T> = T | Promise<T>;
type RegistryLike = {
	getAll?: () => ModelLike[];
	getAvailable?: () => MaybePromise<ModelLike[]>;
	find?: (provider: string, id: string) => ModelLike | undefined;
	hasConfiguredAuth?: (model: ModelLike) => boolean;
};

export interface ModelSelection {
	model?: ModelLike;
	modelKey?: string;
	thinking: ThinkingLevel;
	reason: string;
}

function modelKey(model: ModelLike): string {
	return `${model.provider ?? ""}/${model.id ?? model.name ?? ""}`;
}
function splitKey(key: string): [string, string] | undefined {
	const index = key.indexOf("/");
	if (index <= 0) return undefined;
	return [key.slice(0, index), key.slice(index + 1)];
}
async function allAvailable(
	registry: RegistryLike | undefined,
): Promise<ModelLike[]> {
	const all = registry?.getAvailable
		? await registry.getAvailable()
		: (registry?.getAll?.() ?? []);
	return all.filter((m) =>
		registry?.hasConfiguredAuth ? registry.hasConfiguredAuth(m) : true,
	);
}
async function resolveCandidates(
	policy: ModelPolicy,
	registry: RegistryLike | undefined,
): Promise<ModelLike[]> {
	const available = await allAvailable(registry);
	const byKey = new Map(available.map((m) => [modelKey(m), m]));
	const requested =
		policy.models ??
		(policy.model && policy.model !== "auto" && policy.model !== "inherit"
			? [policy.model]
			: undefined);
	if (!requested?.length) return available;
	const out: ModelLike[] = [];
	for (const key of requested) {
		const exact = byKey.get(key);
		if (exact) {
			out.push(exact);
			continue;
		}
		const parts = splitKey(key);
		const found = parts && registry?.find?.(parts[0], parts[1]);
		if (
			found &&
			(!registry?.hasConfiguredAuth || registry.hasConfiguredAuth(found))
		)
			out.push(found);
	}
	return out;
}

function stageScore(
	stage: string,
	complexity: string | undefined,
	model: ModelLike,
): number {
	const key = modelKey(model).toLowerCase();
	let score = 0;
	if (key.includes("gpt-5") || key.includes("claude") || key.includes("sonnet"))
		score += 20;
	if (key.includes("codex")) score += stage === "worker" ? 25 : 10;
	if (key.includes("opus"))
		score += stage === "planning" || stage === "reviewer" ? 20 : 5;
	if (key.includes("sonnet"))
		score += stage === "reviewer" || stage === "planning" ? 20 : 10;
	if (key.includes("mini") || key.includes("haiku"))
		score += stage === "validator" || stage === "classifier" ? 15 : -10;
	if ((model.contextWindow ?? 0) > 150_000)
		score += complexity === "complex" ? 10 : 3;
	if (stage === "validator" && (key.includes("mini") || key.includes("haiku")))
		score += 20;
	return score;
}

export async function selectModel(
	policy: ModelPolicy | undefined,
	registry: RegistryLike | undefined,
	stage: string,
	complexity?: string,
): Promise<ModelSelection> {
	const effective: ModelPolicy = policy ?? {
		model: "inherit",
		thinking: "inherit",
	};
	const thinking = effective.thinking ?? "inherit";
	if (
		effective.model === "inherit" ||
		(!effective.models?.length && effective.autoSelectModel === false)
	) {
		return {
			thinking,
			reason: `${stage}: inherited current model; thinking=${thinking}`,
		};
	}
	const candidates = await resolveCandidates(effective, registry);
	if (candidates.length === 0)
		return {
			thinking,
			reason: `${stage}: no configured/authenticated model candidates; leaving current model`,
		};
	const auto =
		effective.model === "auto" ||
		effective.autoSelectModel === true ||
		(!effective.models?.length && effective.autoSelectModel !== false);
	const chosen = auto
		? [...candidates].sort(
				(a, b) =>
					stageScore(stage, complexity, b) - stageScore(stage, complexity, a),
			)[0]
		: candidates[0];
	return {
		model: chosen,
		modelKey: modelKey(chosen),
		thinking,
		reason: `${stage}: selected ${modelKey(chosen)} (${auto ? "auto stage scoring" : "first available candidate"}); thinking=${thinking}`,
	};
}

export async function applyModelPolicy(
	pi: any,
	ctx: any,
	policy: ModelPolicy | undefined,
	stage: string,
	complexity?: string,
): Promise<ModelSelection> {
	const selection = await selectModel(
		policy,
		ctx?.modelRegistry,
		stage,
		complexity,
	);
	if (selection.model && typeof pi.setModel === "function")
		await pi.setModel(selection.model);
	if (
		selection.thinking &&
		selection.thinking !== "inherit" &&
		selection.thinking !== "auto" &&
		typeof pi.setThinkingLevel === "function"
	)
		pi.setThinkingLevel(selection.thinking);
	return selection;
}
