import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";
import { readPromptHistory } from "./history-store";
import sharedPromptHistory from "./index";

type EditorFactory = NonNullable<
	Parameters<ExtensionContext["ui"]["setEditorComponent"]>[0]
>;
type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
const homes: string[] = [];
afterEach(async () => {
	await Promise.all(
		homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
	);
});

async function fixture(
	mode: ExtensionContext["mode"] = "tui",
	existing?: EditorFactory,
) {
	const home = await mkdtemp(join(tmpdir(), "pi-history-editor-"));
	homes.push(home);
	const historyPath = join(home, "history.jsonl");
	const handlers = new Map<string, Handler>();
	let command: Parameters<ExtensionAPI["registerCommand"]>[1] | undefined;
	let factory = existing;
	let editor: ReturnType<EditorFactory> | undefined;
	const submit = vi.fn();
	const setEditorComponent = vi.fn((value: EditorFactory | undefined) => {
		factory = value;
		if (!value) return;
		editor = Reflect.apply(value, undefined, [
			{},
			{},
			{ matches: () => false },
		]);
		if (editor) editor.onSubmit = submit;
	});
	const context = {
		mode,
		ui: {
			setEditorComponent,
			getEditorComponent: () => factory,
			custom: vi.fn(),
			notify: vi.fn(),
			setEditorText: vi.fn(),
		},
	} as unknown as ExtensionContext;
	sharedPromptHistory(
		{
			on: ((event: string, handler: Handler) => {
				handlers.set(event, handler);
				return () => {};
			}) as ExtensionAPI["on"],
			registerCommand: (_name, options) => {
				command = options;
			},
		},
		{ historyPath },
	);
	return {
		historyPath,
		context,
		submit,
		setEditorComponent,
		getEditor: () => editor,
		dispatch: (type: string, event = {}) =>
			handlers.get(type)?.({ type, ...event }, context),
		command: () =>
			command?.handler(
				"",
				context as Parameters<NonNullable<typeof command>["handler"]>[1],
			),
	};
}

function fakeEditor() {
	return {
		history: [] as string[],
		onSubmit: undefined as ((text: string) => void) | undefined,
		addToHistory(text: string) {
			this.history.unshift(text);
		},
		getText() {
			return "";
		},
		setText() {},
		handleInput() {},
		render() {
			return [];
		},
		invalidate() {},
	};
}

test("native interactive input persists queued prompts, not extension or RPC input", async () => {
	const f = await fixture();
	await f.dispatch("session_start");
	f.getEditor()?.addToHistory?.("transcript replay");
	await f.dispatch("input", {
		text: "queued follow-up",
		source: "interactive",
	});
	await f.dispatch("input", { text: "automation", source: "extension" });
	await f.dispatch("input", { text: "remote", source: "rpc" });
	await f.dispatch("session_shutdown");
	expect(await readPromptHistory(f.historyPath)).toEqual(["queued follow-up"]);
});

test("command interception is idempotent and draining includes the final command", async () => {
	const f = await fixture();
	await f.dispatch("session_start");
	const factory = f.context.ui.getEditorComponent();
	f.context.ui.setEditorComponent(factory);
	await Promise.resolve();
	f.getEditor()?.onSubmit?.("/quit");
	await f.dispatch("session_shutdown");
	expect(f.submit).toHaveBeenCalledOnce();
	expect(await readPromptHistory(f.historyPath)).toEqual(["/quit"]);
	expect(f.context.ui.setEditorComponent).toBe(f.setEditorComponent);
});

test("preserves earlier and later editor factories, including reset to default", async () => {
	const early = fakeEditor();
	const f = await fixture("tui", () => early);
	await writeFile(
		f.historyPath,
		`${JSON.stringify({ prompt: "existing prompt" })}\n`,
	);
	await f.dispatch("session_start");
	expect(f.getEditor()).toBe(early);
	expect(early.history).toEqual(["existing prompt"]);
	const later = fakeEditor();
	f.context.ui.setEditorComponent(() => later);
	await Promise.resolve();
	expect(f.getEditor()).toBe(later);
	expect(later.history).toEqual(["existing prompt"]);
	f.context.ui.setEditorComponent(undefined);
	await Promise.resolve();
	f.getEditor()?.onSubmit?.("/session");
	await f.dispatch("session_shutdown");
	expect(await readPromptHistory(f.historyPath)).toEqual([
		"existing prompt",
		"/session",
	]);
});

test.each(["rpc", "json", "print"] as const)(
	"%s neither installs a terminal editor nor opens the picker",
	async (mode) => {
		const f = await fixture(mode);
		await f.dispatch("session_start");
		await f.dispatch("input", { text: "not local", source: "interactive" });
		await f.command();
		await f.dispatch("session_shutdown");
		expect(f.setEditorComponent).not.toHaveBeenCalled();
		expect(f.context.ui.custom).not.toHaveBeenCalled();
		await expect(readFile(f.historyPath)).rejects.toMatchObject({
			code: "ENOENT",
		});
	},
);

test("failed persistence does not prevent command submission", async () => {
	const f = await fixture();
	await writeFile(f.historyPath, "malformed\n");
	await f.dispatch("session_start");
	await rm(f.historyPath);
	await mkdir(f.historyPath);
	f.getEditor()?.onSubmit?.("/name Work");
	await f.dispatch("session_shutdown");
	expect(f.submit).toHaveBeenCalledOnce();
});
