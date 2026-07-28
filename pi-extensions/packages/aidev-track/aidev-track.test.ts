import type {
	AgentSettledEvent,
	BeforeAgentStartEvent,
	ToolCallEvent,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createAidevTrackExtension, runAidevTrack } from "./aidev-track";

type SpawnOptions = { cwd: string; stdio: ["pipe", "ignore", "ignore"] };
type ErrorListener = (error: NodeJS.ErrnoException) => void;
type CloseListener = (code: number | null) => void;

class FakeChild {
	stdinChunks: string[] = [];
	stdinEnded = false;
	killed = false;
	private errorListeners: ErrorListener[] = [];
	private closeListeners: CloseListener[] = [];

	stdin = {
		write: (chunk: string): unknown => {
			this.stdinChunks.push(chunk);
			return true;
		},
		end: (): unknown => {
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

	kill(): unknown {
		this.killed = true;
		return true;
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
	systemPromptOptions: { cwd: "/repo" },
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

const agentSettled: AgentSettledEvent = { type: "agent_settled" };

type Handlers = {
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
			await vi.advanceTimersByTimeAsync(500);
			const status = await promise;
			expect(status).toBe("timeout");
			expect(calls[0].child.killed).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("createAidevTrackExtension", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	test("registers all four lifecycle handlers", () => {
		const { handlers } = createHarness();
		expect(handlers.before_agent_start).toBeTypeOf("function");
		expect(handlers.tool_call).toBeTypeOf("function");
		expect(handlers.tool_result).toBeTypeOf("function");
		expect(handlers.agent_settled).toBeTypeOf("function");
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

	test("agent_settled maps to turn-end", async () => {
		const { calls, handlers } = createHarness();
		await handlers.agent_settled?.(agentSettled, ctx);

		expect(calls).toHaveLength(1);
		expect(calls[0].args[0]).toBe("turn-end");
		expect(lastPayload(calls[0])).toEqual({
			session_id: "session-xyz",
			cwd: "/repo",
			hook_event_name: "Stop",
		});
	});

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
		expect(lastPayload(calls[0]).tool_input).toEqual({});
	});
});
