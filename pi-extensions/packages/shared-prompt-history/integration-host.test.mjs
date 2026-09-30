// Actual Pi editor installation, submit/follow-up paths and reload; no terminal IO.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	createSessionFixture,
	runSessionWorker,
} from "../../test-support/session-host.mjs";

if (process.argv[2] !== "worker") {
	runSessionWorker(process.argv[2], new URL(import.meta.url));
} else {
	const hostRoot = process.argv[3];
	const pi = await import(pathToFileURL(join(hostRoot, "dist/index.js")).href);
	const { InteractiveMode } = await import(
		pathToFileURL(join(hostRoot, "dist/modes/interactive/interactive-mode.js"))
			.href
	);
	const { getEditorTheme } = await import(
		pathToFileURL(join(hostRoot, "dist/modes/interactive/theme/theme.js")).href
	);
	pi.initTheme("dark");
	const mode = Object.create(InteractiveMode.prototype);
	mode.ui = { requestRender() {}, setFocus() {} };
	const { KeybindingsManager } = await import(
		pathToFileURL(join(hostRoot, "dist/core/keybindings.js")).href
	);
	mode.keybindings = new KeybindingsManager();
	mode.editorContainer = { clear() {}, addChild() {} };
	mode.statusContainer = { clear() {}, addChild() {} };
	mode.disposeActiveSelector = () => {};
	mode.updatePendingMessagesDisplay = () => {};
	Object.defineProperty(mode, "settingsManager", {
		value: pi.SettingsManager.inMemory(),
	});
	mode.defaultEditor = new pi.CustomEditor(
		mode.ui,
		getEditorTheme(),
		mode.keybindings,
		{ embedWorkingStatus: true },
	);
	mode.editor = mode.defaultEditor;
	let commands = 0;
	mode.handleSessionCommand = () => {
		commands++;
	};
	mode.setupEditorSubmitHandler();
	const existing = (tui, theme, kb) => {
		const editor = new pi.CustomEditor(tui, theme, kb);
		editor.fixtureIdentity = "early";
		return editor;
	};
	mode.setCustomEditorComponent(existing);
	const entered = Promise.withResolvers();
	const finishFirst = Promise.withResolvers();
	let requests = 0;
	const fixture = await createSessionFixture(hostRoot, {
		paths: [fileURLToPath(new URL("./index.ts", import.meta.url))],
		mode: "tui",
		uiContext: mode.createExtensionUIContext(),
		respond: async () => {
			if (++requests === 1) {
				entered.resolve();
				await finishFirst.promise;
			}
			return { content: [{ type: "text", text: "Done" }] };
		},
	});
	Object.defineProperty(mode, "session", { value: fixture.session });
	const historyPath = join(
		process.env.HOME,
		".local/state/pi/prompt-history.jsonl",
	);
	const prompts = () =>
		readFileSync(historyPath, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line).prompt);
	try {
		assert.equal(
			mode.editor.fixtureIdentity,
			"early",
			"Earlier editor replaced",
		);
		const running = fixture.session.prompt("Initial user request");
		await entered.promise;
		mode.editor.setText("Queued with Alt+Enter");
		await mode.handleFollowUp();
		finishFirst.resolve();
		await running;
		mode.editor.addToHistory("replayed expanded prompt");
		await mode.editor.onSubmit("/session");
		const runner = fixture.session.extensionRunner;
		const ui = runner.getUIContext();
		ui.setEditorComponent((tui, theme, kb) => {
			const editor = new pi.CustomEditor(tui, theme, kb);
			editor.fixtureIdentity = "late";
			return editor;
		});
		await Promise.resolve();
		assert.equal(mode.editor.fixtureIdentity, "late");
		ui.setEditorComponent(ui.getEditorComponent());
		await Promise.resolve();
		await mode.editor.onSubmit("/session");
		await fixture.session.reload();
		await mode.editor.onSubmit("/session");
		await fixture.session.extensionRunner.emit({
			type: "session_shutdown",
			reason: "quit",
		});
		assert.equal(
			commands,
			3,
			"Submit wrapper called the native handler more than once",
		);
		assert.deepEqual(prompts(), [
			"Initial user request",
			"Queued with Alt+Enter",
			"/session",
		]);
		assert.deepEqual(fixture.errors, []);
	} finally {
		fixture.session.dispose();
	}
	console.log(
		"PASS shared history: native editor composition, Alt+Enter, command deduplication, reload and shutdown draining",
	);
}
