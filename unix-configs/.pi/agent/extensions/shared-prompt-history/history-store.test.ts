import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";

import {
  appendPrompt,
  getPromptHistoryPath,
  readPromptHistory,
} from "./history-store";

const tempDirs: string[] = [];

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "pi-prompt-history-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
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

  test("skips blank prompts and consecutive duplicates", async () => {
    const dir = await makeTempDir();
    const historyPath = join(dir, "prompt-history.jsonl");

    await appendPrompt("same", historyPath);
    await appendPrompt("same", historyPath);
    await appendPrompt("   ", historyPath);
    await appendPrompt("different", historyPath);

    await expect(readPromptHistory(historyPath)).resolves.toEqual(["same", "different"]);
  });

  test("ignores malformed JSONL records while reading", async () => {
    const dir = await makeTempDir();
    const historyPath = join(dir, "prompt-history.jsonl");

    await Bun.write(
      historyPath,
      '{"prompt":"valid"}\nnot-json\n{"prompt":42}\n{"prompt":"also valid"}\n',
    );

    await expect(readPromptHistory(historyPath)).resolves.toEqual(["valid", "also valid"]);
  });
});
