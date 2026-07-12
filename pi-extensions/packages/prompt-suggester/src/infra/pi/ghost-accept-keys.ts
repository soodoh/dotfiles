import { Key, matchesKey } from "@mariozechner/pi-tui";
import type { GhostAcceptKey } from "../../config/types";

const DEFAULT_GHOST_ACCEPT_KEYS: readonly GhostAcceptKey[] = ["right"];
const DEFAULT_GHOST_ACCEPT_AND_SEND_KEYS: readonly GhostAcceptKey[] = ["enter"];

function isGhostAcceptKey(value: unknown): value is GhostAcceptKey {
	return value === "space" || value === "right" || value === "enter";
}

function normalizeGhostKeys(
	ghostKeys: readonly GhostAcceptKey[] | undefined,
	defaults: readonly GhostAcceptKey[],
): GhostAcceptKey[] {
	const normalized = (ghostKeys ?? defaults).filter(
		(entry): entry is GhostAcceptKey => isGhostAcceptKey(entry),
	);
	return normalized.length > 0 ? [...new Set(normalized)] : [...defaults];
}

function normalizeGhostAcceptKeys(
	ghostAcceptKeys: readonly GhostAcceptKey[] | undefined,
): GhostAcceptKey[] {
	return normalizeGhostKeys(ghostAcceptKeys, DEFAULT_GHOST_ACCEPT_KEYS);
}

export function normalizeGhostAcceptAndSendKeys(
	ghostAcceptAndSendKeys: readonly GhostAcceptKey[] | undefined,
): GhostAcceptKey[] {
	return normalizeGhostKeys(
		ghostAcceptAndSendKeys,
		DEFAULT_GHOST_ACCEPT_AND_SEND_KEYS,
	);
}

export function matchesGhostAcceptKey(
	data: string,
	ghostAcceptKeys: readonly GhostAcceptKey[] | undefined,
): boolean {
	return normalizeGhostAcceptKeys(ghostAcceptKeys).some((key) => {
		if (key === "space") return matchesKey(data, Key.space);
		if (key === "right") return matchesKey(data, Key.right);
		return (
			matchesKey(data, Key.enter) ||
			matchesKey(data, Key.return) ||
			data === "\r" ||
			data === "\n"
		);
	});
}
