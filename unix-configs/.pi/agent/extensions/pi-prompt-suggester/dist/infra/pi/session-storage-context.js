import path from "node:path";
import { ROOT_STATE_KEY } from "./session-state-types.js";
export function normalizeSessionKey(value) {
    return value.replace(/[^A-Za-z0-9._-]/g, "_");
}
export function stateFilePath(interactionDir, key) {
    return path.join(interactionDir, `${normalizeSessionKey(key)}.json`);
}
export function createSessionStorageContext(projectStateDir, sessionManager) {
    const sessionId = normalizeSessionKey(sessionManager.getSessionId());
    const sessionFile = sessionManager.getSessionFile();
    const branch = sessionManager.getBranch();
    const lookupKeys = branch.map((entry) => entry.id).reverse();
    lookupKeys.push(ROOT_STATE_KEY);
    const currentKey = sessionManager.getLeafId() ?? ROOT_STATE_KEY;
    if (!sessionFile) {
        return {
            sessionId,
            sessionFile,
            lookupKeys,
            currentKey,
            persistent: false,
        };
    }
    const storageDir = path.join(projectStateDir, "sessions", sessionId);
    return {
        sessionId,
        sessionFile,
        storageDir,
        interactionDir: path.join(storageDir, "interaction"),
        usageFile: path.join(storageDir, "usage.json"),
        metaFile: path.join(storageDir, "meta.json"),
        lookupKeys,
        currentKey,
        persistent: true,
    };
}
