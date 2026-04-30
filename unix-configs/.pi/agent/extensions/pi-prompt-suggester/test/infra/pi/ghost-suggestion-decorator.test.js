import assert from "node:assert/strict";
import test from "node:test";
import { syncGhostEditorDecorator } from "../../../dist/infra/pi/ghost-editor-installation.js";
import { decorateGhostSuggestionEditor } from "../../../dist/infra/pi/ghost-suggestion-decorator.js";

function createOptions(overrides = {}) {
	let active = overrides.active ?? true;
	let suggestion = overrides.suggestion ?? "hello world";
	let revision = overrides.revision ?? 1;
	return {
		options: {
			getSuggestion: () => suggestion,
			getSuggestionRevision: () => revision,
			ghostAcceptKeys: overrides.ghostAcceptKeys ?? ["right"],
			ghostAcceptAndSendKeys: overrides.ghostAcceptAndSendKeys ?? ["enter"],
			isActive: () => active,
		},
		setActive(next) {
			active = next;
		},
		setSuggestion(next) {
			suggestion = next;
			revision += 1;
		},
	};
}

function createFakeEditor() {
	return {
		text: "",
		cursor: { line: 0, col: 0 },
		inputs: [],
		submitted: [],
		handleInput(data) {
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
		setText(text) {
			this.text = text;
			this.cursor = { line: 0, col: text.length };
		},
	};
}

test("ghost decorator preserves the editor and delegates non-accept input", () => {
	const state = createOptions();
	const editor = createFakeEditor();
	const decorated = decorateGhostSuggestionEditor(editor, () => state.options);

	assert.equal(decorated, editor);
	decorated.handleInput("x");

	assert.deepEqual(editor.inputs, ["x"]);
	assert.equal(editor.getText(), "x");
});

test("ghost decorator accepts suggestion without replacing editor behavior", () => {
	const state = createOptions();
	const editor = createFakeEditor();
	const decorated = decorateGhostSuggestionEditor(editor, () => state.options);

	decorated.handleInput("\x1b[C");

	assert.equal(editor.getText(), "hello world");
	assert.deepEqual(editor.inputs, []);
});

test("ghost decorator accept-and-send materializes suggestion then delegates submit key", () => {
	const state = createOptions();
	const editor = createFakeEditor();
	const decorated = decorateGhostSuggestionEditor(editor, () => state.options);

	decorated.handleInput("\r");

	assert.deepEqual(editor.inputs, ["\r"]);
	assert.deepEqual(editor.submitted, ["hello world"]);
	assert.equal(editor.getText(), "");
});

test("ghost decorator can be deactivated without replacing the editor", () => {
	const state = createOptions({ active: false });
	const editor = createFakeEditor();
	const decorated = decorateGhostSuggestionEditor(editor, () => state.options);

	decorated.handleInput("\x1b[C");

	assert.deepEqual(editor.inputs, ["\x1b[C"]);
	assert.notEqual(editor.getText(), "hello world");
});

test("ghost decorator installation wraps future editor factories instead of reinstalling on every sync", () => {
	const originalSetEditorCalls = [];
	const ctx = {
		ui: {
			setEditorComponent(factory) {
				originalSetEditorCalls.push(factory);
			},
		},
	};
	const state = createOptions();
	let installState;

	installState = syncGhostEditorDecorator({
		state: installState,
		context: ctx,
		sessionFile: "/tmp/session.json",
		options: state.options,
	});
	assert.equal(originalSetEditorCalls.length, 1);

	installState = syncGhostEditorDecorator({
		state: installState,
		context: ctx,
		sessionFile: "/tmp/session.json",
		options: state.options,
	});
	assert.equal(originalSetEditorCalls.length, 1);

	const externalEditor = createFakeEditor();
	ctx.ui.setEditorComponent(() => externalEditor);
	assert.equal(originalSetEditorCalls.length, 2);

	const wrappedFactory = originalSetEditorCalls[1];
	const wrappedEditor = wrappedFactory({}, {}, {});
	assert.equal(wrappedEditor, externalEditor);

	wrappedEditor.handleInput("\x1b[C");
	assert.equal(externalEditor.getText(), "hello world");
});
