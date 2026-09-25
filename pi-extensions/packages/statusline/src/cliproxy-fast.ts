import type { ModelLike } from "./pi-types";

// This is our inter-extension contract. Only the adapter knows the provider's types.
export type FastReader = (provider: string, modelId: string) => boolean;
export const FAST_READER_EVENT = "dotfiles:cliproxyapi-fast-reader";
export const FAST_CHANGED_EVENT = "dotfiles:cliproxyapi-fast-changed";

export function isCliproxyFast(
	model: ModelLike | undefined,
	isFast: FastReader | undefined,
): boolean {
	if (!model?.provider || !model.id || !isFast) return false;
	return isFast(model.provider, model.id);
}
