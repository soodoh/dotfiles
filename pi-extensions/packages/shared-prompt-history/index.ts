import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type Focusable,
	getKeybindings,
	Input,
	type SelectItem,
	SelectList,
	truncateToWidth,
} from "@earendil-works/pi-tui";

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

interface SharedPromptHistoryOptions {
	historyPath?: string;
	home?: string;
}

type SharedPromptHistoryCommandContext = Pick<ExtensionContext, "mode"> & {
	ui: Pick<ExtensionContext["ui"], "custom" | "notify" | "setEditorText">;
};

interface HistoryPickerTheme {
	title(text: string): string;
	muted(text: string): string;
	accent(text: string): string;
	warning(text: string): string;
}

interface HistoryPickerEntry extends PromptHistoryEntry {
	searchText: string;
	id: string;
}

class PromptHistoryPicker implements Component, Focusable {
	private readonly input = new Input();
	private readonly entriesById = new Map<string, HistoryPickerEntry>();
	private readonly totalCount: number;
	private list: SelectList;
	private matchingCount: number;
	private _focused = false;
	private filter = "";
	private matches: HistoryPickerEntry[] = [];

	constructor(
		entries: PromptHistoryEntry[],
		private readonly theme: HistoryPickerTheme,
		private readonly done: (prompt: string | null) => void,
		private readonly requestRender: () => void,
	) {
		const newestFirst = [...entries].reverse().map((entry, index) => ({
			...entry,
			id: String(index),
			searchText: `${entry.prompt}\n${entry.ts ?? ""}`.toLowerCase(),
		}));
		for (const entry of newestFirst) {
			this.entriesById.set(entry.id, entry);
		}
		this.matches = newestFirst;
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
		const kb = getKeybindings();
		if (
			kb.matches(data, "tui.select.up") ||
			kb.matches(data, "tui.select.down") ||
			kb.matches(data, "tui.select.confirm") ||
			kb.matches(data, "tui.select.cancel")
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
		const candidates = filter.startsWith(this.filter)
			? this.matches
			: this.entriesById.values();
		for (const entry of candidates) {
			if (!filter || entry.searchText.includes(filter)) {
				matchingEntries.push(entry);
			}
		}
		this.filter = filter;
		this.matches = matchingEntries;
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
	if (ctx.mode !== "tui") {
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

// Native TUI commands handled before AgentSession.prompt(), unlike templates
// and skills. Pi does not expose its built-in command catalogue to extensions.
const UI_COMMANDS = new Set(
	"settings scoped-models share copy session changelog hotkeys fork clone tree trust logout new reload debug arminsayshi dementedelves resume quit".split(
		" ",
	),
);
const UI_COMMANDS_WITH_ARGS = new Set(
	"model thinking export import bug name login compact".split(" "),
);

export default function sharedPromptHistory(
	pi: Pick<ExtensionAPI, "on" | "registerCommand" | "getCommands">,
	options: SharedPromptHistoryOptions = {},
) {
	const historyPath =
		options.historyPath ?? getPromptHistoryPath({ home: options.home });

	pi.registerCommand("history", {
		description: "Search and restore a saved prompt from shared history",
		handler: async (_args, ctx) => runHistoryCommand(ctx, historyPath),
	});

	const bypassesInput = (text: string): boolean => {
		const trimmed = text.trim();
		if (trimmed.startsWith("!") && trimmed.replace(/^!!?/, "").trim())
			return true;
		if (!trimmed.startsWith("/")) return false;
		const name = trimmed.slice(1).split(" ", 1)[0];
		return (
			UI_COMMANDS_WITH_ARGS.has(name) ||
			(UI_COMMANDS.has(name) && trimmed === `/${name}`) ||
			pi
				.getCommands()
				.some(
					(command) => command.source === "extension" && command.name === name,
				)
		);
	};

	let closed = false;
	let persistQueue = Promise.resolve();
	let restoreEditor: (() => void) | undefined;
	const persist = (text: string) => {
		if (closed || !text.trim()) return;
		persistQueue = persistQueue.then(async () => {
			try {
				await appendPrompt(text, historyPath);
			} catch {
				/* never prevent submission */
			}
		});
	};
	pi.on("input", (event, ctx) => {
		if (ctx.mode === "tui" && event.source === "interactive")
			persist(event.text);
	});
	pi.on("session_start", async (_event, ctx) => {
		if (closed || ctx.mode !== "tui") return;
		restoreEditor?.();
		let history: string[] = [];
		try {
			history = await readPromptHistory(historyPath);
		} catch {
			/* best effort */
		}
		const editorStates = new WeakMap<
			EditorInstance,
			{ loaded: boolean; wrapped?: SubmitHandler }
		>();
		const wrappers = new WeakMap<EditorFactory, EditorFactory>();
		const originalSet = ctx.ui.setEditorComponent;
		const fallback: EditorFactory = (tui, theme, kb) =>
			new CustomEditor(tui, theme, kb, { embedWorkingStatus: true });
		const install: typeof originalSet = (factory) => {
			const base = factory ?? fallback;
			let wrapped = wrappers.get(base);
			if (!wrapped) {
				wrapped = (tui, theme, kb) => {
					const editor = base(tui, theme, kb);
					let state = editorStates.get(editor);
					if (!state) {
						state = { loaded: false };
						editorStates.set(editor, state);
					}
					if (!state.loaded && editor.addToHistory) {
						for (const prompt of history) editor.addToHistory(prompt);
						state.loaded = true;
					}
					// Pi wires onSubmit after factory return. Only command submissions
					// bypassing input need interception; queued prompts use native input.
					const editorState = state;
					queueMicrotask(() => {
						if (closed) return;
						const original = editor.onSubmit;
						if (!original || original === editorState.wrapped) return;
						editorState.wrapped = (text) => {
							if (bypassesInput(text)) persist(text);
							return original.call(editor, text);
						};
						editor.onSubmit = editorState.wrapped;
					});
					return editor;
				};
				wrappers.set(base, wrapped);
				wrappers.set(wrapped, wrapped);
			}
			originalSet.call(ctx.ui, wrapped);
		};
		const existing = ctx.ui.getEditorComponent();
		ctx.ui.setEditorComponent = install;
		restoreEditor = () => {
			if (ctx.ui.setEditorComponent === install)
				ctx.ui.setEditorComponent = originalSet;
		};
		install(existing);
	});
	pi.on("session_shutdown", async () => {
		closed = true;
		restoreEditor?.();
		await persistQueue;
	});
}
