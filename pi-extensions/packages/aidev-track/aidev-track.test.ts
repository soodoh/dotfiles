import type {
	AgentSettledEvent,
	AgentStartEvent,
	BeforeAgentStartEvent,
	SessionShutdownEvent,
	ToolCallEvent,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test, vi } from "vitest";

import { agentSettledEvent } from "../../test-support/events";
import { createAidevTrackExtension, runAidevTrack } from "./aidev-track";

type SpawnOptions = { cwd: string; stdio: ["pipe", "ignore", "ignore"] };
type ErrorListener = (error: NodeJS.ErrnoException) => void;
type CloseListener = (code: number | null) => void;

class FakeChild {
	stdinChunks: string[] = [];
	stdinEnded = false;
	killed = false;
	killSignal: string | undefined;
	private stdinErrorListeners: ErrorListener[] = [];
	private errorListeners: ErrorListener[] = [];
	private closeListeners: CloseListener[] = [];

	stdin = {
		on: (_event: "error", listener: ErrorListener) => {
			this.stdinErrorListeners.push(listener);
		},
		write: (chunk: string): unknown => {
			this.stdinChunks.push(chunk);
			return true;
		},
		end: (chunk?: string): unknown => {
			if (chunk) this.stdinChunks.push(chunk);
			this.stdinEnded = true;
			return this;
		},
	};

	on(event: "error", listener: ErrorListener): unknown;
	on(event: "close", listener: CloseListener): unknown;
	on(
		...args:
			| [event: "error", listener: ErrorListener]
			| [event: "close", listener: CloseListener]
	): unknown {
		const [event, listener] = args;
		if (event === "error") this.errorListeners.push(listener);
		else this.closeListeners.push(listener);
		return this;
	}

	kill(signal: "SIGKILL"): unknown {
		this.killed = true;
		this.killSignal = signal;
		return true;
	}

	emitStdinError(error: NodeJS.ErrnoException): void {
		for (const listener of this.stdinErrorListeners) listener(error);
	}

	emitError(error: NodeJS.ErrnoException): void {
		for (const listener of this.errorListeners) listener(error);
	}

	emitClose(code: number | null = 0): void {
		for (const listener of this.closeListeners) listener(code);
	}
}

type SpawnCall = {
	command: string;
	args: string[];
	options: SpawnOptions;
	child: FakeChild;
};

type SpawnBehavior = "close" | "error-missing" | "error-other" | "hang";

function createFakeSpawn(behavior: SpawnBehavior) {
	const calls: SpawnCall[] = [];
	const spawn = (
		command: string,
		args: string[],
		options: SpawnOptions,
	): FakeChild => {
		const child = new FakeChild();
		calls.push({ command, args, options, child });
		if (behavior === "close") {
			queueMicrotask(() => child.emitClose(0));
		} else if (behavior === "error-missing") {
			queueMicrotask(() => {
				const error: NodeJS.ErrnoException = new Error("not found");
				error.code = "ENOENT";
				child.emitError(error);
			});
		} else if (behavior === "error-other") {
			queueMicrotask(() => {
				const error: NodeJS.ErrnoException = new Error("boom");
				error.code = "EPERM";
				child.emitError(error);
			});
		}
		return child;
	};
	return { spawn, calls };
}

function lastPayload(call: SpawnCall): Record<string, unknown> {
	const raw = call.child.stdinChunks.join("");
	return JSON.parse(raw.trim());
}

const ctx = {
	cwd: "/repo",
	sessionManager: { getSessionId: () => "session-xyz" },
};

const beforeAgentStart = (prompt: string): BeforeAgentStartEvent => ({
	type: "before_agent_start",
	prompt,
	systemPrompt: "",
	systemPromptOptions: {
		cwd: "/repo",
		selectedTools: [],
		hiddenTools: [],
		toolSnippets: {},
		toolGuidelines: {},
		promptGuidelines: [],
		appendSystemPrompt: "",
		sections: {},
		contextFiles: [],
		skills: [],
	},
});

const toolCall = (toolName: string, path: string): ToolCallEvent => ({
	type: "tool_call",
	toolCallId: "call-1",
	toolName,
	input: { path },
});

const toolResult = (toolName: string, path: string): ToolResultEvent => ({
	type: "tool_result",
	toolCallId: "call-1",
	toolName,
	input: { path },
	content: [],
	isError: false,
	details: undefined,
});

const agentSettled = agentSettledEvent();

type Handlers = {
	agent_start?: (
		event: AgentStartEvent,
		context: typeof ctx,
	) => void | Promise<void>;
	session_shutdown?: (
		event: SessionShutdownEvent,
		context: typeof ctx,
	) => void | Promise<void>;
	before_agent_start?: (
		event: BeforeAgentStartEvent,
		context: typeof ctx,
	) => void | Promise<void>;
	tool_call?: (
		event: ToolCallEvent,
		context: typeof ctx,
	) => void | Promise<void>;
	tool_result?: (
		event: ToolResultEvent,
		context: typeof ctx,
	) => void | Promise<void>;
	agent_settled?: (
		event: AgentSettledEvent,
		context: typeof ctx,
	) => void | Promise<void>;
};

function createHarness(behavior: SpawnBehavior = "close") {
	const { spawn, calls } = createFakeSpawn(behavior);
	const handlers: Handlers = {};

	function on(
		event: "agent_start",
		handler: NonNullable<Handlers["agent_start"]>,
	): void;
	function on(
		event: "session_shutdown",
		handler: NonNullable<Handlers["session_shutdown"]>,
	): void;
	function on(
		event: "before_agent_start",
		handler: NonNullable<Handlers["before_agent_start"]>,
	): void;
	function on(
		event: "tool_call",
		handler: NonNullable<Handlers["tool_call"]>,
	): void;
	function on(
		event: "tool_result",
		handler: NonNullable<Handlers["tool_result"]>,
	): void;
	function on(
		event: "agent_settled",
		handler: NonNullable<Handlers["agent_settled"]>,
	): void;
	function on(
		...args:
			| [event: "agent_start", handler: NonNullable<Handlers["agent_start"]>]
			| [
					event: "session_shutdown",
					handler: NonNullable<Handlers["session_shutdown"]>,
			  ]
			| [
					event: "before_agent_start",
					handler: NonNullable<Handlers["before_agent_start"]>,
			  ]
			| [event: "tool_call", handler: NonNullable<Handlers["tool_call"]>]
			| [event: "tool_result", handler: NonNullable<Handlers["tool_result"]>]
			| [
					event: "agent_settled",
					handler: NonNullable<Handlers["agent_settled"]>,
			  ]
	): void {
		const [event, handler] = args;
		switch (event) {
			case "agent_start":
				handlers.agent_start = handler;
				break;
			case "session_shutdown":
				handlers.session_shutdown = handler;
				break;
			case "before_agent_start":
				handlers.before_agent_start = handler;
				break;
			case "tool_call":
				handlers.tool_call = handler;
				break;
			case "tool_result":
				handlers.tool_result = handler;
				break;
			case "agent_settled":
				handlers.agent_settled = handler;
				break;
		}
	}

	createAidevTrackExtension({ spawn, timeoutMs: 1_000 })({ on });

	return { calls, handlers };
}

describe("runAidevTrack", () => {
	test.each([7, null])("reports unsuccessful exit %s", async (code) => {
		const { spawn, calls } = createFakeSpawn("hang");
		const result = runAidevTrack(
			{ spawn, timeoutMs: 1000 },
			"checkpoint",
			{},
			"/repo",
		);
		calls[0].child.emitClose(code);
		expect(await result).toBe("error");
	});

	test("absorbs asynchronous stdin errors and terminates the writer", async () => {
		const { spawn, calls } = createFakeSpawn("hang");
		const result = runAidevTrack(
			{ spawn, timeoutMs: 1000 },
			"checkpoint",
			{},
			"/repo",
		);
		calls[0].child.emitStdinError(
			Object.assign(new Error("pipe closed"), { code: "EPIPE" }),
		);
		expect(calls[0].child.killSignal).toBe("SIGKILL");
		calls[0].child.emitClose(0);
		expect(await result).toBe("error");
	});

	test("cancellation terminates an active hook and skips cancelled launches", async () => {
		const { spawn, calls } = createFakeSpawn("hang");
		const controller = new AbortController();
		const result = runAidevTrack(
			{ spawn, timeoutMs: 1000 },
			"checkpoint",
			{},
			"/repo",
			controller.signal,
		);
		controller.abort();
		expect(calls[0].child.killSignal).toBe("SIGKILL");
		calls[0].child.emitClose(null);
		expect(await result).toBe("cancelled");
		expect(
			await runAidevTrack(
				{ spawn, timeoutMs: 1000 },
				"checkpoint",
				{},
				"/repo",
				controller.signal,
			),
		).toBe("cancelled");
		expect(calls).toHaveLength(1);
	});
	test("resolves ok, writes JSON payload to stdin, and passes correct args", async () => {
		const { spawn, calls } = createFakeSpawn("close");
		const status = await runAidevTrack(
			{ spawn, timeoutMs: 1_000 },
			"turn-start",
			{ session_id: "s1", hook_event_name: "UserPromptSubmit" },
			"/repo",
		);

		expect(status).toBe("ok");
		expect(calls).toHaveLength(1);
		expect(calls[0].command).toBe("aidev-track");
		expect(calls[0].args).toEqual([
			"turn-start",
			"pi",
			"--hook-input",
			"stdin",
		]);
		expect(calls[0].options.cwd).toBe("/repo");
		expect(calls[0].options.stdio).toEqual(["pipe", "ignore", "ignore"]);
		expect(calls[0].child.stdinEnded).toBe(true);
		expect(lastPayload(calls[0])).toEqual({
			session_id: "s1",
			hook_event_name: "UserPromptSubmit",
		});
	});

	test("resolves missing on ENOENT error event", async () => {
		const { spawn } = createFakeSpawn("error-missing");
		const status = await runAidevTrack(
			{ spawn, timeoutMs: 1_000 },
			"checkpoint",
			{},
			"/repo",
		);
		expect(status).toBe("missing");
	});

	test("resolves error on non-ENOENT error event", async () => {
		const { spawn } = createFakeSpawn("error-other");
		const status = await runAidevTrack(
			{ spawn, timeoutMs: 1_000 },
			"checkpoint",
			{},
			"/repo",
		);
		expect(status).toBe("error");
	});

	test("resolves missing when spawn throws ENOENT", async () => {
		const spawn = () => {
			const error: NodeJS.ErrnoException = new Error("nope");
			error.code = "ENOENT";
			throw error;
		};
		const status = await runAidevTrack(
			{ spawn, timeoutMs: 1_000 },
			"turn-end",
			{},
			"/repo",
		);
		expect(status).toBe("missing");
	});

	test("resolves error when spawn throws non-ENOENT", async () => {
		const spawn = () => {
			throw new Error("kaboom");
		};
		const status = await runAidevTrack(
			{ spawn, timeoutMs: 1_000 },
			"turn-end",
			{},
			"/repo",
		);
		expect(status).toBe("error");
	});

	test("resolves timeout and kills the child when nothing fires", async () => {
		vi.useFakeTimers();
		try {
			const { spawn, calls } = createFakeSpawn("hang");
			const promise = runAidevTrack(
				{ spawn, timeoutMs: 500 },
				"checkpoint",
				{},
				"/repo",
			);
			await vi.advanceTimersByTimeAsync(750);
			const status = await promise;
			expect(status).toBe("timeout");
			expect(calls[0].child.killed).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("createAidevTrackExtension", () => {
	test("extension-triggered runs get a baseline reused across automatic continuations", async () => {
		const { calls, handlers } = createHarness();
		await handlers.agent_start?.({ type: "agent_start" }, ctx);
		await handlers.tool_call?.(
			{ ...toolCall("edit", "a.ts"), parentToolCallId: "codemode-1" },
			ctx,
		);
		await handlers.tool_result?.(
			{ ...toolResult("edit", "a.ts"), parentToolCallId: "codemode-1" },
			ctx,
		);
		await handlers.agent_start?.({ type: "agent_start" }, ctx);
		await handlers.agent_settled?.(agentSettled, ctx);
		await handlers.agent_settled?.(agentSettled, ctx);
		expect(calls.map((call) => call.args[0])).toEqual([
			"turn-start",
			"checkpoint",
			"checkpoint",
			"turn-end",
		]);
		await handlers.agent_start?.({ type: "agent_start" }, ctx);
		expect(calls.at(-1)?.args[0]).toBe("turn-start");
	});

	test("parallel same-file nested hooks serialize and block mutations until the pristine snapshot", async () => {
		const { calls, handlers } = createHarness("hang");
		const first = handlers.tool_call?.(
			{ ...toolCall("edit", "a.ts"), parentToolCallId: "outer" },
			ctx,
		);
		const second = handlers.tool_call?.(
			{
				...toolCall("write", "a.ts"),
				toolCallId: "call-2",
				parentToolCallId: "outer",
			},
			ctx,
		);
		let released = false;
		void Promise.resolve(first).then(() => {
			released = true;
		});
		await vi.waitFor(() => expect(calls).toHaveLength(1));
		expect(released).toBe(false);
		calls[0].child.emitClose();
		await vi.waitFor(() => expect(calls).toHaveLength(2));
		expect(released).toBe(false);
		calls[1].child.emitClose();
		await first;
		await vi.waitFor(() => expect(calls).toHaveLength(3));
		calls[2].child.emitClose();
		await second;
		expect(calls.map((call) => call.args[0])).toEqual([
			"turn-start",
			"checkpoint",
			"checkpoint",
		]);
	});

	test("shutdown cancels the active hook and drains without launching queued hooks", async () => {
		const { calls, handlers } = createHarness("hang");
		const starting = handlers.agent_start?.({ type: "agent_start" }, ctx);
		const queued = handlers.tool_call?.(toolCall("write", "a.ts"), ctx);
		await vi.waitFor(() => expect(calls).toHaveLength(1));
		const shutdown = handlers.session_shutdown?.(
			{ type: "session_shutdown", reason: "reload" },
			ctx,
		);
		calls[0].child.emitClose(null);
		await Promise.all([starting, queued, shutdown]);
		expect(calls).toHaveLength(1);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	test("before_agent_start maps to turn-start with prompt", async () => {
		const { calls, handlers } = createHarness();
		await handlers.before_agent_start?.(beforeAgentStart("do the thing"), ctx);

		expect(calls).toHaveLength(1);
		expect(calls[0].args[0]).toBe("turn-start");
		expect(lastPayload(calls[0])).toEqual({
			session_id: "session-xyz",
			cwd: "/repo",
			hook_event_name: "UserPromptSubmit",
			prompt: "do the thing",
		});
	});

	test("tool_call for edit maps to a PreToolUse checkpoint", async () => {
		const { calls, handlers } = createHarness();
		await handlers.before_agent_start?.(beforeAgentStart("edit"), ctx);
		calls.length = 0;
		await handlers.tool_call?.(toolCall("edit", "src/a.ts"), ctx);

		expect(calls).toHaveLength(1);
		expect(calls[0].args[0]).toBe("checkpoint");
		expect(lastPayload(calls[0])).toEqual({
			session_id: "session-xyz",
			cwd: "/repo",
			hook_event_name: "PreToolUse",
			tool_name: "edit",
			tool_input: { file_path: "src/a.ts" },
		});
	});

	test("tool_call for write maps to a PreToolUse checkpoint", async () => {
		const { calls, handlers } = createHarness();
		await handlers.before_agent_start?.(beforeAgentStart("write"), ctx);
		calls.length = 0;
		await handlers.tool_call?.(toolCall("write", "src/b.ts"), ctx);

		expect(calls).toHaveLength(1);
		expect(lastPayload(calls[0]).tool_name).toBe("write");
	});

	test("tool_call for non-mutating tools is ignored", async () => {
		const { calls, handlers } = createHarness();
		await handlers.tool_call?.(toolCall("read", "src/a.ts"), ctx);
		expect(calls).toHaveLength(0);
	});

	test("tool_result for edit maps to a PostToolUse checkpoint", async () => {
		const { calls, handlers } = createHarness();
		await handlers.tool_result?.(toolResult("edit", "src/a.ts"), ctx);

		expect(calls).toHaveLength(1);
		expect(lastPayload(calls[0])).toEqual({
			session_id: "session-xyz",
			cwd: "/repo",
			hook_event_name: "PostToolUse",
			tool_name: "edit",
			tool_input: { file_path: "src/a.ts" },
		});
	});

	test("tool_result for non-mutating tools is ignored", async () => {
		const { calls, handlers } = createHarness();
		await handlers.tool_result?.(toolResult("bash", "src/a.ts"), ctx);
		expect(calls).toHaveLength(0);
	});

	test.each([false, true])(
		"agent_settled reconciles turn-end (aborted=%s)",
		async (aborted) => {
			const { calls, handlers } = createHarness();
			await handlers.agent_start?.({ type: "agent_start" }, ctx);
			calls.length = 0;
			await handlers.agent_settled?.(agentSettledEvent(aborted), ctx);

			expect(calls).toHaveLength(1);
			expect(calls[0].args[0]).toBe("turn-end");
			expect(lastPayload(calls[0])).toEqual({
				session_id: "session-xyz",
				cwd: "/repo",
				hook_event_name: "Stop",
			});
		},
	);

	test("stops spawning once the binary is detected missing", async () => {
		const { calls, handlers } = createHarness("error-missing");
		await handlers.before_agent_start?.(beforeAgentStart("x"), ctx);
		expect(calls).toHaveLength(1);

		await handlers.tool_call?.(toolCall("edit", "src/a.ts"), ctx);
		await handlers.agent_settled?.(agentSettled, ctx);
		expect(calls).toHaveLength(1);
	});

	test("omits file_path when the tool input has no string path", async () => {
		const { calls, handlers } = createHarness();
		const event: ToolCallEvent = {
			type: "tool_call",
			toolCallId: "call-2",
			toolName: "write",
			input: {},
		};
		await handlers.tool_call?.(event, ctx);
		expect(lastPayload(calls[calls.length - 1]).tool_input).toEqual({});
	});
});
