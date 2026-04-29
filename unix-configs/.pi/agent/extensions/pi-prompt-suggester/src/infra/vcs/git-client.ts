import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { VcsClient } from "../../app/ports/vcs-client.js";

const execFileAsync = promisify(execFile);

export class GitClient implements VcsClient {
	public constructor(private readonly cwd: string = process.cwd()) {}

	public async getHeadCommit(): Promise<string | null> {
		const result = await this.runGit(["rev-parse", "HEAD"]);
		return result?.trim() || null;
	}

	public async getChangedFilesSinceCommit(commit: string): Promise<string[]> {
		const result = await this.runGit(["diff", "--name-only", `${commit}...HEAD`]);
		if (!result) return [];
		return result
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((file) => path.normalize(file));
	}

	public async getDiffSummary(paths: string[], maxChars: number): Promise<string | undefined> {
		if (paths.length === 0) return undefined;
		const uniquePaths = Array.from(new Set(paths)).slice(0, 20);
		const stat = await this.runGit(["diff", "--stat", "--", ...uniquePaths]);
		const patch = await this.runGit(["diff", "--", ...uniquePaths]);
		const combined = [stat?.trim(), patch?.trim()].filter(Boolean).join("\n\n");
		if (!combined) return undefined;
		return combined.length > maxChars ? `${combined.slice(0, maxChars)}\n...[truncated]` : combined;
	}

	public async getWorkingTreeStatus(): Promise<string[]> {
		const result = await this.runGit(["status", "--porcelain"]);
		if (!result) return [];
		return result
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => path.normalize(line.slice(3)));
	}

	private async runGit(args: string[]): Promise<string | null> {
		try {
			const { stdout } = await execFileAsync("git", args, {
				cwd: this.cwd,
				maxBuffer: 1024 * 1024 * 10,
			});
			return stdout;
		} catch {
			return null;
		}
	}
}
