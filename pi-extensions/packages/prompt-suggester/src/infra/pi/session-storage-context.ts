import { createHash } from "node:crypto";
import path from "node:path";
import {
	ROOT_STATE_KEY,
	type SessionReadableManager,
	type SessionStorageContext,
} from "./session-state-types";

function storageKey(value: string): string {
	const normalized = value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
	const readable = normalized || "key";
	const hash = createHash("sha256")
		.update(value)
		.digest("base64url")
		.slice(0, 16);
	return `${readable}-${hash}`;
}

export function stateFilePath(interactionDir: string, key: string): string {
	return path.join(interactionDir, `${storageKey(key)}.json`);
}

export function createSessionStorageContext(
	projectStateDir: string,
	sessionManager: SessionReadableManager,
): SessionStorageContext {
	const sessionId = storageKey(sessionManager.getSessionId());
	const sessionFile = sessionManager.getSessionFile();
	const branch = sessionManager.getBranch();
	const lookupKeys = branch.map((entry) => entry.id).reverse();
	lookupKeys.push(ROOT_STATE_KEY);
	const currentKey = sessionManager.getLeafId() ?? ROOT_STATE_KEY;
	if (!sessionFile) {
		return {
			sessionId,
			sessionFile: undefined,
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
