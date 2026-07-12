import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

interface StateRootOptions {
	home?: string;
}

function suggesterStateRoot(options: StateRootOptions = {}): string {
	const home = options.home ?? homedir();
	return path.join(home, ".local", "state", "pi", "pi-prompt-suggester");
}

function sanitizeProjectName(value: string): string {
	const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "_");
	return sanitized || "project";
}

function projectStateKey(cwd: string): string {
	const resolved = path.resolve(cwd);
	const name = sanitizeProjectName(path.basename(resolved));
	const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 12);
	return `${name}-${hash}`;
}

export function projectStateDir(
	cwd: string,
	options: StateRootOptions = {},
): string {
	return path.join(
		suggesterStateRoot(options),
		"projects",
		projectStateKey(cwd),
	);
}
