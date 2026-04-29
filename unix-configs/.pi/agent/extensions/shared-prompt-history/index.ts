import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import type { EditorTheme } from "@mariozechner/pi-tui";
import type { TUI } from "@mariozechner/pi-tui";
import type { KeybindingsManager } from "@mariozechner/pi-coding-agent/dist/core/keybindings.js";

import { appendPrompt, getPromptHistoryPath, readPromptHistory } from "./history-store";

class SharedPromptHistoryEditor extends CustomEditor {
  private readonly historyPath: string;
  private lastPersistedPrompt: string | undefined;
  private wrappedSubmit: ((text: string) => void | Promise<void>) | undefined;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, historyPath: string) {
    super(tui, theme, keybindings);
    this.historyPath = historyPath;
  }

  loadHistory(prompts: string[]): void {
    for (const prompt of prompts) {
      super.addToHistory(prompt);
      this.lastPersistedPrompt = prompt.trim();
    }
  }

  wrapOnSubmit(): void {
    const original = this.onSubmit;
    if (!original || original === this.wrappedSubmit) return;

    this.wrappedSubmit = async (text: string) => {
      await this.persistPrompt(text);
      await original(text);
    };
    this.onSubmit = this.wrappedSubmit;
  }

  override addToHistory(text: string): void {
    super.addToHistory(text);
    void this.persistPrompt(text);
  }

  private async persistPrompt(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || trimmed === this.lastPersistedPrompt) return;

    try {
      const appended = await appendPrompt(trimmed, this.historyPath);
      if (appended) this.lastPersistedPrompt = trimmed;
    } catch {
      // Prompt history should never interfere with submitting a message.
    }
  }
}

export default function sharedPromptHistory(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const historyPath = getPromptHistoryPath();
    const history = await readPromptHistory(historyPath);

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = new SharedPromptHistoryEditor(tui, theme, keybindings, historyPath);
      editor.loadHistory(history);

      // pi wires onSubmit immediately after this factory returns. Wrap it on the
      // next microtask so built-in slash commands are persisted too, not only the
      // paths where pi later calls addToHistory().
      queueMicrotask(() => editor.wrapOnSubmit());

      return editor;
    });
  });
}
