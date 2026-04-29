import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
export function suggesterStateRoot(options = {}) {
    const home = options.home ?? homedir();
    return path.join(home, ".local", "state", "pi", "pi-prompt-suggester");
}
function sanitizeProjectName(value) {
    const sanitized = value.replace(/[^A-Za-z0-9._-]/g, "_");
    return sanitized || "project";
}
export function projectStateKey(cwd) {
    const resolved = path.resolve(cwd);
    const name = sanitizeProjectName(path.basename(resolved));
    const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 12);
    return `${name}-${hash}`;
}
export function projectStateDir(cwd, options = {}) {
    return path.join(suggesterStateRoot(options), "projects", projectStateKey(cwd));
}
