import { Key, matchesKey } from "@mariozechner/pi-tui";
import type { GhostAcceptKey } from "../../config/types.js";

export const DEFAULT_GHOST_ACCEPT_KEYS: readonly GhostAcceptKey[] = ["space"];

function isGhostAcceptKey(value: unknown): value is GhostAcceptKey {
	return value === "space" || value === "right" || value === "enter";
}

export function normalizeGhostAcceptKeys(ghostAcceptKeys: readonly GhostAcceptKey[] | undefined): GhostAcceptKey[] {
	const normalized = (ghostAcceptKeys ?? DEFAULT_GHOST_ACCEPT_KEYS).filter((entry): entry is GhostAcceptKey => isGhostAcceptKey(entry));
	return normalized.length > 0 ? [...new Set(normalized)] : [...DEFAULT_GHOST_ACCEPT_KEYS];
}

export function matchesGhostAcceptKey(data: string, ghostAcceptKeys: readonly GhostAcceptKey[] | undefined): boolean {
	return normalizeGhostAcceptKeys(ghostAcceptKeys).some((key) => {
		if (key === "space") return matchesKey(data, Key.space);
		if (key === "right") return matchesKey(data, Key.right);
		return matchesKey(data, Key.enter) || matchesKey(data, Key.return) || data === "\r" || data === "\n";
	});
}

export function formatGhostAcceptKeys(ghostAcceptKeys: readonly GhostAcceptKey[] | undefined): string {
	return normalizeGhostAcceptKeys(ghostAcceptKeys)
		.map((key) => {
			if (key === "space") return "Space";
			if (key === "right") return "Right";
			return "Enter";
		})
		.join("/");
}
