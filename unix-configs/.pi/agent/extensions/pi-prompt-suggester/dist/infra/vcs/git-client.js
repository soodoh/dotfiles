import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
const execFileAsync = promisify(execFile);
export class GitClient {
    cwd;
    constructor(cwd = process.cwd()) {
        this.cwd = cwd;
    }
    async getHeadCommit() {
        const result = await this.runGit(["rev-parse", "HEAD"]);
        return result?.trim() || null;
    }
    async getChangedFilesSinceCommit(commit) {
        const result = await this.runGit(["diff", "--name-only", `${commit}...HEAD`]);
        if (!result)
            return [];
        return result
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((file) => path.normalize(file));
    }
    async getDiffSummary(paths, maxChars) {
        if (paths.length === 0)
            return undefined;
        const uniquePaths = Array.from(new Set(paths)).slice(0, 20);
        const stat = await this.runGit(["diff", "--stat", "--", ...uniquePaths]);
        const patch = await this.runGit(["diff", "--", ...uniquePaths]);
        const combined = [stat?.trim(), patch?.trim()].filter(Boolean).join("\n\n");
        if (!combined)
            return undefined;
        return combined.length > maxChars ? `${combined.slice(0, maxChars)}\n...[truncated]` : combined;
    }
    async getWorkingTreeStatus() {
        const result = await this.runGit(["status", "--porcelain"]);
        if (!result)
            return [];
        return result
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => path.normalize(line.slice(3)));
    }
    async runGit(args) {
        try {
            const { stdout } = await execFileAsync("git", args, {
                cwd: this.cwd,
                maxBuffer: 1024 * 1024 * 10,
            });
            return stdout;
        }
        catch {
            return null;
        }
    }
}
