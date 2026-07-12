import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { VcsClient } from "../../app/ports/vcs-client";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;

function parsePorcelainStatus(output: string): string[] {
	const paths: string[] = [];
	const records = output.split("\0").filter(Boolean);
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		if (record.length < 4) continue;
		paths.push(path.normalize(record.slice(3)));
		const status = record.slice(0, 2);
		if (status.includes("R") || status.includes("C")) index += 1;
	}
	return paths;
}

export class GitClient implements VcsClient {
	public constructor(private readonly cwd: string = process.cwd()) {}

	public async getHeadCommit(): Promise<string | null> {
		const result = await this.runGit(["rev-parse", "HEAD"]);
		return result?.trim() || null;
	}

	public async getChangedFilesSinceCommit(commit: string): Promise<string[]> {
		const result = await this.runGit([
			"diff",
			"--name-only",
			`${commit}...HEAD`,
		]);
		if (!result) return [];
		return result
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map((file) => path.normalize(file));
	}

	public async getDiffSummary(
		paths: string[],
		maxChars: number,
	): Promise<string | undefined> {
		if (paths.length === 0) return undefined;
		const uniquePaths = Array.from(new Set(paths)).slice(0, 20);
		const stat = await this.runGit(["diff", "--stat", "--", ...uniquePaths]);
		const patch = await this.runGit(["diff", "--", ...uniquePaths]);
		const combined = [stat?.trim(), patch?.trim()].filter(Boolean).join("\n\n");
		if (!combined) return undefined;
		return combined.length > maxChars
			? `${combined.slice(0, maxChars)}\n...[truncated]`
			: combined;
	}

	public async getWorkingTreeStatus(): Promise<string[]> {
		const result = await this.runGit(["status", "--porcelain=v1", "-z"]);
		return result ? parsePorcelainStatus(result) : [];
	}

	private async runGit(args: string[]): Promise<string | null> {
		try {
			const { stdout } = await execFileAsync("git", args, {
				cwd: this.cwd,
				maxBuffer: 1024 * 1024 * 10,
				timeout: GIT_TIMEOUT_MS,
			});
			return stdout;
		} catch {
			return null;
		}
	}
}
