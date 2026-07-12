import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import sharedPromptHistory from "./index";

type SharedPromptHistoryApi = Parameters<typeof sharedPromptHistory>[0];
type SessionStartHandler = Parameters<SharedPromptHistoryApi["on"]>[1];
type TestContext = Parameters<SessionStartHandler>[1];
type EditorFactory = NonNullable<
	Parameters<TestContext["ui"]["setEditorComponent"]>[0]
>;

type TempHistory = {
	home: string;
	historyPath: string;
};

type HistoryTestEditor = {
	addToHistory(text: string): void;
	onSubmit?: (text: string) => void | Promise<void>;
};

type HistoryInspectableEditor = {
	history: string[];
};

function isObjectRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === "object" && value !== null;
}

function isHistoryTestEditor(value: unknown): value is HistoryTestEditor {
	if (!isObjectRecord(value)) return false;
	return (
		typeof value.addToHistory === "function" &&
		(value.onSubmit === undefined || typeof value.onSubmit === "function")
	);
}

function isHistoryInspectableEditor(
	value: unknown,
): value is HistoryInspectableEditor {
	if (!isObjectRecord(value)) return false;
	return (
		Array.isArray(value.history) &&
		value.history.every((entry) => typeof entry === "string")
	);
}

function invokeEditorFactory(factory: EditorFactory): unknown {
	return Reflect.apply(factory, undefined, [{}, {}, { matches: () => false }]);
}

async function createTempHistory(): Promise<TempHistory> {
	const home = await mkdtemp(join(tmpdir(), "pi-prompt-history-home-"));
	return {
		home,
		historyPath: join(home, ".local", "state", "pi", "prompt-history.jsonl"),
	};
}

async function registerExtension(ctx: TestContext, historyPath: string) {
	let sessionStart:
		| ((event: unknown, ctx: TestContext) => void | Promise<void>)
		| undefined;
	sharedPromptHistory(
		{
			on(event, handler) {
				if (event === "session_start") sessionStart = handler;
			},
			registerCommand() {},
		},
		{ historyPath },
	);

	await sessionStart?.({}, ctx);
}

async function waitForFileContaining(
	filePath: string,
	text: string,
): Promise<void> {
	const deadline = Date.now() + 1000;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			const contents = await readFile(filePath, "utf8");
			if (contents.includes(text)) return;
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	if (lastError) throw lastError;
	throw new Error(`Timed out waiting for ${filePath} to contain ${text}`);
}

async function createEditor(
	historyPath: string,
	onSubmit?: (text: string) => void | Promise<void>,
) {
	let factory: EditorFactory | undefined;
	await registerExtension(
		{
			ui: {
				setEditorComponent(value) {
					factory = value;
				},
			},
		},
		historyPath,
	);

	if (!factory) throw new Error("editor factory was not registered");
	const editor = invokeEditorFactory(factory);
	if (!isHistoryTestEditor(editor)) {
		throw new Error("editor does not expose test history hooks");
	}
	if (onSubmit) editor.onSubmit = onSubmit;

	await new Promise<void>((resolve) => queueMicrotask(() => resolve()));
	return editor;
}

describe("shared prompt history extension", () => {
	test("does not persist history entries replayed by pi", async () => {
		const tempHistory = await createTempHistory();
		try {
			const editor = await createEditor(tempHistory.historyPath);

			editor.addToHistory("expanded session prompt replayed on startup");
			await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

			await expect(
				readFile(tempHistory.historyPath, "utf8"),
			).rejects.toMatchObject({
				code: "ENOENT",
			});
		} finally {
			await rm(tempHistory.home, { recursive: true, force: true });
		}
	});

	test("persists prompts submitted through the editor", async () => {
		const tempHistory = await createTempHistory();
		try {
			const editor = await createEditor(
				tempHistory.historyPath,
				async () => {},
			);

			await editor.onSubmit?.("submitted prompt");
			await waitForFileContaining(tempHistory.historyPath, "submitted prompt");
		} finally {
			await rm(tempHistory.home, { recursive: true, force: true });
		}
	});

	test("installs the editor when history cannot be read", async () => {
		const tempHistory = await createTempHistory();
		try {
			await mkdir(tempHistory.historyPath, { recursive: true });

			const editor = await createEditor(
				tempHistory.historyPath,
				async () => {},
			);
			await expect(
				editor.onSubmit?.("submitted prompt"),
			).resolves.toBeUndefined();
		} finally {
			await rm(tempHistory.home, { recursive: true, force: true });
		}
	});

	test("loads shared history into editor components registered by later extensions", async () => {
		const tempHistory = await createTempHistory();
		try {
			await mkdir(dirname(tempHistory.historyPath), { recursive: true });
			await writeFile(
				tempHistory.historyPath,
				`${JSON.stringify({ prompt: "existing prompt" })}\n`,
				"utf8",
			);

			let factory: EditorFactory | undefined;
			const ctx: TestContext = {
				ui: {
					setEditorComponent(value) {
						factory = value;
					},
				},
			};

			await registerExtension(ctx, tempHistory.historyPath);
			ctx.ui.setEditorComponent(() => {
				const history: string[] = [];
				return {
					history,
					addToHistory(text: string) {
						history.unshift(text.trim());
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
			});

			const editor = factory ? invokeEditorFactory(factory) : undefined;
			if (!isHistoryInspectableEditor(editor)) {
				throw new Error("editor does not expose test history state");
			}

			expect(editor.history).toEqual(["existing prompt"]);
		} finally {
			await rm(tempHistory.home, { recursive: true, force: true });
		}
	});
});
