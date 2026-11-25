import type { ModelLike } from "./pi-types";

// This is our inter-extension contract. Only the adapter knows the provider's types.
export type SpeedMode = "fast" | "ultrafast";
export type SpeedReader = (
	provider: string,
	modelId: string,
) => SpeedMode | undefined;
export const FAST_READER_EVENT = "dotfiles:cliproxyapi-fast-reader";
export const FAST_CHANGED_EVENT = "dotfiles:cliproxyapi-fast-changed";

export function getCliproxySpeed(
	model: ModelLike | undefined,
	readSpeed: SpeedReader | undefined,
): SpeedMode | undefined {
	if (!model?.provider || !model.id) return undefined;
	return readSpeed?.(model.provider, model.id);
}
