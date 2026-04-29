import test from "node:test";
import assert from "node:assert/strict";
import { GhostSuggestionEditor } from "../../../dist/infra/pi/ghost-suggestion-editor.js";

function createHistoryStore() {
	let state = { entries: [], index: -1 };
	return {
		get() {
			return { entries: [...state.entries], index: state.index };
		},
		set(next) {
			state = { entries: [...next.entries], index: next.index };
		},
	};
}

function createEditor(store, { text = "", suggestion, ghostAcceptKeys = ["right"], ghostAcceptAndSendKeys = ["enter"] } = {}) {
	const tui = {
		terminal: { rows: 24 },
		requestRender() {},
	};
	const theme = {
		borderColor(text) {
			return text;
		},
	};
	const keybindings = {
		matches() {
			return false;
		},
	};

	const editor = new GhostSuggestionEditor(
		tui,
		theme,
		keybindings,
		() => suggestion,
		() => 1,
		ghostAcceptKeys,
		ghostAcceptAndSendKeys,
		() => store.get(),
		(state) => store.set(state),
	);
	editor.setText(text);
	return editor;
}

test("restores submitted prompt history after ghost editor swaps", () => {
	const store = createHistoryStore();
	const firstEditor = createEditor(store);

	firstEditor.addToHistory("older prompt");
	firstEditor.addToHistory("latest prompt");

	const swappedEditor = createEditor(store);
	swappedEditor.handleInput("\x1b[A");

	assert.equal(swappedEditor.getText(), "latest prompt");
});

test("preserves active history navigation state across ghost editor swaps", () => {
	const store = createHistoryStore();
	const firstEditor = createEditor(store);

	firstEditor.addToHistory("older prompt");
	firstEditor.addToHistory("latest prompt");
	firstEditor.handleInput("\x1b[A");
	assert.equal(firstEditor.getText(), "latest prompt");

	const swappedEditor = createEditor(store, { text: firstEditor.getText() });
	swappedEditor.handleInput("\x1b[B");

	assert.equal(swappedEditor.getText(), "");
});

test("accepts ghost suggestion with right arrow by default", () => {
	const store = createHistoryStore();
	const editor = createEditor(store, { suggestion: "hello world" });

	editor.handleInput("\x1b[C");

	assert.equal(editor.getText(), "hello world");
});

test("accepts ghost suggestion with right arrow when configured", () => {
	const store = createHistoryStore();
	const editor = createEditor(store, { suggestion: "hello world", ghostAcceptKeys: ["right"] });

	editor.handleInput("\x1b[C");

	assert.equal(editor.getText(), "hello world");
});

test("accepts and submits ghost suggestion with Enter by default", () => {
	const store = createHistoryStore();
	const editor = createEditor(store, { suggestion: "hello world" });
	let submitted = "";
	editor.onSubmit = (text) => {
		submitted = text;
	};

	editor.handleInput("\r");

	assert.equal(submitted, "hello world");
	assert.equal(editor.getText(), "");
});

test("Space can still be configured as accept-only", () => {
	const store = createHistoryStore();
	const editor = createEditor(store, { suggestion: "hello world", ghostAcceptKeys: ["space"], ghostAcceptAndSendKeys: ["enter"] });
	let submitted = "";
	editor.onSubmit = (text) => {
		submitted = text;
	};

	editor.handleInput(" ");

	assert.equal(editor.getText(), "hello world");
	assert.equal(submitted, "");
});
