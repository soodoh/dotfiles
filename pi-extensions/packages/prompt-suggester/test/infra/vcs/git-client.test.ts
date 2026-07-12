import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { GitClient } from "../../../src/infra/vcs/git-client";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function createRepo(): Promise<string> {
	const repo = await mkdtemp(join(tmpdir(), "pi-git-client-test-"));
	tempDirs.push(repo);
	await execFileAsync("git", ["init"], { cwd: repo });
	await execFileAsync("git", ["config", "user.email", "test@example.com"], {
		cwd: repo,
	});
	await execFileAsync("git", ["config", "user.name", "Test User"], {
		cwd: repo,
	});
	await writeFile(join(repo, "tracked.txt"), "initial\n", "utf8");
	await execFileAsync("git", ["add", "tracked.txt"], { cwd: repo });
	await execFileAsync("git", ["commit", "-m", "initial"], { cwd: repo });
	return repo;
}

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

describe("GitClient", () => {
	test("reports modified and untracked working tree paths", async () => {
		const repo = await createRepo();
		await writeFile(join(repo, "tracked.txt"), "modified\n", "utf8");
		await writeFile(join(repo, "new-file.txt"), "new\n", "utf8");

		await expect(new GitClient(repo).getWorkingTreeStatus()).resolves.toEqual(
			expect.arrayContaining(["tracked.txt", "new-file.txt"]),
		);
	});

	test("reports renamed paths using machine-readable porcelain output", async () => {
		const repo = await createRepo();
		await execFileAsync("git", ["mv", "tracked.txt", "renamed.txt"], {
			cwd: repo,
		});

		await expect(new GitClient(repo).getWorkingTreeStatus()).resolves.toEqual([
			"renamed.txt",
		]);
	});

	test("preserves paths with spaces", async () => {
		const repo = await createRepo();
		await writeFile(join(repo, "file with spaces.txt"), "new\n", "utf8");

		await expect(new GitClient(repo).getWorkingTreeStatus()).resolves.toContain(
			normalize("file with spaces.txt"),
		);
	});
});
