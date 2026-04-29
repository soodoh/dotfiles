import { Key, matchesKey } from "@mariozechner/pi-tui";
export const DEFAULT_GHOST_ACCEPT_KEYS = ["right"];
export const DEFAULT_GHOST_ACCEPT_AND_SEND_KEYS = ["enter"];
function isGhostAcceptKey(value) {
    return value === "space" || value === "right" || value === "enter";
}
function normalizeGhostKeys(ghostKeys, defaults) {
    const normalized = (ghostKeys ?? defaults).filter((entry) => isGhostAcceptKey(entry));
    return normalized.length > 0 ? [...new Set(normalized)] : [...defaults];
}
export function normalizeGhostAcceptKeys(ghostAcceptKeys) {
    return normalizeGhostKeys(ghostAcceptKeys, DEFAULT_GHOST_ACCEPT_KEYS);
}
export function normalizeGhostAcceptAndSendKeys(ghostAcceptAndSendKeys) {
    return normalizeGhostKeys(ghostAcceptAndSendKeys, DEFAULT_GHOST_ACCEPT_AND_SEND_KEYS);
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
function formatGhostKeys(ghostKeys) {
    return ghostKeys
        .map((key) => {
        if (key === "space")
            return "Space";
        if (key === "right")
            return "Right";
        return "Enter";
    })
        .join("/");
}
export function formatGhostAcceptKeys(ghostAcceptKeys) {
    return formatGhostKeys(normalizeGhostAcceptKeys(ghostAcceptKeys));
}
export function formatGhostAcceptAndSendKeys(ghostAcceptAndSendKeys) {
    return formatGhostKeys(normalizeGhostAcceptAndSendKeys(ghostAcceptAndSendKeys));
}
