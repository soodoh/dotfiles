import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("@mariozechner/pi-coding-agent", async () =>
  import("/Users/pauldiloreto/.local/share/fnm/node-versions/v24.15.0/installation/lib/node_modules/@mariozechner/pi-coding-agent/dist/index.js"),
);

const { default: sharedPromptHistory } = await import("./index");
const { getPromptHistoryPath } = await import("./history-store");

let originalHistory: string | undefined;
let historyIsIsolated = false;

async function isolatePromptHistory() {
  if (historyIsIsolated) return;

  try {
    originalHistory = await readFile(getPromptHistoryPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    originalHistory = undefined;
  }

  await rm(getPromptHistoryPath(), { force: true });
  historyIsIsolated = true;
}

async function registerExtension(ctx: unknown) {
  let sessionStart: ((event: unknown, ctx: unknown) => Promise<void>) | undefined;
  sharedPromptHistory({
    on(event: string, handler: typeof sessionStart) {
      if (event === "session_start") sessionStart = handler;
    },
  } as never);

  await sessionStart?.({}, ctx);
}

async function createEditor(onSubmit?: (text: string) => void | Promise<void>) {
  let factory: ((tui: unknown, theme: unknown, keybindings: unknown) => unknown) | undefined;
  await registerExtension({
    ui: {
      setEditorComponent(value: typeof factory) {
        factory = value;
      },
    },
  });

  if (!factory) throw new Error("editor factory was not registered");
  const editor = factory({}, {}, { matches: () => false }) as {
    addToHistory(text: string): void;
    onSubmit?: (text: string) => void | Promise<void>;
  };
  if (onSubmit) editor.onSubmit = onSubmit;

  await new Promise((resolve) => queueMicrotask(resolve));
  return editor;
}

afterEach(async () => {
  if (!historyIsIsolated) return;

  if (originalHistory === undefined) {
    await rm(getPromptHistoryPath(), { force: true });
  } else {
    await mkdir(dirname(getPromptHistoryPath()), { recursive: true });
    await writeFile(getPromptHistoryPath(), originalHistory, "utf8");
  }

  originalHistory = undefined;
  historyIsIsolated = false;
});

describe("shared prompt history extension", () => {
  test("does not persist history entries replayed by pi", async () => {
    await isolatePromptHistory();
    const editor = await createEditor();

    editor.addToHistory("expanded session prompt replayed on startup");
    await new Promise((resolve) => setTimeout(resolve, 10));

    await expect(readFile(getPromptHistoryPath(), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("persists prompts submitted through the editor", async () => {
    await isolatePromptHistory();
    const editor = await createEditor(async () => {});

    await editor.onSubmit?.("submitted prompt");

    await expect(readFile(getPromptHistoryPath(), "utf8")).resolves.toContain("submitted prompt");
  });

  test("loads shared history into editor components registered by later extensions", async () => {
    await isolatePromptHistory();
    await writeFile(getPromptHistoryPath(), JSON.stringify({ prompt: "existing prompt" }) + "\n", "utf8");

    let factory: ((tui: unknown, theme: unknown, keybindings: unknown) => unknown) | undefined;
    const ctx = {
      ui: {
        setEditorComponent(value: typeof factory) {
          factory = value;
        },
      },
    };

    await registerExtension(ctx);
    ctx.ui.setEditorComponent(() => ({
      history: [] as string[],
      addToHistory(text: string) {
        this.history.unshift(text.trim());
      },
    }));

    const editor = factory?.({}, {}, {}) as { history: string[] } | undefined;

    expect(editor?.history).toEqual(["existing prompt"]);
  });
});
