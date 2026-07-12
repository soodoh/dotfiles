import path from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { INITIAL_RUNTIME_STATE } from "../src/domain/state";

const compositionCwds = vi.hoisted((): string[] => []);
const createAppCompositionMock = vi.hoisted(() =>
	vi.fn(async (_pi: unknown, cwd = process.cwd()) => {
		compositionCwds.push(cwd);
		return {
			config: {
				suggestion: {
					ghostAcceptKeys: ["right"],
					ghostAcceptAndSendKeys: ["enter"],
				},
			},
			runtimeRef: {
				setContext() {},
				clearContext() {},
				bumpEpoch() {
					return 1;
				},
				getSuggestion() {
					return undefined;
				},
				getSuggestionRevision() {
					return 0;
				},
				getLastBootstrappedLeafId() {
					return undefined;
				},
				markBootstrappedLeafId() {},
				setLastTurnContext() {},
			},
			stores: {
				seedStore: {},
				stateStore: {
					async load() {
						return INITIAL_RUNTIME_STATE;
					},
				},
			},
			eventLog: {},
			orchestrators: {
				sessionStart: { async handle() {} },
				agentEnd: { async handle() {} },
				userSubmit: { async handle() {} },
				reseedRunner: { async trigger() {} },
			},
		};
	}),
);

vi.mock("../src/composition/root", () => ({
	createAppComposition: createAppCompositionMock,
}));

const { default: suggester } = await import("../src/index");

type PromptSuggesterApi = Parameters<typeof suggester>[0];
type ApiHandler = Parameters<PromptSuggesterApi["on"]>[1];
type SessionContext = Parameters<ApiHandler>[1];
type Handler = (
	event: unknown,
	ctx: SessionContext,
) => unknown | Promise<unknown>;

function createPi() {
	const handlers = new Map<string, Handler>();
	return {
		handlers,
		on(eventName: string, handler: Handler) {
			handlers.set(eventName, handler);
		},
		getThinkingLevel(): ReturnType<PromptSuggesterApi["getThinkingLevel"]> {
			return "off";
		},
	};
}

function createContext(
	cwd: string,
	options: { sessionFile?: string; sessionId?: string } = {},
): SessionContext {
	return {
		hasUI: false,
		sessionManager: {
			getCwd() {
				return cwd;
			},
			getSessionFile() {
				return options.sessionFile;
			},
			getSessionId() {
				return options.sessionId ?? options.sessionFile ?? "session-1";
			},
			getLeafId() {
				return "leaf-1";
			},
			getBranch() {
				return [];
			},
		},
	};
}

beforeEach(() => {
	compositionCwds.length = 0;
	createAppCompositionMock.mockClear();
});

test("prompt suggester caches app composition by active session cwd and session", async () => {
	const firstCwd = path.resolve("/tmp/project-one");
	const secondCwd = path.resolve("/tmp/project-two");
	const pi = createPi();
	const firstContext = createContext(firstCwd, { sessionId: "session-one" });
	suggester(pi);

	await pi.handlers.get("session_start")?.({}, firstContext);
	await pi.handlers.get("session_start")?.({}, firstContext);
	await pi.handlers.get("session_start")?.({}, createContext(secondCwd));

	expect(compositionCwds).toEqual([firstCwd, secondCwd]);
	expect(createAppCompositionMock).toHaveBeenNthCalledWith(1, pi, firstCwd);
	expect(createAppCompositionMock).toHaveBeenNthCalledWith(2, pi, secondCwd);
});

test("prompt suggester isolates runtime composition for simultaneous same-project sessions", async () => {
	const cwd = path.resolve("/tmp/project-one");
	const pi = createPi();
	suggester(pi);

	await pi.handlers.get("session_start")?.(
		{},
		createContext(cwd, { sessionFile: "/tmp/session-a.json" }),
	);
	await pi.handlers.get("session_start")?.(
		{},
		createContext(cwd, { sessionFile: "/tmp/session-b.json" }),
	);

	expect(compositionCwds).toEqual([cwd, cwd]);
	expect(createAppCompositionMock).toHaveBeenCalledTimes(2);
	expect(createAppCompositionMock).toHaveBeenNthCalledWith(1, pi, cwd);
	expect(createAppCompositionMock).toHaveBeenNthCalledWith(2, pi, cwd);
});

test("prompt suggester recreates session composition after shutdown", async () => {
	const cwd = path.resolve("/tmp/project-one");
	const pi = createPi();
	const ctx = createContext(cwd, { sessionId: "session-one" });
	suggester(pi);

	await pi.handlers.get("session_start")?.({}, ctx);
	await pi.handlers.get("session_shutdown")?.({}, ctx);
	await pi.handlers.get("session_start")?.({}, ctx);

	expect(compositionCwds).toEqual([cwd, cwd]);
	expect(createAppCompositionMock).toHaveBeenCalledTimes(2);
});

test("prompt suggester ignores stale shutdown contexts before resolving composition key", async () => {
	const pi = createPi();
	suggester(pi);
	const staleContext: SessionContext = {
		hasUI: false,
		sessionManager: {
			getCwd() {
				throw new Error("extension ctx is stale");
			},
			getSessionFile() {
				throw new Error("extension ctx is stale");
			},
			getLeafId() {
				return "leaf-1";
			},
			getBranch() {
				return [];
			},
		},
	};

	await expect(
		pi.handlers.get("session_shutdown")?.({}, staleContext),
	).resolves.toBeUndefined();
	expect(createAppCompositionMock).not.toHaveBeenCalled();
});
