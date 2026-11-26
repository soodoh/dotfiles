import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	GIT_REFRESH_INTERVAL_MS,
	type GitStatus,
	getGitStatus,
	invalidateGit,
} from "./git-status";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pi-statusline-git-test-"));
	tempDirs.push(dir);
	return dir;
}

async function initRepo(dir: string): Promise<void> {
	await execFileAsync("git", ["init", "-b", "main"], { cwd: dir });
	await writeFile(join(dir, "tracked.txt"), "initial\n");
	await execFileAsync("git", ["add", "tracked.txt"], { cwd: dir });
	await execFileAsync(
		"git",
		[
			"-c",
			"user.email=test@example.com",
			"-c",
			"user.name=Test",
			"commit",
			"-m",
			"initial",
		],
		{ cwd: dir },
	);
}

async function waitForStatus(
	cwd: string,
	predicate: (status: GitStatus) => boolean,
	timeoutMs = 2000,
): Promise<GitStatus> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const status = getGitStatus(cwd, null, () => {});
		if (predicate(status)) return status;
		await new Promise((resolve) => setTimeout(resolve, 15));
	}
	return getGitStatus(cwd, null, () => {});
}

afterEach(async () => {
	invalidateGit();
	vi.restoreAllMocks();
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

describe("statusline git status cache", () => {
	test("reports branch and leading-column porcelain counts for staged, unstaged, and untracked files", async () => {
		const dir = await tempDir();
		await initRepo(dir);
		await writeFile(join(dir, "tracked.txt"), "modified\n");
		await writeFile(join(dir, "staged.txt"), "staged\n");
		await execFileAsync("git", ["add", "staged.txt"], { cwd: dir });
		await writeFile(join(dir, "untracked.txt"), "new\n");

		const onUpdate = vi.fn();
		const initial = getGitStatus(dir, "fallback", onUpdate);
		expect(initial).toEqual({
			branch: "fallback",
			staged: 0,
			unstaged: 0,
			untracked: 0,
		});

		const settled = await waitForStatus(
			dir,
			(s) => s.branch === "main" && s.unstaged === 1,
		);
		expect(settled).toEqual({
			branch: "main",
			staged: 1,
			unstaged: 1,
			untracked: 1,
		});
		expect(onUpdate).toHaveBeenCalled();
	});

	test("preserves leading porcelain space when the first entry is unstaged only", async () => {
		const dir = await tempDir();
		await initRepo(dir);
		await writeFile(join(dir, "tracked.txt"), "modified\n");

		const settled = await waitForStatus(
			dir,
			(s) => s.branch === "main" && s.unstaged === 1,
		);
		expect(settled).toEqual({
			branch: "main",
			staged: 0,
			unstaged: 1,
			untracked: 0,
		});
	});

	test("formats detached HEAD with short commit SHA", async () => {
		const dir = await tempDir();
		await initRepo(dir);
		const { stdout } = await execFileAsync(
			"git",
			["rev-parse", "--short", "HEAD"],
			{
				cwd: dir,
			},
		);
		const sha = stdout.trim();
		await execFileAsync("git", ["checkout", "--detach", "HEAD"], { cwd: dir });

		const settled = await waitForStatus(
			dir,
			(s) => s.branch === `${sha} (detached)`,
		);
		expect(settled.branch).toBe(`${sha} (detached)`);
	});

	test("delivers completion notifications to later callers joining an in-flight fetch", async () => {
		const dir = await tempDir();
		await initRepo(dir);
		await writeFile(join(dir, "tracked.txt"), "modified\n");

		const firstUpdate = vi.fn();
		const secondUpdate = vi.fn();
		getGitStatus(dir, null, firstUpdate);
		getGitStatus(dir, null, secondUpdate);

		const settled = await waitForStatus(
			dir,
			(s) => s.branch === "main" && s.unstaged === 1,
		);
		expect(settled.unstaged).toBe(1);
		expect(firstUpdate).toHaveBeenCalled();
		expect(secondUpdate).toHaveBeenCalled();
	});

	test("invalidateGit suppresses callbacks from superseded in-flight fetches and forces a fresh read", async () => {
		const dir = await tempDir();
		await initRepo(dir);

		const staleUpdate = vi.fn();
		getGitStatus(dir, null, staleUpdate);
		invalidateGit();

		await new Promise((resolve) => setTimeout(resolve, 150));
		expect(staleUpdate).not.toHaveBeenCalled();

		await writeFile(join(dir, "untracked.txt"), "after-invalidate\n");
		const freshUpdate = vi.fn();
		getGitStatus(dir, null, freshUpdate);
		const settled = await waitForStatus(
			dir,
			(s) => s.branch === "main" && s.untracked === 1,
		);
		expect(settled.untracked).toBe(1);
		expect(freshUpdate).toHaveBeenCalled();
	});

	test("falls back cleanly outside a git repository and honors TTL cache", async () => {
		const dir = await tempDir();
		const now = vi.spyOn(Date, "now");
		let clock = 100_000;
		now.mockImplementation(() => clock);

		const onUpdate = vi.fn();
		getGitStatus(dir, "provider-branch", onUpdate);
		await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled());

		expect(getGitStatus(dir, "provider-branch", vi.fn())).toEqual({
			branch: null,
			staged: 0,
			unstaged: 0,
			untracked: 0,
		});

		// Within TTL, no new refresh triggers.
		const cachedUpdate = vi.fn();
		clock += GIT_REFRESH_INTERVAL_MS - 1;
		getGitStatus(dir, "provider-branch", cachedUpdate);
		await new Promise((resolve) => setTimeout(resolve, 80));
		expect(cachedUpdate).not.toHaveBeenCalled();
	});
});
