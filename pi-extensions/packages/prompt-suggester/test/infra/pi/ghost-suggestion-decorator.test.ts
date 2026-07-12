import { expect, test } from "vitest";
import {
	type EditorFactory,
	syncGhostEditorDecorator,
} from "../../../src/infra/pi/ghost-editor-installation";
import {
	decorateGhostSuggestionEditor,
	type GhostDecoratableEditor,
	type GhostSuggestionDecoratorOptions,
} from "../../../src/infra/pi/ghost-suggestion-decorator";

type OptionsOverrides = Partial<{
	active: boolean;
	suggestion: string;
	revision: number;
	ghostAcceptKeys: GhostSuggestionDecoratorOptions["ghostAcceptKeys"];
	ghostAcceptAndSendKeys: GhostSuggestionDecoratorOptions["ghostAcceptAndSendKeys"];
	prefillOnlyWhenEditorEmpty: boolean;
}>;

type FakeEditor = GhostDecoratableEditor & {
	text: string;
	cursor: { line: number; col: number };
	inputs: string[];
	submitted: string[];
};

function createOptions(overrides: OptionsOverrides = {}) {
	let active = overrides.active ?? true;
	let suggestion = overrides.suggestion ?? "hello world";
	let revision = overrides.revision ?? 1;
	return {
		options: {
			getSuggestion: () => suggestion,
			getSuggestionRevision: () => revision,
			ghostAcceptKeys: overrides.ghostAcceptKeys ?? ["right"],
			ghostAcceptAndSendKeys: overrides.ghostAcceptAndSendKeys ?? ["enter"],
			prefillOnlyWhenEditorEmpty: overrides.prefillOnlyWhenEditorEmpty ?? false,
			isActive: () => active,
		},
		setActive(next: boolean) {
			active = next;
		},
		setSuggestion(next: string) {
			suggestion = next;
			revision += 1;
		},
	};
}

function createFakeEditor(): FakeEditor {
	return {
		text: "",
		cursor: { line: 0, col: 0 },
		inputs: [],
		submitted: [],
		handleInput(data: string) {
			this.inputs.push(data);
			if (data === "\r") {
				this.submitted.push(this.text);
				this.setText("");
				return;
			}
			this.setText(`${this.text}${data}`);
		},
		render() {
			return ["top", ` ${this.text}\x1b[7m \x1b[27m`, "bottom"];
		},
		getText() {
			return this.text;
		},
		getCursor() {
			return this.cursor;
		},
		invalidate() {},
		setText(text: string) {
			this.text = text;
			this.cursor = { line: 0, col: text.length };
		},
	};
}

test("ghost decorator preserves the editor and delegates non-accept input", () => {
	const state = createOptions();
	const editor = createFakeEditor();
	const decorated = decorateGhostSuggestionEditor(editor, () => state.options);

	expect(decorated).toBe(editor);
	decorated.handleInput("x");

	expect(editor.inputs).toEqual(["x"]);
	expect(editor.getText()).toBe("x");
});

test("ghost decorator accepts suggestion without replacing editor behavior", () => {
	const state = createOptions();
	const editor = createFakeEditor();
	const decorated = decorateGhostSuggestionEditor(editor, () => state.options);

	decorated.handleInput("\x1b[C");

	expect(editor.getText()).toBe("hello world");
	expect(editor.inputs).toEqual([]);
});

test("ghost decorator accept-and-send materializes suggestion then delegates submit key", () => {
	const state = createOptions();
	const editor = createFakeEditor();
	const decorated = decorateGhostSuggestionEditor(editor, () => state.options);

	decorated.handleInput("\r");

	expect(editor.inputs).toEqual(["\r"]);
	expect(editor.submitted).toEqual(["hello world"]);
	expect(editor.getText()).toBe("");
});

test("ghost decorator can be deactivated without replacing the editor", () => {
	const state = createOptions({ active: false });
	const editor = createFakeEditor();
	const decorated = decorateGhostSuggestionEditor(editor, () => state.options);

	decorated.handleInput("\x1b[C");

	expect(editor.inputs).toEqual(["\x1b[C"]);
	expect(editor.getText()).not.toBe("hello world");
});

test("ghost decorator hides non-empty prefix suggestions when configured for empty-editor prefill", () => {
	const state = createOptions({ prefillOnlyWhenEditorEmpty: true });
	const editor = createFakeEditor();
	const decorated = decorateGhostSuggestionEditor(editor, () => state.options);

	decorated.setText("hello");

	expect(decorated.render(40)).toEqual([
		"top",
		" hello\x1b[7m \x1b[27m",
		"bottom",
	]);
});

test("ghost decorator installation wraps future editor factories instead of reinstalling on every sync", () => {
	const originalSetEditorCalls: EditorFactory[] = [];
	const ctx = {
		ui: {
			setEditorComponent(factory: EditorFactory | undefined) {
				if (factory) originalSetEditorCalls.push(factory);
			},
		},
	};
	const state = createOptions();

	syncGhostEditorDecorator({
		context: ctx,
		options: state.options,
	});
	expect(originalSetEditorCalls.length).toBe(1);

	syncGhostEditorDecorator({
		context: ctx,
		options: state.options,
	});
	expect(originalSetEditorCalls.length).toBe(1);

	const externalEditor = createFakeEditor();
	ctx.ui.setEditorComponent(() => externalEditor);
	expect(originalSetEditorCalls.length).toBe(2);

	const wrappedFactory = originalSetEditorCalls[1];
	const wrappedEditor: FakeEditor = Reflect.apply(wrappedFactory, undefined, [
		{},
		{},
		{},
	]);
	expect(wrappedEditor).toBe(externalEditor);

	wrappedEditor.handleInput("\x1b[C");
	expect(externalEditor.getText()).toBe("hello world");
});
