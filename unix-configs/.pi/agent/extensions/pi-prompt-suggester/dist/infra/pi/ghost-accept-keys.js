import { Key, matchesKey } from "@mariozechner/pi-tui";
export const DEFAULT_GHOST_ACCEPT_KEYS = ["space"];
function isGhostAcceptKey(value) {
    return value === "space" || value === "right" || value === "enter";
}
export function normalizeGhostAcceptKeys(ghostAcceptKeys) {
    const normalized = (ghostAcceptKeys ?? DEFAULT_GHOST_ACCEPT_KEYS).filter((entry) => isGhostAcceptKey(entry));
    return normalized.length > 0 ? [...new Set(normalized)] : [...DEFAULT_GHOST_ACCEPT_KEYS];
}
export function matchesGhostAcceptKey(data, ghostAcceptKeys) {
    return normalizeGhostAcceptKeys(ghostAcceptKeys).some((key) => {
        if (key === "space")
            return matchesKey(data, Key.space);
        if (key === "right")
            return matchesKey(data, Key.right);
        return matchesKey(data, Key.enter) || matchesKey(data, Key.return) || data === "\r" || data === "\n";
    });
}
export function formatGhostAcceptKeys(ghostAcceptKeys) {
    return normalizeGhostAcceptKeys(ghostAcceptKeys)
        .map((key) => {
        if (key === "space")
            return "Space";
        if (key === "right")
            return "Right";
        return "Enter";
    })
        .join("/");
}
