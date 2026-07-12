import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { parseGitStatus, runGit } from "./git-status";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pi-statusline-git-test-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

describe("statusline git helpers", () => {
	test("parses porcelain status counts", () => {
		expect(parseGitStatus(" M file.txt\nA  staged.txt\n?? new.txt\n")).toEqual({
			staged: 1,
			unstaged: 1,
			untracked: 1,
		});
	});

	test("bounds captured git stdout", async () => {
		const dir = await tempDir();
		await execFileAsync("git", ["init"], { cwd: dir });
		for (let index = 0; index < 20; index += 1) {
			await writeFile(join(dir, `untracked-${index}.txt`), "x", "utf8");
		}

		await expect(
			runGit(dir, ["status", "--porcelain"], 1000, 128),
		).resolves.toBeNull();
	});
});
