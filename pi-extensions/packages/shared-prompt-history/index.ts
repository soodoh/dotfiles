import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import {
	type Component,
	type Focusable,
	Input,
	Key,
	matchesKey,
	type SelectItem,
	SelectList,
	truncateToWidth,
} from "@mariozechner/pi-tui";

import {
	appendPrompt,
	getPromptHistoryPath,
	type PromptHistoryEntry,
	readAllPromptHistory,
	readPromptHistory,
} from "./history-store";

type EditorFactory = NonNullable<
	Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]
>;

type EditorInstance = ReturnType<EditorFactory>;

type SubmitHandler = (text: string) => void | Promise<void>;

interface SharedPromptHistoryState {
	loaded: boolean;
	lastPersistedPrompt: string | undefined;
	persistQueue: Promise<void>;
	wrappedSubmit: SubmitHandler | undefined;
}

interface SharedPromptHistoryOptions {
	historyPath?: string;
	home?: string;
}

type SharedPromptHistoryContext = {
	ui: Pick<ExtensionContext["ui"], "setEditorComponent">;
};

type SharedPromptHistoryCommandContext = Pick<ExtensionContext, "hasUI"> & {
	ui: Pick<ExtensionContext["ui"], "custom" | "notify" | "setEditorText">;
};

type SharedPromptHistoryApi = {
	on(
		event: "session_start",
		handler: (
			event: unknown,
			ctx: SharedPromptHistoryContext,
		) => void | Promise<void>,
	): void;
	registerCommand(
		name: string,
		options: {
			description?: string;
			handler: (
				args: string,
				ctx: SharedPromptHistoryCommandContext,
			) => Promise<void>;
		},
	): void;
};

class SharedPromptHistoryEditor extends CustomEditor {}

const editorStates = new WeakMap<object, SharedPromptHistoryState>();

function getState(editor: EditorInstance): SharedPromptHistoryState {
	const state = editorStates.get(editor);
	if (state) return state;

	const nextState: SharedPromptHistoryState = {
		loaded: false,
		lastPersistedPrompt: undefined,
		persistQueue: Promise.resolve(),
		wrappedSubmit: undefined,
	};
	editorStates.set(editor, nextState);
	return nextState;
}

function getSubmitHandler(editor: EditorInstance): SubmitHandler | undefined {
	const value = Reflect.get(editor, "onSubmit");
	return typeof value === "function" ? value.bind(editor) : undefined;
}

function setSubmitHandler(
	editor: EditorInstance,
	handler: SubmitHandler,
): void {
	Reflect.set(editor, "onSubmit", handler);
}

function loadHistory(editor: EditorInstance, prompts: string[]): void {
	const state = getState(editor);
	const addToHistory = Reflect.get(editor, "addToHistory");
	if (state.loaded || typeof addToHistory !== "function") return;

	for (const prompt of prompts) {
		addToHistory.call(editor, prompt);
		state.lastPersistedPrompt = prompt.trim();
	}
	state.loaded = true;
}

async function persistPrompt(
	editor: EditorInstance,
	text: string,
	historyPath: string,
): Promise<void> {
	const state = getState(editor);
	const trimmed = text.trim();
	if (!trimmed || trimmed === state.lastPersistedPrompt) return;

	const previousPrompt = state.lastPersistedPrompt;
	state.lastPersistedPrompt = trimmed;
	try {
		await appendPrompt(trimmed, historyPath, {
			lastPersistedPrompt: previousPrompt,
		});
	} catch {
		if (state.lastPersistedPrompt === trimmed) {
			state.lastPersistedPrompt = previousPrompt;
		}
		// Prompt history should never interfere with submitting a message.
	}
}

function wrapOnSubmit(editor: EditorInstance, historyPath: string): void {
	const state = getState(editor);
	const original = getSubmitHandler(editor);
	if (!original || original === state.wrappedSubmit) return;

	state.wrappedSubmit = (text: string) => {
		state.persistQueue = state.persistQueue.then(
			() => persistPrompt(editor, text, historyPath),
			() => persistPrompt(editor, text, historyPath),
		);
		void state.persistQueue;
		return original(text);
	};
	setSubmitHandler(editor, state.wrappedSubmit);
}

function enhanceEditor(
	editor: EditorInstance,
	prompts: string[],
	historyPath: string,
): void {
	loadHistory(editor, prompts);

	// pi wires onSubmit immediately after an editor factory returns. Wrap it on the
	// next microtask so built-in slash commands are persisted too, not only paths
	// where pi later calls addToHistory().
	queueMicrotask(() => wrapOnSubmit(editor, historyPath));
}

interface HistoryPickerTheme {
	title(text: string): string;
	muted(text: string): string;
	accent(text: string): string;
	warning(text: string): string;
}

interface HistoryPickerEntry extends PromptHistoryEntry {
	id: string;
}

class PromptHistoryPicker implements Component, Focusable {
	private readonly input = new Input();
	private readonly entriesById = new Map<string, HistoryPickerEntry>();
	private readonly totalCount: number;
	private list: SelectList;
	private matchingCount: number;
	private _focused = false;

	constructor(
		entries: PromptHistoryEntry[],
		private readonly theme: HistoryPickerTheme,
		private readonly done: (prompt: string | null) => void,
		private readonly requestRender: () => void,
	) {
		const newestFirst = [...entries].reverse().map((entry, index) => ({
			...entry,
			id: String(index),
		}));
		for (const entry of newestFirst) {
			this.entriesById.set(entry.id, entry);
		}
		this.totalCount = newestFirst.length;
		this.list = this.createList(newestFirst);
		this.matchingCount = newestFirst.length;
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.done(null);
			return;
		}

		if (
			matchesKey(data, Key.up) ||
			matchesKey(data, Key.down) ||
			matchesKey(data, Key.enter) ||
			matchesKey(data, Key.return)
		) {
			this.list.handleInput(data);
			this.requestRender();
			return;
		}

		const previousFilter = this.input.getValue();
		this.input.handleInput(data);
		if (this.input.getValue() !== previousFilter) {
			this.applyFilter();
		}
		this.requestRender();
	}

	render(width: number): string[] {
		const title = `Prompt History (${this.matchingCount}/${this.totalCount})`;
		const lines = [
			truncateToWidth(this.theme.title(title), width, ""),
			truncateToWidth(
				this.theme.muted("Type to search all saved prompts."),
				width,
				"",
			),
			...this.input
				.render(width)
				.map((line) => truncateToWidth(line, width, "")),
			...this.list
				.render(width)
				.map((line) => truncateToWidth(line, width, "")),
			truncateToWidth(
				this.theme.muted("↑↓ navigate • enter restore to editor • esc cancel"),
				width,
				"",
			),
		];
		return lines;
	}

	invalidate(): void {
		this.input.invalidate();
		this.list.invalidate();
	}

	private applyFilter(): void {
		const filter = this.input.getValue().trim().toLowerCase();
		const matchingEntries: HistoryPickerEntry[] = [];
		for (const entry of this.entriesById.values()) {
			const timestamp = entry.ts ?? "";
			const haystack = `${entry.prompt}\n${timestamp}`.toLowerCase();
			if (!filter || haystack.includes(filter)) {
				matchingEntries.push(entry);
			}
		}
		this.matchingCount = matchingEntries.length;
		this.list = this.createList(matchingEntries);
	}

	private createList(entries: HistoryPickerEntry[]): SelectList {
		const items: SelectItem[] = entries.map((entry) => ({
			value: entry.id,
			label: promptPreview(entry.prompt),
			description: entry.ts,
		}));

		const list = new SelectList(
			items,
			12,
			{
				selectedPrefix: this.theme.accent,
				selectedText: this.theme.accent,
				description: this.theme.muted,
				scrollInfo: this.theme.muted,
				noMatch: () => this.theme.warning("  No matching prompts"),
			},
			{ minPrimaryColumnWidth: 48, maxPrimaryColumnWidth: 72 },
		);
		list.onSelect = (item) => {
			const entry = this.entriesById.get(item.value);
			this.done(entry?.prompt ?? null);
		};
		list.onCancel = () => this.done(null);
		return list;
	}
}

function promptPreview(prompt: string): string {
	return prompt.replace(/[\r\n]+/g, " ").trim();
}

async function runHistoryCommand(
	ctx: SharedPromptHistoryCommandContext,
	historyPath: string,
): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("/history is only available in interactive mode.", "warning");
		return;
	}

	let entries: PromptHistoryEntry[];
	try {
		entries = await readAllPromptHistory(historyPath);
	} catch (error) {
		const message = error instanceof Error ? error.message : "unknown error";
		ctx.ui.notify(`Failed to read prompt history: ${message}`, "error");
		return;
	}

	if (entries.length === 0) {
		ctx.ui.notify("No prompt history found.", "info");
		return;
	}

	const selectedPrompt = await ctx.ui.custom<string | null>(
		(tui, theme, _keybindings, done) =>
			new PromptHistoryPicker(
				entries,
				{
					title: (text) => theme.fg("accent", theme.bold(text)),
					muted: (text) => theme.fg("muted", text),
					accent: (text) => theme.fg("accent", text),
					warning: (text) => theme.fg("warning", text),
				},
				done,
				() => tui.requestRender(),
			),
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "90%",
				maxHeight: "80%",
				margin: 2,
			},
		},
	);

	if (selectedPrompt) {
		ctx.ui.setEditorText(selectedPrompt);
	}
}

export default function sharedPromptHistory(
	pi: SharedPromptHistoryApi,
	options: SharedPromptHistoryOptions = {},
) {
	const historyPath =
		options.historyPath ?? getPromptHistoryPath({ home: options.home });

	pi.registerCommand("history", {
		description: "Search and restore a saved prompt from shared history",
		handler: async (_args, ctx) => runHistoryCommand(ctx, historyPath),
	});

	pi.on("session_start", async (_event, ctx) => {
		let history: string[] = [];
		try {
			history = await readPromptHistory(historyPath);
		} catch {
			// Shared history should never prevent editor installation.
		}

		const originalSetEditorComponent = ctx.ui.setEditorComponent.bind(ctx.ui);
		ctx.ui.setEditorComponent = (factory) => {
			originalSetEditorComponent(
				factory
					? (tui, theme, keybindings) => {
							const editor = factory(tui, theme, keybindings);
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
