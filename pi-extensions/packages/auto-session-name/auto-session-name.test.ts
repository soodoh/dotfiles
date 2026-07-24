import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import type {
	AgentSettledEvent,
	InputEvent,
	SessionEntry,
	SessionInfoChangedEvent,
	SessionShutdownEvent,
	SessionStartEvent,
	SessionTreeEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import autoSessionName, {
	type AutoTitleState,
	cleanRawUserInput,
	createRefinementTitlePrompt,
	extractStableAnchors,
	hasDirectionChange,
	isWeakRequest,
	reconstructAutoTitleState,
	shouldRefineTitle,
	truncateHeadAndTail,
} from "./auto-session-name";

const mocks = vi.hoisted(() => ({
	complete: vi.fn(),
	completeSimple: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai/compat", () => ({
	complete: mocks.complete,
	completeSimple: mocks.completeSimple,
}));

const skillPrefixedPrompt = `<skill name="brainstorming" location="/tmp/brainstorming/SKILL.md">
# Brainstorming Ideas Into Designs

Long skill instructions that should not be used as the session title.
</skill>

When viewing previous sessions in pi, make skill-started sessions readable.`;

const plainPrompt =
	"Help me design a reliable backup strategy for my laptop and home server.";

let originalHome: string | undefined;
let isolatedHome: string | undefined;
let entrySequence = 0;

type TestModel = Model<string>;

type TestContext = {
	model: TestModel | undefined;
	modelRegistry: {
		getAll(): TestModel[];
		getApiKeyAndHeaders(model: TestModel): Promise<{
			ok: true;
			apiKey: string;
			headers: Record<string, string>;
			env: Record<string, string>;
		}>;
	};
	sessionManager: {
		getBranch(): SessionEntry[];
		getSessionFile(): string | undefined;
	};
	signal: AbortSignal | undefined;
};

type InputHandler = (
	event: InputEvent,
	ctx: TestContext,
) => void | Promise<void>;
type AgentSettledHandler = (
	event: AgentSettledEvent,
	ctx: TestContext,
) => void | Promise<void>;
type SessionStartHandler = (
	event: SessionStartEvent,
	ctx: TestContext,
) => void | Promise<void>;
type SessionInfoChangedHandler = (
	event: SessionInfoChangedEvent,
	ctx: TestContext,
) => void | Promise<void>;
type SessionShutdownHandler = (
	event: SessionShutdownEvent,
	ctx: TestContext,
) => void | Promise<void>;
type SessionTreeHandler = (
	event: SessionTreeEvent,
	ctx: TestContext,
) => void | Promise<void>;

const makeTestModel = (id: string, api = "test-api"): TestModel => ({
	api,
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

const entryBase = () => {
	entrySequence += 1;
	return {
		id: `entry-${entrySequence}`,
		parentId: entrySequence === 1 ? null : `entry-${entrySequence - 1}`,
		timestamp: new Date(entrySequence * 1_000).toISOString(),
	};
};

const userMessageEntry = (text: string): SessionEntry => ({
	...entryBase(),
	type: "message",
	message: {
		role: "user",
		content: [{ type: "text", text }],
		timestamp: entrySequence * 1_000,
	},
});

const assistantMessageEntry = (text: string): SessionEntry => ({
	...entryBase(),
	type: "message",
	message: {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "test-api",
		provider: "test-provider",
		model: "test-model",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				total: 0,
			},
		},
		stopReason: "stop",
		timestamp: entrySequence * 1_000,
	},
});

const toolResultEntry = (text: string): SessionEntry => ({
	...entryBase(),
	type: "message",
	message: {
		role: "toolResult",
		toolCallId: "tool-call",
		toolName: "bash",
		content: [{ type: "text", text }],
		isError: false,
		timestamp: entrySequence * 1_000,
	},
});

const customStateEntry = (state: AutoTitleState): SessionEntry => ({
	...entryBase(),
	type: "custom",
	customType: "auto-session-name-state",
	data: state,
});

const createContext = (
	branch: SessionEntry[],
	models: TestModel[] = [defaultModel, configuredModel],
	model: TestModel | undefined = defaultModel,
	signal?: AbortSignal,
	sessionFile?: string,
): TestContext => ({
	model,
	modelRegistry: {
		getAll: () => models,
		getApiKeyAndHeaders: async () => ({
			ok: true,
			apiKey: "test-api-key",
			headers: { "x-test": "header" },
			env: { TEST_PROVIDER_ENV: "value" },
		}),
	},
	sessionManager: {
		getBranch: () => branch,
		getSessionFile: () => sessionFile,
	},
	signal,
});

const createHarness = (branch: SessionEntry[] = [], initialName?: string) => {
	let sessionName = initialName;
	let lastContext = createContext(branch);
	let inputHandler: InputHandler | undefined;
	let agentSettledHandler: AgentSettledHandler | undefined;
	let sessionStartHandler: SessionStartHandler | undefined;
	let sessionInfoChangedHandler: SessionInfoChangedHandler | undefined;
	let sessionShutdownHandler: SessionShutdownHandler | undefined;
	let sessionTreeHandler: SessionTreeHandler | undefined;
	const registeredEvents: string[] = [];

	function on(eventName: "input", handler: InputHandler): void;
	function on(eventName: "agent_settled", handler: AgentSettledHandler): void;
	function on(eventName: "session_start", handler: SessionStartHandler): void;
	function on(
		eventName: "session_info_changed",
		handler: SessionInfoChangedHandler,
	): void;
	function on(
		eventName: "session_shutdown",
		handler: SessionShutdownHandler,
	): void;
	function on(eventName: "session_tree", handler: SessionTreeHandler): void;
	function on(
		...args:
			| [eventName: "input", handler: InputHandler]
			| [eventName: "agent_settled", handler: AgentSettledHandler]
			| [eventName: "session_start", handler: SessionStartHandler]
			| [eventName: "session_info_changed", handler: SessionInfoChangedHandler]
			| [eventName: "session_shutdown", handler: SessionShutdownHandler]
			| [eventName: "session_tree", handler: SessionTreeHandler]
	): void {
		const [eventName, handler] = args;
		registeredEvents.push(eventName);
		switch (eventName) {
			case "input":
				inputHandler = handler;
				break;
			case "agent_settled":
				agentSettledHandler = handler;
				break;
			case "session_start":
				sessionStartHandler = handler;
				break;
			case "session_info_changed":
				sessionInfoChangedHandler = handler;
				break;
			case "session_shutdown":
				sessionShutdownHandler = handler;
				break;
			case "session_tree":
				sessionTreeHandler = handler;
				break;
		}
	}

	const appendSessionInfo = (name: string | undefined) => {
		branch.push({
			...entryBase(),
			type: "session_info",
			name,
		});
	};

	const pi = {
		appendEntry: vi.fn((customType: string, data?: unknown) => {
			branch.push({
				...entryBase(),
				type: "custom",
				customType,
				data,
			});
		}),
		getSessionName: vi.fn(() => sessionName),
		setSessionName: vi.fn((name: string) => {
			sessionName = name;
			appendSessionInfo(name);
			void sessionInfoChangedHandler?.(
				{ type: "session_info_changed", name },
				lastContext,
			);
		}),
		on,
	};

	autoSessionName(pi);

	return {
		branch,
		pi,
		registeredEvents,
		getSessionName: () => sessionName,
		async input(
			text: string,
			ctx = lastContext,
			source: InputEvent["source"] = "interactive",
		) {
			lastContext = ctx;
			await inputHandler?.({ type: "input", text, source }, ctx);
		},
		async agentSettled(ctx = lastContext) {
			lastContext = ctx;
			if (!agentSettledHandler)
				throw new Error("agent_settled handler was not registered");
			await agentSettledHandler({ type: "agent_settled" }, ctx);
		},
		async sessionStart(
			ctx = lastContext,
			reason: SessionStartEvent["reason"] = "startup",
		) {
			lastContext = ctx;
			await sessionStartHandler?.({ type: "session_start", reason }, ctx);
		},
		async sessionTree(ctx = lastContext) {
			lastContext = ctx;
			await sessionTreeHandler?.(
				{
					type: "session_tree",
					newLeafId: null,
					oldLeafId: null,
				},
				ctx,
			);
		},
		async shutdown(
			ctx = lastContext,
			reason: SessionShutdownEvent["reason"] = "quit",
		) {
			lastContext = ctx;
			await sessionShutdownHandler?.({ type: "session_shutdown", reason }, ctx);
		},
		async manualName(name: string | undefined, ctx = lastContext) {
			lastContext = ctx;
			sessionName = name;
			appendSessionInfo(name);
			await sessionInfoChangedHandler?.(
				{ type: "session_info_changed", name },
				ctx,
			);
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
			if (previousHome === undefined) delete process.env.HOME;
			else process.env.HOME = previousHome;
		},
	};
};

const writeSettings = async (home: string, settings: unknown) => {
	const settingsDir = join(home, ".pi", "agent");
	await mkdir(settingsDir, { recursive: true });
	await writeFile(join(settingsDir, "settings.json"), JSON.stringify(settings));
};

const waitForName = async (
	harness: ReturnType<typeof createHarness>,
	name: string,
) => {
	await vi.waitFor(() =>
		expect(harness.pi.setSessionName).toHaveBeenCalledWith(name),
	);
};

const nameInitialSession = async ({
	initialRequest = plainPrompt,
	initialTitle = "Reliable Backup Strategy",
	branch = [userMessageEntry(initialRequest)],
}: {
	initialRequest?: string;
	initialTitle?: string;
	branch?: SessionEntry[];
} = {}) => {
	mocks.completeSimple.mockResolvedValueOnce({ content: initialTitle });
	const harness = createHarness(branch);
	const ctx = createContext(branch);
	await harness.input(initialRequest, ctx);
	await harness.agentSettled(ctx);
	await waitForName(harness, initialTitle);
	return { harness, ctx, branch };
};

describe("settled initial naming and raw input", () => {
	test("registers initial naming on agent_settled and not turn_end", async () => {
		mocks.completeSimple.mockResolvedValue({ content: "Backup Strategy" });
		const branch = [userMessageEntry(plainPrompt)];
		const harness = createHarness(branch);
		const ctx = createContext(branch);

		expect(harness.registeredEvents).toContain("agent_settled");
		expect(harness.registeredEvents).not.toContain("turn_end");
		expect(mocks.completeSimple).not.toHaveBeenCalled();

		await harness.agentSettled(ctx);
		await waitForName(harness, "Backup Strategy");
	});

	test("prefers raw skill arguments over expanded skill content", async () => {
		mocks.completeSimple.mockResolvedValue({
			content: "Readable Session Titles",
		});
		const branch = [userMessageEntry(skillPrefixedPrompt)];
		const harness = createHarness(branch);
		const ctx = createContext(branch);

		await harness.input(
			"/skill:brainstorming Improve session title readability",
			ctx,
		);
		await harness.agentSettled(ctx);
		await vi.waitFor(() => expect(mocks.completeSimple).toHaveBeenCalled());

		const request = JSON.stringify(mocks.completeSimple.mock.calls[0]?.[1]);
		expect(request).toContain("Improve session title readability");
		expect(request).not.toContain("Long skill instructions");
		expect(request).not.toContain("skill-started sessions");
	});

	test("stored fallback strips leading skill XML", async () => {
		mocks.completeSimple.mockResolvedValue({
			content: "Readable Session Titles",
		});
		const branch = [userMessageEntry(skillPrefixedPrompt)];
		const harness = createHarness(branch);
		const ctx = createContext(branch);

		await harness.agentSettled(ctx);
		await vi.waitFor(() => expect(mocks.completeSimple).toHaveBeenCalled());

		const request = JSON.stringify(mocks.completeSimple.mock.calls[0]?.[1]);
		expect(request).toContain(
			"When viewing previous sessions in pi, make skill-started sessions readable.",
		);
		expect(request).not.toContain("Long skill instructions");
	});

	test("command-only raw input falls back to the stored request", async () => {
		mocks.completeSimple.mockResolvedValue({ content: "Stored Request Title" });
		const branch = [userMessageEntry(skillPrefixedPrompt)];
		const harness = createHarness(branch);
		const ctx = createContext(branch);

		await harness.input("/skill:brainstorming", ctx);
		await harness.agentSettled(ctx);
		await vi.waitFor(() => expect(mocks.completeSimple).toHaveBeenCalled());

		const request = JSON.stringify(mocks.completeSimple.mock.calls[0]?.[1]);
		expect(request).toContain("skill-started sessions readable");
		expect(request).not.toContain("/skill:brainstorming");
	});

	test("ignores extension control commands but accepts extension user text", async () => {
		expect(cleanRawUserInput("/skill:planner Build the parser")).toBe(
			"Build the parser",
		);
		expect(cleanRawUserInput("/skill:planner")).toBeUndefined();

		mocks.completeSimple.mockResolvedValue({ content: "Actual User Task" });
		const branch = [userMessageEntry("Stored fallback request")];
		const harness = createHarness(branch);
		const ctx = createContext(branch);
		await harness.input("/internal-control do not use", ctx, "extension");
		await harness.input("Implement the actual parser", ctx, "extension");
		await harness.agentSettled(ctx);
		await vi.waitFor(() => expect(mocks.completeSimple).toHaveBeenCalled());

		const request = JSON.stringify(mocks.completeSimple.mock.calls[0]?.[1]);
		expect(request).toContain("Implement the actual parser");
		expect(request).not.toContain("do not use");
	});

	test("bounds long input while preserving its head and tail", async () => {
		const longRequest = `BEGIN-${"a".repeat(2_000)}-${"z".repeat(2_000)}-END`;
		const bounded = truncateHeadAndTail(longRequest);
		expect(bounded).toHaveLength(1_600);
		expect(bounded).toMatch(/^BEGIN-/);
		expect(bounded).toMatch(/-END$/);
		expect(bounded).toContain("\n...\n");

		mocks.completeSimple.mockResolvedValue({ content: "Bounded Long Request" });
		const branch = [userMessageEntry(longRequest)];
		const harness = createHarness(branch);
		const ctx = createContext(branch);
		await harness.input(longRequest, ctx);
		await harness.agentSettled(ctx);
		await vi.waitFor(() => expect(mocks.completeSimple).toHaveBeenCalled());
		const prompt = mocks.completeSimple.mock.calls[0]?.[1];
		expect(JSON.stringify(prompt)).toContain("BEGIN-");
		expect(JSON.stringify(prompt)).toContain("-END");
		expect(prompt.messages[0]?.content[0]?.text).toHaveLength(1_600);
	});
});

describe("bounded model generation", () => {
	test("uses bounded output, timeout, no retries, deterministic temperature, and no reasoning", async () => {
		mocks.completeSimple.mockResolvedValue({
			content: "Bounded Model Request",
		});
		const branch = [userMessageEntry(plainPrompt)];
		const harness = createHarness(branch);
		const ctx = createContext(branch);

		await harness.agentSettled(ctx);
		await vi.waitFor(() => expect(mocks.completeSimple).toHaveBeenCalled());

		expect(mocks.completeSimple.mock.calls[0]?.[2]).toMatchObject({
			apiKey: "test-api-key",
			headers: { "x-test": "header" },
			env: { TEST_PROVIDER_ENV: "value" },
			maxTokens: 32,
			maxRetries: 0,
			reasoning: undefined,
			temperature: 0,
			timeoutMs: 8_000,
		});
		expect(mocks.completeSimple.mock.calls[0]?.[2].signal).toBeInstanceOf(
			AbortSignal,
		);
	});

	test("an abort bounds stalled authentication and falls back safely", async () => {
		const controller = new AbortController();
		const branch = [userMessageEntry(plainPrompt)];
		const harness = createHarness(branch);
		const ctx = createContext(
			branch,
			[defaultModel, configuredModel],
			defaultModel,
			controller.signal,
		);
		const authStarted = vi.fn();
		ctx.modelRegistry.getApiKeyAndHeaders = () => {
			authStarted();
			return new Promise(() => undefined);
		};

		await harness.agentSettled(ctx);
		await vi.waitFor(() => expect(authStarted).toHaveBeenCalled());
		controller.abort();
		await waitForName(harness, "Help me design a reliable backup strategy for");
	});

	test("explicitly disables reasoning for OpenAI Codex Responses", async () => {
		const codexModel = makeTestModel("codex-model", "openai-codex-responses");
		mocks.complete.mockResolvedValue({ content: "No Reasoning Title" });
		const branch = [userMessageEntry(plainPrompt)];
		const harness = createHarness(branch);
		const ctx = createContext(branch, [codexModel], codexModel);

		await harness.agentSettled(ctx);
		await vi.waitFor(() => expect(mocks.complete).toHaveBeenCalled());

		expect(mocks.complete.mock.calls[0]?.[2]).toMatchObject({
			maxTokens: 32,
			maxRetries: 0,
			reasoningEffort: "none",
			temperature: 0,
			timeoutMs: 8_000,
		});
	});

	test("allows only one initial title request in flight", async () => {
		let resolveTitle: (value: { content: string }) => void = () => undefined;
		mocks.completeSimple.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveTitle = resolve;
				}),
		);
		const branch = [userMessageEntry(plainPrompt)];
		const harness = createHarness(branch);
		const ctx = createContext(branch);

		await harness.agentSettled(ctx);
		await harness.agentSettled(ctx);
		await vi.waitFor(() =>
			expect(mocks.completeSimple).toHaveBeenCalledTimes(1),
		);
		resolveTitle({ content: "Single Request Title" });
		await waitForName(harness, "Single Request Title");
	});
});

describe("ownership and stale async results", () => {
	test("an existing manual name prevents initial generation", async () => {
		const branch = [userMessageEntry(plainPrompt)];
		const harness = createHarness(branch, "CLI supplied name");
		await harness.sessionStart(createContext(branch));
		await harness.agentSettled(createContext(branch));

		expect(mocks.completeSimple).not.toHaveBeenCalled();
		expect(harness.pi.setSessionName).not.toHaveBeenCalled();
	});

	test("a manual rename during generation prevents applying the result", async () => {
		let resolveTitle: (value: { content: string }) => void = () => undefined;
		mocks.completeSimple.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveTitle = resolve;
				}),
		);
		const branch = [userMessageEntry(plainPrompt)];
		const harness = createHarness(branch);
		const ctx = createContext(branch);

		await harness.agentSettled(ctx);
		await vi.waitFor(() => expect(mocks.completeSimple).toHaveBeenCalled());
		await harness.manualName("User supplied name", ctx);
		resolveTitle({ content: "Stale Model Title" });
		await vi.waitFor(() =>
			expect(harness.getSessionName()).toBe("User supplied name"),
		);
		expect(harness.pi.setSessionName).not.toHaveBeenCalled();
	});

	test("a session-picker rename persisted during generation prevents application", async () => {
		if (!isolatedHome) throw new Error("test home was not initialized");
		const sessionFile = join(isolatedHome, "session.jsonl");
		await writeFile(
			sessionFile,
			`${JSON.stringify({
				type: "session",
				version: 3,
				id: "test-session",
				timestamp: new Date(0).toISOString(),
				cwd: "/tmp",
			})}\n`,
		);

		let resolveTitle: (value: { content: string }) => void = () => undefined;
		mocks.completeSimple.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveTitle = resolve;
				}),
		);
		const branch = [userMessageEntry(plainPrompt)];
		const harness = createHarness(branch);
		const ctx = createContext(
			branch,
			[defaultModel, configuredModel],
			defaultModel,
			undefined,
			sessionFile,
		);
		await harness.agentSettled(ctx);
		await vi.waitFor(() => expect(mocks.completeSimple).toHaveBeenCalled());

		await appendFile(
			sessionFile,
			`${JSON.stringify({
				type: "session_info",
				id: "abcdef12",
				parentId: null,
				timestamp: new Date(1_000).toISOString(),
				name: "Picker supplied name",
			})}\n`,
		);
		resolveTitle({ content: "Stale Model Title" });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(harness.pi.setSessionName).not.toHaveBeenCalled();
	});

	test("shutdown and replacement prevent stale async application", async () => {
		let resolveTitle: (value: { content: string }) => void = () => undefined;
		mocks.completeSimple.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveTitle = resolve;
				}),
		);
		const oldBranch = [userMessageEntry(plainPrompt)];
		const harness = createHarness(oldBranch);
		const oldContext = createContext(oldBranch);
		await harness.agentSettled(oldContext);
		await vi.waitFor(() => expect(mocks.completeSimple).toHaveBeenCalled());

		await harness.shutdown(oldContext, "new");
		const replacementBranch: SessionEntry[] = [];
		await harness.sessionStart(createContext(replacementBranch), "new");
		resolveTitle({ content: "Old Session Title" });
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(harness.pi.setSessionName).not.toHaveBeenCalled();
	});

	test("automatic ownership survives reload through branch custom entries", async () => {
		const { harness, branch } = await nameInitialSession();
		const title = harness.getSessionName();
		const reloaded = createHarness(branch, title);
		await reloaded.sessionStart(createContext(branch), "reload");

		branch.push(userMessageEntry("Actually, switch to repairing OB-1234."));
		mocks.completeSimple.mockResolvedValueOnce({ content: "Repair OB-1234" });
		await reloaded.input("Actually, switch to repairing OB-1234.");
		await reloaded.agentSettled(createContext(branch));
		await waitForName(reloaded, "Repair OB-1234");
	});

	test("a differing current title is treated as user-owned", async () => {
		const state: AutoTitleState = {
			title: "Automatic Title",
			originalRequest: "Help me with this",
			phase: "initial",
			refinementAttempted: false,
			initialFallback: false,
		};
		const branch = [
			userMessageEntry("Help me with this"),
			customStateEntry(state),
			userMessageEntry("Actually, switch to OB-1234"),
		];
		const harness = createHarness(branch, "Manual Title");
		const ctx = createContext(branch);
		await harness.sessionStart(ctx, "resume");
		await harness.agentSettled(ctx);

		expect(mocks.completeSimple).not.toHaveBeenCalled();
		expect(harness.pi.setSessionName).not.toHaveBeenCalled();
	});

	test("clearing an automatic title prevents restoration", async () => {
		const { harness, branch, ctx } = await nameInitialSession();
		await harness.manualName(undefined, ctx);
		branch.push(userMessageEntry("Actually, switch to OB-1234"));
		await harness.input("Actually, switch to OB-1234", ctx);
		await harness.agentSettled(ctx);

		expect(harness.pi.setSessionName).toHaveBeenCalledTimes(1);
		expect(harness.getSessionName()).toBeUndefined();
		expect(mocks.completeSimple).toHaveBeenCalledTimes(1);
	});

	test("reconstructs only the latest state on the active branch", () => {
		const initial: AutoTitleState = {
			title: "Initial",
			originalRequest: "Fix this",
			phase: "initial",
			refinementAttempted: false,
			initialFallback: true,
		};
		const refined: AutoTitleState = {
			...initial,
			title: "Refined",
			phase: "refinement",
			refinementAttempted: true,
		};
		expect(
			reconstructAutoTitleState([
				customStateEntry(initial),
				customStateEntry(refined),
			]),
		).toEqual(refined);
	});
});

describe("conditional one-time refinement", () => {
	test("a weak initial request becomes eligible after three user requests", () => {
		const state: AutoTitleState = {
			title: "Help With This",
			originalRequest: "Help me with this.",
			phase: "initial",
			refinementAttempted: false,
			initialFallback: false,
		};
		expect(
			shouldRefineTitle({
				state,
				userRequests: [
					"Help me with this.",
					"The failing area is the auth package.",
					"The symbol is `refreshToken`.",
				],
			}),
		).toBe(true);
		expect(isWeakRequest("Can you take a look?")).toBe(true);
		expect(isWeakRequest("Implement the auth parser")).toBe(false);
	});

	test("a deterministic fallback permits one later refinement even for a strong request", () => {
		const state: AutoTitleState = {
			title: "Implement Reliable Backup Rotation",
			originalRequest: "Implement reliable backup rotation for home servers",
			phase: "initial",
			refinementAttempted: false,
			initialFallback: true,
		};
		expect(
			shouldRefineTitle({
				state,
				userRequests: [
					state.originalRequest,
					"Add retention validation.",
					"Cover the parser with tests.",
				],
			}),
		).toBe(true);
	});

	test("a strong initial title does not trigger routine refinement", async () => {
		const { harness, branch, ctx } = await nameInitialSession({
			initialRequest: "Implement reliable backup rotation for home servers",
			initialTitle: "Reliable Backup Rotation",
		});
		branch.push(
			userMessageEntry("Add validation around retention days."),
			userMessageEntry("Cover the parser with unit tests."),
		);
		await harness.input("Add validation around retention days.", ctx);
		await harness.input("Cover the parser with unit tests.", ctx);
		await harness.agentSettled(ctx);

		expect(mocks.completeSimple).toHaveBeenCalledTimes(1);
		expect(harness.pi.setSessionName).toHaveBeenCalledTimes(1);
	});

	test("a clear later direction change triggers refinement with newest anchors first", async () => {
		const originalRequest =
			"Review `OLD_1` `OLD_2` `OLD_3` `OLD_4` `OLD_5` `OLD_6` `OLD_7` `OLD_8`.";
		const { harness, branch, ctx } = await nameInitialSession({
			initialRequest: originalRequest,
			initialTitle: "Review Legacy Components",
		});
		const newTask = "Actually, switch to fixing the OB-1234 login regression.";
		branch.push(userMessageEntry(newTask));
		await harness.input(newTask, ctx);
		mocks.completeSimple.mockResolvedValueOnce({
			content: "Fix OB-1234 Login",
		});
		await harness.agentSettled(ctx);
		await waitForName(harness, "Fix OB-1234 Login");
		expect(hasDirectionChange(newTask)).toBe(true);
		const refinementPrompt = mocks.completeSimple.mock.calls[1]?.[1];
		expect(refinementPrompt.messages[0]?.content[0]?.text).toContain(
			"Stable anchors: OB-1234",
		);
	});

	test("ticket, PR, path, and symbol anchors inform refinement", async () => {
		const { harness, branch, ctx } = await nameInitialSession({
			initialRequest: "Fix this.",
			initialTitle: "Fix This",
		});
		const second =
			"The work is OB-1234 and https://github.com/acme/app/pull/42 in src/auth/session.ts.";
		const third = "Update `SessionManager.refreshToken` and ERR_AUTH_EXPIRED.";
		branch.push(userMessageEntry(second), userMessageEntry(third));
		await harness.input(second, ctx);
		await harness.input(third, ctx);
		mocks.completeSimple.mockResolvedValueOnce({
			content: "Fix OB-1234 Session Auth",
		});
		await harness.agentSettled(ctx);
		await vi.waitFor(() =>
			expect(mocks.completeSimple).toHaveBeenCalledTimes(2),
		);

		const refinementPrompt = JSON.stringify(
			mocks.completeSimple.mock.calls[1]?.[1],
		);
		expect(refinementPrompt).toContain("OB-1234");
		expect(refinementPrompt).toContain("pull/42");
		expect(refinementPrompt).toContain("src/auth/session.ts");
		expect(refinementPrompt).toContain("SessionManager.refreshToken");
		expect(refinementPrompt).toContain("ERR_AUTH_EXPIRED");
		expect(extractStableAnchors([second, third])).toEqual(
			expect.arrayContaining([
				"OB-1234",
				"src/auth/session.ts",
				"SessionManager.refreshToken",
				"ERR_AUTH_EXPIRED",
			]),
		);
	});

	test("refinement context excludes assistant text, tool results, and full transcript", async () => {
		const { harness, branch, ctx } = await nameInitialSession({
			initialRequest: "Help me with this.",
			initialTitle: "Help With This",
		});
		branch.push(
			assistantMessageEntry("SECRET_ASSISTANT_TRANSCRIPT"),
			toolResultEntry("SECRET_TOOL_RESULT"),
			userMessageEntry("It concerns the auth package."),
			userMessageEntry("Focus on `refreshToken` in src/auth/token.ts."),
		);
		await harness.input("It concerns the auth package.", ctx);
		await harness.input("Focus on `refreshToken` in src/auth/token.ts.", ctx);
		mocks.completeSimple.mockResolvedValueOnce({
			content: "Refresh Auth Tokens",
		});
		await harness.agentSettled(ctx);
		await vi.waitFor(() =>
			expect(mocks.completeSimple).toHaveBeenCalledTimes(2),
		);

		const prompt = JSON.stringify(mocks.completeSimple.mock.calls[1]?.[1]);
		expect(prompt).not.toContain("SECRET_ASSISTANT_TRANSCRIPT");
		expect(prompt).not.toContain("SECRET_TOOL_RESULT");
		expect(prompt).toContain("Recent request 1");
		expect(prompt).toContain("Stable anchors");
	});

	test("an unchanged result consumes refinement without another session name", async () => {
		const { harness, branch, ctx } = await nameInitialSession({
			initialRequest: "Fix this.",
			initialTitle: "Fix This",
		});
		branch.push(
			userMessageEntry("The issue is in authentication."),
			userMessageEntry("The failing symbol is `refreshToken`."),
		);
		await harness.input("The issue is in authentication.", ctx);
		await harness.input("The failing symbol is `refreshToken`.", ctx);
		mocks.completeSimple.mockResolvedValueOnce({ content: "Fix This" });
		await harness.agentSettled(ctx);
		await vi.waitFor(() =>
			expect(mocks.completeSimple).toHaveBeenCalledTimes(2),
		);

		expect(harness.pi.setSessionName).toHaveBeenCalledTimes(1);
		const state = reconstructAutoTitleState(branch);
		expect(state?.refinementAttempted).toBe(true);
	});

	test("refinement is attempted no more than once", async () => {
		const { harness, branch, ctx } = await nameInitialSession({
			initialRequest: "Fix this.",
			initialTitle: "Fix This",
		});
		branch.push(
			userMessageEntry("The issue is authentication."),
			userMessageEntry("The symbol is `refreshToken`."),
		);
		await harness.input("The issue is authentication.", ctx);
		await harness.input("The symbol is `refreshToken`.", ctx);
		mocks.completeSimple.mockResolvedValueOnce({
			content: "Repair Auth Refresh",
		});
		await harness.agentSettled(ctx);
		await waitForName(harness, "Repair Auth Refresh");

		branch.push(userMessageEntry("Actually, switch to another task."));
		await harness.input("Actually, switch to another task.", ctx);
		await harness.agentSettled(ctx);
		expect(mocks.completeSimple).toHaveBeenCalledTimes(2);
	});

	test("refinement failure leaves the title unchanged and is not retried", async () => {
		const { harness, branch, ctx } = await nameInitialSession({
			initialRequest: "Fix this.",
			initialTitle: "Fix This",
		});
		branch.push(
			userMessageEntry("The issue is authentication."),
			userMessageEntry("The symbol is `refreshToken`."),
		);
		await harness.input("The issue is authentication.", ctx);
		await harness.input("The symbol is `refreshToken`.", ctx);
		mocks.completeSimple.mockRejectedValueOnce(new Error("provider down"));
		await harness.agentSettled(ctx);
		await vi.waitFor(() =>
			expect(mocks.completeSimple).toHaveBeenCalledTimes(2),
		);
		await harness.agentSettled(ctx);

		expect(mocks.completeSimple).toHaveBeenCalledTimes(2);
		expect(harness.getSessionName()).toBe("Fix This");
		expect(harness.pi.setSessionName).toHaveBeenCalledTimes(1);
		expect(reconstructAutoTitleState(branch)?.refinementAttempted).toBe(true);
	});

	test("prompt construction uses only its compact envelope", () => {
		const prompt = createRefinementTitlePrompt({
			currentTitle: "Current Title",
			originalRequest: "Original request",
			recentRequests: ["Recent one", "Recent two"],
			anchors: ["OB-1234", "src/auth.ts"],
		});
		const serialized = JSON.stringify(prompt);
		expect(serialized).toContain("Keep the current title");
		expect(serialized).toContain("OB-1234");
		expect(serialized).not.toContain("assistant");
		expect(serialized).not.toContain("toolResult");
	});
});

describe("fallbacks, settings, and no backfill", () => {
	test("initial generation failure uses the deterministic fallback", async () => {
		mocks.completeSimple.mockRejectedValue(new Error("provider unavailable"));
		const branch = [userMessageEntry(plainPrompt)];
		const harness = createHarness(branch);
		await harness.agentSettled(createContext(branch));
		await waitForName(harness, "Help me design a reliable backup strategy for");
		expect(reconstructAutoTitleState(branch)?.initialFallback).toBe(true);
	});

	test.each(["error", "aborted"])(
		"%s completion responses discard partial title text",
		async (stopReason) => {
			mocks.completeSimple.mockResolvedValue({
				content: "Partial Provider Title",
				stopReason,
				errorMessage: "provider failed",
			});
			const request = "Implement reliable backup rotation for home servers";
			const branch = [userMessageEntry(request)];
			const harness = createHarness(branch);
			await harness.agentSettled(createContext(branch));

			await waitForName(
				harness,
				"Implement reliable backup rotation for home servers",
			);
			expect(harness.getSessionName()).not.toBe("Partial Provider Title");
		},
	);

	test("enabled false opts out", async () => {
		const tempHome = await useTempHome();
		try {
			await writeSettings(tempHome.home, {
				autoSessionName: { enabled: false },
			});
			const branch = [userMessageEntry(plainPrompt)];
			const harness = createHarness(branch);
			await harness.agentSettled(createContext(branch));
			await vi.waitFor(() =>
				expect(mocks.completeSimple).not.toHaveBeenCalled(),
			);
			expect(harness.pi.setSessionName).not.toHaveBeenCalled();
		} finally {
			tempHome.restore();
		}
	});

	test("uses configured titleModel and preserves ordered model resolution fallback", async () => {
		const tempHome = await useTempHome();
		try {
			await writeSettings(tempHome.home, {
				autoSessionName: {
					titleModel: ["missing-model", "configured-model"],
				},
			});
			mocks.completeSimple.mockResolvedValue({
				content: "Configured Model Title",
			});
			const branch = [userMessageEntry(plainPrompt)];
			const harness = createHarness(branch);
			await harness.agentSettled(createContext(branch));
			await waitForName(harness, "Configured Model Title");
			expect(mocks.completeSimple.mock.calls[0]?.[0]).toBe(configuredModel);
		} finally {
			tempHome.restore();
		}
	});

	test("invalid titleModel falls back to session-default", async () => {
		const tempHome = await useTempHome();
		try {
			await writeSettings(tempHome.home, {
				autoSessionName: { titleModel: "configured-model" },
			});
			mocks.completeSimple.mockResolvedValue({
				content: "Default Model Title",
			});
			const branch = [userMessageEntry(plainPrompt)];
			const harness = createHarness(branch);
			await harness.agentSettled(createContext(branch));
			await waitForName(harness, "Default Model Title");
			expect(mocks.completeSimple.mock.calls[0]?.[0]).toBe(defaultModel);
		} finally {
			tempHome.restore();
		}
	});

	test("unresolved models use deterministic fallback", async () => {
		const tempHome = await useTempHome();
		try {
			await writeSettings(tempHome.home, {
				autoSessionName: { titleModel: ["missing-model"] },
			});
			const branch = [userMessageEntry(plainPrompt)];
			const harness = createHarness(branch);
			await harness.agentSettled(createContext(branch));
			await waitForName(
				harness,
				"Help me design a reliable backup strategy for",
			);
			expect(mocks.completeSimple).not.toHaveBeenCalled();
		} finally {
			tempHome.restore();
		}
	});

	test("session_start reconstructs state without historical naming work", async () => {
		vi.useFakeTimers();
		const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
		const branch = [userMessageEntry(skillPrefixedPrompt)];
		const harness = createHarness(branch);
		await harness.sessionStart(createContext(branch), "resume");
		await vi.runOnlyPendingTimersAsync();

		expect(mocks.completeSimple).not.toHaveBeenCalled();
		expect(harness.pi.setSessionName).not.toHaveBeenCalled();
		expect(timeoutSpy).not.toHaveBeenCalled();
	});

	test("a resumed unnamed historical session is not backfilled on later settles", async () => {
		const branch = [userMessageEntry("Historical request")];
		const harness = createHarness(branch);
		const ctx = createContext(branch);
		await harness.sessionStart(ctx, "resume");
		branch.push(userMessageEntry("A new request after resume"));
		await harness.input("A new request after resume", ctx);
		await harness.agentSettled(ctx);

		expect(mocks.completeSimple).not.toHaveBeenCalled();
		expect(harness.pi.setSessionName).not.toHaveBeenCalled();
	});
});

beforeEach(async () => {
	mocks.complete.mockReset();
	mocks.completeSimple.mockReset();
	entrySequence = 0;
	originalHome = process.env.HOME;
	isolatedHome = await mkdtemp(join(tmpdir(), "auto-session-name-home-"));
	process.env.HOME = isolatedHome;
});

afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	if (isolatedHome) {
		await rm(isolatedHome, { recursive: true, force: true });
	}
	originalHome = undefined;
	isolatedHome = undefined;
});
