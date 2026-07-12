import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import autoSessionName, {
	extractUserRequest,
	shouldNameAfterTurn,
} from "./auto-session-name";

const mocks = vi.hoisted(() => ({
	completeSimple: vi.fn(),
}));

vi.mock("@mariozechner/pi-ai", () => ({
	completeSimple: mocks.completeSimple,
}));

const skillPrefixedPrompt = `<skill name="brainstorming" location="/tmp/brainstorming/SKILL.md">
# Brainstorming Ideas Into Designs

Long skill instructions that should not be used as the session title.
</skill>

When viewing previous sessions in pi, it's very hard to read if we start off with a skill.`;

const plainPrompt =
	"Help me design a reliable backup strategy for my laptop and home server.";

let originalHome: string | undefined;
let isolatedHome: string | undefined;

type TurnEndHandler = (
	event: { turnIndex: number },
	ctx: TestExtensionContext,
) => void | Promise<void>;

type SessionStartHandler = (
	event: unknown,
	ctx: TestExtensionContext,
) => void | Promise<void>;

type TestModel = Model<string>;

type TestExtensionContext = {
	model: TestModel;
	modelRegistry: {
		getAll(): TestModel[];
		getApiKey(model: TestModel): string | undefined;
		getHeaders(model: TestModel): Record<string, string> | undefined;
	};
	sessionManager: {
		getBranch(): unknown[];
	};
};

const makeTestModel = (id: string): TestModel => ({
	api: "test-api",
	baseUrl: "https://example.test",
	contextWindow: 128_000,
	cost: {
		cacheRead: 0,
		cacheWrite: 0,
		input: 0,
		output: 0,
	},
	headers: {},
	id,
	input: ["text"],
	maxTokens: 1024,
	name: id,
	provider: "test-provider",
	reasoning: false,
});

const defaultModel = makeTestModel("default-model");
const configuredModel = makeTestModel("configured-model");

const messageEntry = (content: unknown) => ({
	type: "message",
	message: {
		role: "user",
		content,
	},
});

const textPartMessageEntry = (text: string) =>
	messageEntry([{ type: "text", text }]);

const createContext = (
	branch: unknown[],
	models: TestModel[] = [defaultModel, configuredModel],
): TestExtensionContext => ({
	model: defaultModel,
	modelRegistry: {
		getAll: () => models,
		getApiKey: () => "test-api-key",
		getHeaders: () => ({ "x-test": "header" }),
	},
	sessionManager: {
		getBranch: () => branch,
	},
});

const createHarness = (initialName?: string) => {
	let sessionName = initialName;
	let turnEndHandler: TurnEndHandler | undefined;
	let sessionStartHandler: SessionStartHandler | undefined;

	function on(
		...args:
			| [eventName: "turn_end", handler: TurnEndHandler]
			| [eventName: "session_start", handler: SessionStartHandler]
	): void {
		const [eventName, handler] = args;
		if (eventName === "turn_end") {
			turnEndHandler = handler;
			return;
		}
		sessionStartHandler = handler;
	}

	const pi = {
		getSessionName: vi.fn(() => sessionName),
		setSessionName: vi.fn((name: string) => {
			sessionName = name;
		}),
		on,
	};

	autoSessionName(pi);

	return {
		pi,
		setCurrentSessionName(name: string | undefined) {
			sessionName = name;
		},
		async triggerTurnEnd(turnIndex: number, ctx: TestExtensionContext) {
			if (!turnEndHandler)
				throw new Error("turn_end handler was not registered");
			await turnEndHandler({ turnIndex }, ctx);
		},
		async triggerSessionStart(ctx: TestExtensionContext) {
			await sessionStartHandler?.({}, ctx);
		},
	};
};

const useTempHome = async () => {
	const previousHome = process.env.HOME;
	const home = await mkdtemp(join(tmpdir(), "auto-session-name-home-"));
	process.env.HOME = home;
	return {
		home,
		restore() {
			if (previousHome === undefined) {
				delete process.env.HOME;
				return;
			}
			process.env.HOME = previousHome;
		},
	};
};

const writeSettings = async (home: string, settings: unknown) => {
	const settingsDir = join(home, ".pi", "agent");
	await mkdir(settingsDir, { recursive: true });
	await writeFile(join(settingsDir, "settings.json"), JSON.stringify(settings));
};

const expectNoSessionName = (value: string | undefined) => {
	expect(value?.trim() || undefined).toBeUndefined();
};

describe("auto session naming eligibility", () => {
	test("names any unnamed session once on the first turn_end", async () => {
		mocks.completeSimple.mockResolvedValue({ content: "Backup Strategy" });
		const harness = createHarness();
		const ctx = createContext([textPartMessageEntry(plainPrompt)]);

		await harness.triggerTurnEnd(0, ctx);
		await vi.waitFor(() =>
			expect(harness.pi.setSessionName).toHaveBeenCalledWith("Backup Strategy"),
		);

		await harness.triggerTurnEnd(1, ctx);
		expect(harness.pi.setSessionName).toHaveBeenCalledTimes(1);
	});

	test("turn eligibility no longer requires a leading skill", () => {
		expect(
			shouldNameAfterTurn({
				hasSessionName: false,
				turnIndex: 0,
			}),
		).toBe(true);
		expect(
			shouldNameAfterTurn({
				hasSessionName: true,
				turnIndex: 0,
			}),
		).toBe(false);
		expect(
			shouldNameAfterTurn({
				hasSessionName: false,
				turnIndex: 1,
			}),
		).toBe(false);
	});

	test("does not schedule or perform historical backfill on session_start", async () => {
		vi.useFakeTimers();
		const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
		const harness = createHarness();
		const ctx = createContext([textPartMessageEntry(skillPrefixedPrompt)]);

		await harness.triggerSessionStart(ctx);
		await vi.runOnlyPendingTimersAsync();

		expect(harness.pi.setSessionName).not.toHaveBeenCalled();
		expect(setTimeoutSpy).not.toHaveBeenCalled();
		setTimeoutSpy.mockRestore();
		vi.useRealTimers();
	});
});

describe("first-message title input", () => {
	test("cleans only the first user message by stripping leading skill XML", async () => {
		mocks.completeSimple.mockResolvedValue({
			content: "Readable Session Titles",
		});
		const harness = createHarness();
		const ctx = createContext([
			textPartMessageEntry(skillPrefixedPrompt),
			{ type: "message", message: { role: "assistant", content: "ignore me" } },
			textPartMessageEntry("Do not use this later user message."),
		]);

		await harness.triggerTurnEnd(0, ctx);
		await vi.waitFor(() => expect(mocks.completeSimple).toHaveBeenCalled());

		const promptText = JSON.stringify(mocks.completeSimple.mock.calls[0]);
		expect(promptText).toContain(
			"When viewing previous sessions in pi, it's very hard to read if we start off with a skill.",
		);
		expect(promptText).not.toContain("Long skill instructions");
		expect(promptText).not.toContain("ignore me");
		expect(promptText).not.toContain("Do not use this later user message");
		expect(harness.pi.setSessionName).toHaveBeenCalledWith(
			"Readable Session Titles",
		);
	});

	test("extractUserRequest strips a leading skill block but keeps ordinary text", () => {
		expect(extractUserRequest(skillPrefixedPrompt)).toBe(
			"When viewing previous sessions in pi, it's very hard to read if we start off with a skill.",
		);
		expect(extractUserRequest(plainPrompt)).toBe(plainPrompt);
	});
});

describe("existing names and config", () => {
	test("preserves an existing non-empty name", async () => {
		mocks.completeSimple.mockResolvedValue({ content: "New Model Title" });
		const harness = createHarness("Existing name");

		await harness.triggerTurnEnd(
			0,
			createContext([textPartMessageEntry(plainPrompt)]),
		);

		expect(mocks.completeSimple).not.toHaveBeenCalled();
		expect(harness.pi.setSessionName).not.toHaveBeenCalled();
	});

	test("re-checks the session name before setting an async model result", async () => {
		let resolveTitle: (value: { content: string }) => void = () => undefined;
		mocks.completeSimple.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveTitle = resolve;
				}),
		);
		const harness = createHarness();
		const turn = harness.triggerTurnEnd(
			0,
			createContext([textPartMessageEntry(plainPrompt)]),
		);

		await vi.waitFor(() => expect(mocks.completeSimple).toHaveBeenCalled());
		harness.setCurrentSessionName("User supplied name");
		resolveTitle({ content: "Model Title" });
		await turn;

		expect(harness.pi.setSessionName).not.toHaveBeenCalled();
	});

	test("enabled defaults to true and titleModel defaults to session-default", async () => {
		mocks.completeSimple.mockResolvedValue({ content: "Default Model Title" });
		const harness = createHarness();

		await harness.triggerTurnEnd(
			0,
			createContext([textPartMessageEntry(plainPrompt)]),
		);
		await vi.waitFor(() =>
			expect(harness.pi.setSessionName).toHaveBeenCalledWith(
				"Default Model Title",
			),
		);

		expect(mocks.completeSimple.mock.calls[0]?.[0]).toBe(defaultModel);
	});

	test("enabled false opts out of automatic naming", async () => {
		const tempHome = await useTempHome();
		try {
			await writeSettings(tempHome.home, {
				autoSessionName: { enabled: false },
			});
			mocks.completeSimple.mockResolvedValue({ content: "Disabled Title" });
			const harness = createHarness();

			await harness.triggerTurnEnd(
				0,
				createContext([textPartMessageEntry(plainPrompt)]),
			);

			expect(mocks.completeSimple).not.toHaveBeenCalled();
			expect(harness.pi.setSessionName).not.toHaveBeenCalled();
		} finally {
			tempHome.restore();
		}
	});

	test("uses a configured titleModel and falls back when titleModel is invalid", async () => {
		const tempHome = await useTempHome();
		try {
			await writeSettings(tempHome.home, {
				autoSessionName: { titleModel: ["configured-model"] },
			});
			mocks.completeSimple.mockResolvedValue({
				content: "Configured Model Title",
			});
			const configuredHarness = createHarness();

			await configuredHarness.triggerTurnEnd(
				0,
				createContext([textPartMessageEntry(plainPrompt)]),
			);
			await vi.waitFor(() =>
				expect(configuredHarness.pi.setSessionName).toHaveBeenCalledWith(
					"Configured Model Title",
				),
			);
			expect(mocks.completeSimple.mock.calls[0]?.[0]).toBe(configuredModel);

			mocks.completeSimple.mockClear();
			await writeSettings(tempHome.home, {
				autoSessionName: { titleModel: "configured-model" },
			});
			mocks.completeSimple.mockResolvedValue({
				content: "Fallback Model Title",
			});
			const fallbackHarness = createHarness();

			await fallbackHarness.triggerTurnEnd(
				0,
				createContext([textPartMessageEntry(plainPrompt)]),
			);
			await vi.waitFor(() =>
				expect(fallbackHarness.pi.setSessionName).toHaveBeenCalledWith(
					"Fallback Model Title",
				),
			);
			expect(mocks.completeSimple.mock.calls[0]?.[0]).toBe(defaultModel);
		} finally {
			tempHome.restore();
		}
	});

	test("uses deterministic fallback when configured models cannot be resolved", async () => {
		const tempHome = await useTempHome();
		try {
			await writeSettings(tempHome.home, {
				autoSessionName: { titleModel: ["missing-model"] },
			});
			mocks.completeSimple.mockResolvedValue({ content: "Should Not Run" });
			const harness = createHarness();

			await harness.triggerTurnEnd(
				0,
				createContext([textPartMessageEntry(plainPrompt)]),
			);

			await vi.waitFor(() =>
				expect(harness.pi.setSessionName).toHaveBeenCalled(),
			);
			expect(mocks.completeSimple).not.toHaveBeenCalled();
			expect(harness.pi.setSessionName.mock.calls[0]?.[0]).toBe(
				"Help me design a reliable backup strategy for",
			);
		} finally {
			tempHome.restore();
		}
	});
});

describe("model output and fallback titles", () => {
	test("falls back to a deterministic first-message prefix when the model fails", async () => {
		mocks.completeSimple.mockRejectedValue(new Error("provider unavailable"));
		const harness = createHarness();

		await harness.triggerTurnEnd(
			0,
			createContext([textPartMessageEntry(plainPrompt)]),
		);
		await vi.waitFor(() =>
			expect(harness.pi.setSessionName).toHaveBeenCalled(),
		);

		const generated = harness.pi.setSessionName.mock.calls[0]?.[0];
		expect(generated).toBe("Help me design a reliable backup strategy for");
		expect(generated?.split(/\s+/)).toHaveLength(8);
		expect(generated?.length).toBeLessThanOrEqual(60);
	});

	test("falls back when the model returns empty output", async () => {
		mocks.completeSimple.mockResolvedValue({ content: "   \n  " });
		const harness = createHarness();

		await harness.triggerTurnEnd(
			0,
			createContext([textPartMessageEntry(plainPrompt)]),
		);
		await vi.waitFor(() =>
			expect(harness.pi.setSessionName).toHaveBeenCalled(),
		);

		expect(harness.pi.setSessionName.mock.calls[0]?.[0]).toBe(
			"Help me design a reliable backup strategy for",
		);
	});

	test("normalizes quoted markdown-ish model titles to 60 chars and 8 words", async () => {
		mocks.completeSimple.mockResolvedValue({
			content:
				'**"A careful backup migration strategy with many detailed implementation steps"**',
		});
		const harness = createHarness();

		await harness.triggerTurnEnd(
			0,
			createContext([textPartMessageEntry(plainPrompt)]),
		);
		await vi.waitFor(() =>
			expect(harness.pi.setSessionName).toHaveBeenCalled(),
		);

		const generated = harness.pi.setSessionName.mock.calls[0]?.[0];
		expect(generated).toBe(
			"A careful backup migration strategy with many detailed",
		);
		expect(generated?.split(/\s+/)).toHaveLength(8);
		expect(generated?.length).toBeLessThanOrEqual(60);
		expect(generated).not.toMatch(/["*_`]/);
	});

	test("ignores blank first user messages", async () => {
		mocks.completeSimple.mockResolvedValue({ content: "Should Not Happen" });
		const harness = createHarness();

		await harness.triggerTurnEnd(0, createContext([messageEntry("   ")]));

		expect(mocks.completeSimple).not.toHaveBeenCalled();
		expectNoSessionName(harness.pi.setSessionName.mock.calls[0]?.[0]);
	});
});

beforeEach(async () => {
	mocks.completeSimple.mockReset();
	originalHome = process.env.HOME;
	isolatedHome = await mkdtemp(join(tmpdir(), "auto-session-name-home-"));
	process.env.HOME = isolatedHome;
});

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	if (originalHome === undefined) {
		delete process.env.HOME;
	} else {
		process.env.HOME = originalHome;
	}
	if (isolatedHome) {
		await rm(isolatedHome, { recursive: true, force: true });
	}
	originalHome = undefined;
	isolatedHome = undefined;
});
