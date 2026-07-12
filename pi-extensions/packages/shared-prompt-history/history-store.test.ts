import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
	appendPrompt,
	getPromptHistoryPath,
	readAllPromptHistory,
	readPromptHistory,
} from "./history-store";

const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await mkdtemp(join(tmpdir(), "pi-prompt-history-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

describe("shared prompt history store", () => {
	test("uses ~/.local/state/pi/prompt-history.jsonl by default", () => {
		expect(getPromptHistoryPath({ home: "/home/alice" })).toBe(
			"/home/alice/.local/state/pi/prompt-history.jsonl",
		);
	});

	test("appends trimmed prompts and reads newest-compatible chronological history", async () => {
		const dir = await makeTempDir();
		const historyPath = join(dir, "prompt-history.jsonl");

		await appendPrompt("  first prompt  ", historyPath);
		await appendPrompt("second prompt", historyPath);

		await expect(readPromptHistory(historyPath)).resolves.toEqual([
			"first prompt",
			"second prompt",
		]);
	});

	test("writes prompt history with private permissions", async () => {
		const dir = await makeTempDir();
		const historyPath = join(dir, "private", "prompt-history.jsonl");

		await appendPrompt("secret prompt", historyPath);

		expect((await stat(join(dir, "private"))).mode & 0o777).toBe(0o700);
		expect((await stat(historyPath)).mode & 0o777).toBe(0o600);
	});

	test("skips blank prompts and consecutive duplicates", async () => {
		const dir = await makeTempDir();
		const historyPath = join(dir, "prompt-history.jsonl");

		await appendPrompt("same", historyPath);
		await appendPrompt("same", historyPath);
		await appendPrompt("   ", historyPath);
		await appendPrompt("different", historyPath);

		await expect(readPromptHistory(historyPath)).resolves.toEqual([
			"same",
			"different",
		]);
	});

	test("suppresses duplicates from the last existing record without loading full history", async () => {
		const dir = await makeTempDir();
		const historyPath = join(dir, "prompt-history.jsonl");
		await writeFile(
			historyPath,
			`${JSON.stringify({ prompt: "first" })}\nnot-json\n${JSON.stringify({ prompt: "same" })}\n`,
			"utf8",
		);

		await expect(appendPrompt("same", historyPath)).resolves.toBe(false);
		await expect(appendPrompt("different", historyPath)).resolves.toBe(true);

		await expect(readPromptHistory(historyPath)).resolves.toEqual([
			"first",
			"same",
			"different",
		]);
	});

	test("treats duplicate detection as empty when the tail cap has no valid prompt", async () => {
		const dir = await makeTempDir();
		const historyPath = join(dir, "prompt-history.jsonl");
		await writeFile(
			historyPath,
			`${JSON.stringify({ prompt: "same" })}\n${"not-json\n".repeat(70_000)}unterminated`,
			"utf8",
		);

		await expect(appendPrompt("same", historyPath)).resolves.toBe(true);
	});

	test("suppresses duplicates when multiple editor states supply stale previous prompts", async () => {
		const dir = await makeTempDir();
		const historyPath = join(dir, "prompt-history.jsonl");
		await appendPrompt("old", historyPath);

		const staleEditorState = { lastPersistedPrompt: "old" };
		await expect(
			appendPrompt("same", historyPath, staleEditorState),
		).resolves.toBe(true);
		await expect(
			appendPrompt("same", historyPath, staleEditorState),
		).resolves.toBe(false);

		await expect(readPromptHistory(historyPath)).resolves.toEqual([
			"old",
			"same",
		]);
	});

	test("ignores malformed JSONL records while reading", async () => {
		const dir = await makeTempDir();
		const historyPath = join(dir, "prompt-history.jsonl");

		await writeFile(
			historyPath,
			'{"prompt":"valid"}\nnot-json\n{"prompt":42}\n{"prompt":"also valid"}\n',
			"utf8",
		);

		await expect(readPromptHistory(historyPath)).resolves.toEqual([
			"valid",
			"also valid",
		]);
	});

	test("reads only a bounded tail while appends still use the latest prompt", async () => {
		const dir = await makeTempDir();
		const historyPath = join(dir, "prompt-history.jsonl");
		const records = Array.from({ length: 10 }, (_, index) =>
			JSON.stringify({ prompt: `prompt-${index + 1}` }),
		).join("\n");
		await writeFile(historyPath, `${records}\n`, "utf8");

		await expect(
			readPromptHistory(historyPath, { maxPrompts: 3 }),
		).resolves.toEqual(["prompt-8", "prompt-9", "prompt-10"]);
		await expect(appendPrompt("prompt-10", historyPath)).resolves.toBe(false);
		await expect(appendPrompt("prompt-11", historyPath)).resolves.toBe(true);
		await expect(
			readPromptHistory(historyPath, { maxPrompts: 2 }),
		).resolves.toEqual(["prompt-10", "prompt-11"]);
	});

	test("reads every saved prompt for searchable history", async () => {
		const dir = await makeTempDir();
		const historyPath = join(dir, "prompt-history.jsonl");
		const records = Array.from({ length: 205 }, (_, index) =>
			JSON.stringify({
				ts: `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
				prompt: `prompt-${index + 1}`,
			}),
		).join("\n");
		await writeFile(historyPath, `${records}\nnot-json\n`, "utf8");

		await expect(readAllPromptHistory(historyPath)).resolves.toHaveLength(205);
		await expect(readAllPromptHistory(historyPath)).resolves.toContainEqual({
			ts: "2026-01-01T00:00:00.000Z",
			prompt: "prompt-1",
		});
	});

	test("propagates filesystem errors other than a missing history file", async () => {
		const dir = await makeTempDir();

		await expect(readPromptHistory(dir)).rejects.toThrow();
	});
});
