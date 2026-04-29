import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const HISTORY_FILE_NAME = "prompt-history.jsonl";

export interface PromptHistoryPathOptions {
  home?: string;
}

export function getPromptHistoryPath(options: PromptHistoryPathOptions = {}): string {
  const home = options.home ?? homedir();
  return join(home, ".local", "state", "pi", HISTORY_FILE_NAME);
}

export async function readPromptHistory(historyPath = getPromptHistoryPath()): Promise<string[]> {
  let contents: string;

  try {
    contents = await readFile(historyPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const prompts: string[] = [];

  for (const line of contents.split("\n")) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line) as { prompt?: unknown };
      if (typeof entry.prompt === "string" && entry.prompt.trim()) {
        prompts.push(entry.prompt);
      }
    } catch {
      // Ignore malformed lines so a partially written record never breaks startup.
    }
  }

  return prompts;
}

export async function appendPrompt(prompt: string, historyPath = getPromptHistoryPath()): Promise<boolean> {
  const trimmed = prompt.trim();
  if (!trimmed) return false;

  const existing = await readPromptHistory(historyPath);
  if (existing.at(-1) === trimmed) return false;

  await mkdir(dirname(historyPath), { recursive: true });
  await appendFile(
    historyPath,
    `${JSON.stringify({ ts: new Date().toISOString(), prompt: trimmed })}\n`,
    "utf8",
  );
  return true;
}
