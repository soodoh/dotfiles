import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import type { EditorTheme } from "@mariozechner/pi-tui";
import type { TUI } from "@mariozechner/pi-tui";
import type { KeybindingsManager } from "@mariozechner/pi-coding-agent/dist/core/keybindings.js";

import { appendPrompt, getPromptHistoryPath, readPromptHistory } from "./history-store";

type HistoryCapableEditor = {
  addToHistory?: (text: string) => void;
  onSubmit?: (text: string) => void | Promise<void>;
};

interface SharedPromptHistoryState {
  loaded: boolean;
  lastPersistedPrompt: string | undefined;
  wrappedSubmit: ((text: string) => void | Promise<void>) | undefined;
}

const sharedPromptHistoryState = Symbol("sharedPromptHistoryState");

class SharedPromptHistoryEditor extends CustomEditor {}

function getState(editor: HistoryCapableEditor): SharedPromptHistoryState {
  const state = Reflect.get(editor, sharedPromptHistoryState) as SharedPromptHistoryState | undefined;
  if (state) return state;

  const nextState: SharedPromptHistoryState = {
    loaded: false,
    lastPersistedPrompt: undefined,
    wrappedSubmit: undefined,
  };
  Reflect.set(editor, sharedPromptHistoryState, nextState);
  return nextState;
}

function loadHistory(editor: HistoryCapableEditor, prompts: string[]): void {
  const state = getState(editor);
  if (state.loaded || typeof editor.addToHistory !== "function") return;

  for (const prompt of prompts) {
    editor.addToHistory(prompt);
    state.lastPersistedPrompt = prompt.trim();
  }
  state.loaded = true;
}

async function persistPrompt(editor: HistoryCapableEditor, text: string, historyPath: string): Promise<void> {
  const state = getState(editor);
  const trimmed = text.trim();
  if (!trimmed || trimmed === state.lastPersistedPrompt) return;

  try {
    const appended = await appendPrompt(trimmed, historyPath);
    if (appended) state.lastPersistedPrompt = trimmed;
  } catch {
    // Prompt history should never interfere with submitting a message.
  }
}

function wrapOnSubmit(editor: HistoryCapableEditor, historyPath: string): void {
  const state = getState(editor);
  const original = editor.onSubmit;
  if (!original || original === state.wrappedSubmit) return;

  state.wrappedSubmit = async (text: string) => {
    await persistPrompt(editor, text, historyPath);
    await original(text);
  };
  editor.onSubmit = state.wrappedSubmit;
}

function enhanceEditor(editor: HistoryCapableEditor, prompts: string[], historyPath: string): void {
  loadHistory(editor, prompts);

  // pi wires onSubmit immediately after an editor factory returns. Wrap it on the
  // next microtask so built-in slash commands are persisted too, not only paths
  // where pi later calls addToHistory().
  queueMicrotask(() => wrapOnSubmit(editor, historyPath));
}

export default function sharedPromptHistory(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const historyPath = getPromptHistoryPath();
    const history = await readPromptHistory(historyPath);

    const originalSetEditorComponent = ctx.ui.setEditorComponent.bind(ctx.ui);
    ctx.ui.setEditorComponent = (factory) => {
      originalSetEditorComponent(
        factory
          ? (tui, theme, keybindings) => {
              const editor = factory(tui, theme, keybindings) as HistoryCapableEditor;
              enhanceEditor(editor, history, historyPath);
              return editor;
            }
          : undefined,
      );
    };

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = new SharedPromptHistoryEditor(tui, theme, keybindings);
      enhanceEditor(editor, history, historyPath);
      return editor;
    });
  });
}
