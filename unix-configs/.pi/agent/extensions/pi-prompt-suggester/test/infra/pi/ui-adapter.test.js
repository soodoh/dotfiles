import test from "node:test";
import assert from "node:assert/strict";
import {
	acceptWidgetSuggestion,
	PiSuggestionSink,
	refreshSuggesterUi,
	WIDGET_ACCEPT_SHORTCUT_LABEL,
} from "../../../dist/infra/pi/ui-adapter.js";

function createTheme() {
	return {
		fg(_name, text) {
			return text;
		},
	};
}

test("PiSuggestionSink keeps ghost suggestions even before idle flips", async () => {
	const runtime = {
		epoch: 1,
		suggestion: undefined,
		panelSuggestionStatus: undefined,
		panelUsageStatus: undefined,
		getContext() {
			return {
				hasUI: true,
				ui: {
					getEditorText() {
						return "";
					},
					setWidget() {},
					setStatus() {},
					theme: createTheme(),
				},
				isIdle() {
					return false;
				},
				hasPendingMessages() {
					return true;
				},
			};
		},
		getEpoch() {
			return this.epoch;
		},
		getSuggestion() {
			return this.suggestion;
		},
		setSuggestion(text) {
			this.suggestion = text;
		},
		getPanelSuggestionStatus() {
			return this.panelSuggestionStatus;
		},
		setPanelSuggestionStatus(text) {
			this.panelSuggestionStatus = text;
		},
		getPanelUsageStatus() {
			return this.panelUsageStatus;
		},
		setPanelUsageStatus(text) {
			this.panelUsageStatus = text;
		},
		getPanelLogStatus() {
			return undefined;
		},
		setPanelLogStatus() {},
		getSuggesterModelDisplay() {
			return undefined;
		},
		suggestionDisplayMode: "ghost",
		prefillOnlyWhenEditorEmpty: true,
		showUsageInPanel: true,
		showPanelStatus: true,
	};

	const sink = new PiSuggestionSink(runtime);
	await sink.showSuggestion("hello world", { generationId: 1 });

	assert.equal(runtime.suggestion, "hello world");
	assert.match(runtime.panelSuggestionStatus, /Space accepts/);
});

test("PiSuggestionSink retains suggestions even when the editor text is temporarily incompatible", async () => {
	const runtime = {
		epoch: 1,
		suggestion: undefined,
		panelSuggestionStatus: undefined,
		panelUsageStatus: undefined,
		getContext() {
			return {
				hasUI: true,
				ui: {
					getEditorText() {
						return "previous prompt still in editor";
					},
					setWidget() {},
					setStatus() {},
					theme: createTheme(),
				},
				isIdle() {
					return true;
				},
				hasPendingMessages() {
					return false;
				},
			};
		},
		getEpoch() {
			return this.epoch;
		},
		getSuggestion() {
			return this.suggestion;
		},
		setSuggestion(text) {
			this.suggestion = text;
		},
		getPanelSuggestionStatus() {
			return this.panelSuggestionStatus;
		},
		setPanelSuggestionStatus(text) {
			this.panelSuggestionStatus = text;
		},
		getPanelUsageStatus() {
			return this.panelUsageStatus;
		},
		setPanelUsageStatus(text) {
			this.panelUsageStatus = text;
		},
		getPanelLogStatus() {
			return undefined;
		},
		setPanelLogStatus() {},
		getSuggesterModelDisplay() {
			return undefined;
		},
		suggestionDisplayMode: "ghost",
		prefillOnlyWhenEditorEmpty: true,
		showUsageInPanel: true,
		showPanelStatus: true,
	};

	const sink = new PiSuggestionSink(runtime);
	await sink.showSuggestion("hello world", { generationId: 1 });

	assert.equal(runtime.suggestion, "hello world");
	assert.match(runtime.panelSuggestionStatus, /ghost hidden/);
});

test("refreshSuggesterUi still renders the panel when a suggestion exists", () => {
	let lastWidget;
	const ctx = {
		hasUI: true,
		ui: {
			setStatus() {},
			setWidget(key, content) {
				lastWidget = { key, content };
			},
			theme: createTheme(),
		},
		isIdle() {
			return false;
		},
		hasPendingMessages() {
			return true;
		},
	};
	const runtime = {
		getContext() {
			return ctx;
		},
		getSuggestion() {
			return "hello world";
		},
		getPanelSuggestionStatus() {
			return "prompt suggestion";
		},
		getPanelUsageStatus() {
			return "suggester usage: ↑10 ↓5 R2 $0.001 (1 sugg, 0 seed)";
		},
		getPanelLogStatus() {
			return undefined;
		},
		suggestionDisplayMode: "widget",
		showUsageInPanel: true,
		showPanelStatus: true,
	};

	refreshSuggesterUi(runtime);

	assert.equal(lastWidget?.key, "suggester-panel");
	assert.equal(typeof lastWidget?.content, "function");
	const rendered = lastWidget.content(null, createTheme()).render(80);
	assert.equal(rendered.some((line) => line.includes("hello world")), true);
	assert.equal(rendered.some((line) => line.includes("prompt suggestion")), true);
	assert.equal(rendered.some((line) => line.includes(WIDGET_ACCEPT_SHORTCUT_LABEL)), true);
	assert.equal(rendered.some((line) => line.includes("suggester usage: ↑10 ↓5 R2 $0.001 (1 sugg, 0 seed)")), true);
});

test("refreshSuggesterUi hides widget suggestion content after switching back to ghost mode", () => {
	let lastWidget;
	const ctx = {
		hasUI: true,
		ui: {
			setStatus() {},
			setWidget(key, content) {
				lastWidget = { key, content };
			},
			theme: createTheme(),
		},
	};
	const runtime = {
		suggestionDisplayMode: "widget",
		getContext() {
			return ctx;
		},
		getSuggestion() {
			return "hello world";
		},
		getPanelSuggestionStatus() {
			return "prompt suggestion";
		},
		getPanelUsageStatus() {
			return "suggester usage: ↑10 ↓5 R2 $0.001 (1 sugg, 0 seed)";
		},
		getPanelLogStatus() {
			return undefined;
		},
		showUsageInPanel: true,
		showPanelStatus: true,
	};

	refreshSuggesterUi(runtime);
	runtime.suggestionDisplayMode = "ghost";
	refreshSuggesterUi(runtime);

	const rendered = lastWidget.content(null, createTheme()).render(80);
	assert.equal(rendered.some((line) => line.includes("hello world")), false);
	assert.equal(rendered.some((line) => line.includes("prompt suggestion")), false);
	assert.equal(rendered.some((line) => line.includes("F2 accepts")), false);
	assert.equal(rendered.some((line) => line.includes("suggester usage: ↑10 ↓5 R2 $0.001 (1 sugg, 0 seed)")), true);
});

test("acceptWidgetSuggestion materializes the suggestion into the default editor", () => {
	const runtime = {
		suggestion: "hello world",
		panelSuggestionStatus: "prompt suggestion",
		editorText: "hello",
		getContext() {
			return {
				hasUI: true,
				ui: {
					getEditorText: () => this.editorText,
					setEditorText: (text) => {
						this.editorText = text;
					},
					setStatus() {},
					setWidget() {},
					theme: createTheme(),
				},
			};
		},
		getSuggestion() {
			return this.suggestion;
		},
		setSuggestion(text) {
			this.suggestion = text;
		},
		getPanelSuggestionStatus() {
			return this.panelSuggestionStatus;
		},
		setPanelSuggestionStatus(text) {
			this.panelSuggestionStatus = text;
		},
		getPanelUsageStatus() {
			return undefined;
		},
		setPanelUsageStatus() {},
		getPanelLogStatus() {
			return undefined;
		},
		setPanelLogStatus() {},
		getSuggesterModelDisplay() {
			return undefined;
		},
		suggestionDisplayMode: "widget",
		showUsageInPanel: true,
		showPanelStatus: true,
		prefillOnlyWhenEditorEmpty: true,
	};

	assert.equal(acceptWidgetSuggestion(runtime), "accepted");
	assert.equal(runtime.editorText, "hello world");
	assert.equal(runtime.suggestion, undefined);
	assert.equal(runtime.panelSuggestionStatus, undefined);
});

test("acceptWidgetSuggestion refuses to overwrite diverged editor text", () => {
	const runtime = {
		suggestion: "hello world",
		editorText: "different prompt",
		getContext() {
			return {
				hasUI: true,
				ui: {
					getEditorText: () => this.editorText,
					setEditorText: (text) => {
						this.editorText = text;
					},
					setStatus() {},
					setWidget() {},
					theme: createTheme(),
				},
			};
		},
		getSuggestion() {
			return this.suggestion;
		},
		setSuggestion(text) {
			this.suggestion = text;
		},
		getPanelSuggestionStatus() {
			return undefined;
		},
		setPanelSuggestionStatus() {},
		getPanelUsageStatus() {
			return undefined;
		},
		setPanelUsageStatus() {},
		getPanelLogStatus() {
			return undefined;
		},
		setPanelLogStatus() {},
		getSuggesterModelDisplay() {
			return undefined;
		},
		suggestionDisplayMode: "widget",
		showUsageInPanel: true,
		showPanelStatus: true,
		prefillOnlyWhenEditorEmpty: true,
	};

	assert.equal(acceptWidgetSuggestion(runtime), "mismatch");
	assert.equal(runtime.editorText, "different prompt");
	assert.equal(runtime.suggestion, "hello world");
});

test("PiSuggestionSink writes usage into the panel instead of the footer status line", async () => {
	const statusCalls = [];
	const runtime = {
		epoch: 1,
		panelUsageStatus: undefined,
		getContext() {
			return {
				hasUI: true,
				ui: {
					setStatus(key, value) {
						statusCalls.push([key, value]);
					},
					setWidget() {},
					theme: createTheme(),
				},
			};
		},
		getEpoch() {
			return this.epoch;
		},
		getSuggestion() {
			return undefined;
		},
		setSuggestion() {},
		getPanelSuggestionStatus() {
			return undefined;
		},
		setPanelSuggestionStatus() {},
		getPanelUsageStatus() {
			return this.panelUsageStatus;
		},
		setPanelUsageStatus(text) {
			this.panelUsageStatus = text;
		},
		getPanelLogStatus() {
			return undefined;
		},
		setPanelLogStatus() {},
		getSuggesterModelDisplay() {
			return "(openai) gpt-5 • high";
		},
		suggestionDisplayMode: "ghost",
		prefillOnlyWhenEditorEmpty: true,
		showUsageInPanel: true,
		showPanelStatus: true,
	};

	const sink = new PiSuggestionSink(runtime);
	await sink.setUsage({
		suggester: { calls: 1, inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 0, totalTokens: 15, costTotal: 0.001 },
		seeder: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, costTotal: 0 },
	});

	assert.match(runtime.panelUsageStatus, /suggester usage:/);
	assert.equal(statusCalls.some(([key]) => key === "suggester-usage"), true);
});

test("refreshSuggesterUi shows orphan usage when usage display is enabled", () => {
	let lastWidget;
	const ctx = {
		hasUI: true,
		ui: {
			setStatus() {},
			setWidget(key, content) {
				lastWidget = { key, content };
			},
			theme: createTheme(),
		},
	};
	const runtime = {
		getContext() {
			return ctx;
		},
		getSuggestion() {
			return undefined;
		},
		getPanelSuggestionStatus() {
			return undefined;
		},
		getPanelUsageStatus() {
			return "suggester usage: ↑10 ↓5 R2 $0.001 (1 sugg, 0 seed)";
		},
		getPanelLogStatus() {
			return undefined;
		},
		suggestionDisplayMode: "ghost",
		showUsageInPanel: true,
		showPanelStatus: true,
	};

	refreshSuggesterUi(runtime);

	assert.equal(lastWidget?.key, "suggester-panel");
	assert.equal(typeof lastWidget?.content, "function");
	const rendered = lastWidget.content(null, createTheme()).render(80);
	assert.equal(rendered.some((line) => line.includes("suggester usage: ↑10 ↓5 R2 $0.001 (1 sugg, 0 seed)")), true);
});

test("PiSuggestionSink shows widget suggestions when widget mode is enabled", async () => {
	const runtime = {
		epoch: 1,
		suggestion: undefined,
		panelSuggestionStatus: undefined,
		panelUsageStatus: undefined,
		getContext() {
			return {
				hasUI: true,
				ui: {
					getEditorText() {
						return "";
					},
					setWidget() {},
					setStatus() {},
					theme: createTheme(),
				},
			};
		},
		getEpoch() {
			return this.epoch;
		},
		getSuggestion() {
			return this.suggestion;
		},
		setSuggestion(text) {
			this.suggestion = text;
		},
		getPanelSuggestionStatus() {
			return this.panelSuggestionStatus;
		},
		setPanelSuggestionStatus(text) {
			this.panelSuggestionStatus = text;
		},
		getPanelUsageStatus() {
			return this.panelUsageStatus;
		},
		setPanelUsageStatus(text) {
			this.panelUsageStatus = text;
		},
		getPanelLogStatus() {
			return undefined;
		},
		setPanelLogStatus() {},
		getSuggesterModelDisplay() {
			return undefined;
		},
		suggestionDisplayMode: "widget",
		prefillOnlyWhenEditorEmpty: true,
		showUsageInPanel: true,
		showPanelStatus: true,
	};

	const sink = new PiSuggestionSink(runtime);
	await sink.showSuggestion("hello world", { generationId: 1 });

	assert.equal(runtime.panelSuggestionStatus, "prompt suggestion");
});

test("refreshSuggesterUi hides orphan usage when usage display is disabled", () => {
	let lastWidget;
	const ctx = {
		hasUI: true,
		ui: {
			setStatus() {},
			setWidget(key, content) {
				lastWidget = { key, content };
			},
			theme: createTheme(),
		},
	};
	const runtime = {
		getContext() {
			return ctx;
		},
		getSuggestion() {
			return undefined;
		},
		getPanelSuggestionStatus() {
			return undefined;
		},
		getPanelUsageStatus() {
			return "suggester usage: ↑10 ↓5 R2 $0.001 (1 sugg, 0 seed)";
		},
		getPanelLogStatus() {
			return undefined;
		},
		suggestionDisplayMode: "ghost",
		showUsageInPanel: false,
		showPanelStatus: true,
	};

	refreshSuggesterUi(runtime);

	assert.equal(lastWidget?.key, "suggester-panel");
	assert.equal(lastWidget?.content, undefined);
});
