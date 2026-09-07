import { EventEmitter } from "node:events";
import net from "node:net";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { registerActivity } from "./liveness.test.fixture";

type Handler = (
	event: Record<string, unknown>,
	ctx: ExtensionContext,
) => unknown;
const cleanups: Array<() => Promise<void>> = [];
async function flush() {
	for (let n = 0; n < 5; n++)
		await new Promise<void>((resolve) => setImmediate(resolve));
}
async function fixture(mode: ExtensionContext["mode"] = "tui") {
	const envelopes: Record<string, unknown>[] = [];
	vi.spyOn(net, "createConnection").mockImplementation((() => {
		const socket = new EventEmitter();
		Object.assign(socket, {
			destroy: vi.fn(),
			end: vi.fn(),
			unref: vi.fn(),
			write: (line: string) => {
				envelopes.push(JSON.parse(line));
				queueMicrotask(() => socket.emit("data", Buffer.from("{}\n")));
			},
		});
		queueMicrotask(() => socket.emit("connect"));
		return socket;
	}) as unknown as typeof net.createConnection);
	const bus = new EventEmitter();
	let active = false;
	let available = true;
	const handlers = new Map<string, Handler[]>();
	const { default: extension } = await import("./index");
	extension({
		on: (event: string, handler: Handler) =>
			handlers.set(event, [...(handlers.get(event) ?? []), handler]),
		events: {
			emit: (name: string, data: unknown) => bus.emit(name, data),
			on: (name: string, handler: (value: unknown) => void) => {
				bus.on(name, handler);
				return () => bus.off(name, handler);
			},
		},
	} as unknown as ExtensionAPI);
	const releaseActivity = registerActivity(() =>
		available ? active : undefined,
	);
	let idle = true;
	let pending = false;
	const ctx = {
		mode,
		hasUI: mode === "tui" || mode === "rpc",
		cwd: "/tmp/test-project",
		isIdle: () => idle,
		hasPendingMessages: () => pending,
		sessionManager: {
			getSessionId: () => "root-session",
			getSessionFile: () => "/tmp/session.jsonl",
		},
		ui: { notify: vi.fn() },
	} as unknown as ExtensionContext;
	async function dispatch(name: string, data: Record<string, unknown> = {}) {
		for (const handler of handlers.get(name) ?? [])
			await handler({ type: name, ...data }, ctx);
		await flush();
	}
	cleanups.push(async () => {
		await dispatch("session_shutdown", { reason: "reload" });
		releaseActivity();
	});
	return {
		envelopes,
		bus,
		ctx,
		dispatch,
		categories: () =>
			envelopes
				.filter((e) => e.source === "pi")
				.map((e) => e.category)
				.filter(Boolean),
		setActive(value: boolean) {
			active = value;
		},
		setAvailable(value: boolean) {
			available = value;
		},
		setIdle(value: boolean) {
			idle = value;
		},
		setPending(value: boolean) {
			pending = value;
		},
		async start(reason = "startup") {
			await dispatch("session_start", { reason });
			await dispatch("resources_discover", { reason });
		},
		async begin() {
			idle = false;
			await dispatch("agent_start");
		},
		async settle(stopReason = "stop") {
			await dispatch("agent_end", {
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "secret reply" }],
						stopReason,
					},
				],
			});
			idle = true;
			await dispatch("agent_settled");
		},
	};
}
beforeEach(() => {
	vi.resetModules();
	for (const name of [
		"HERDR_ENV",
		"HERDR_PANE_ID",
		"HERDR_SOCKET_PATH",
		"TMUX",
		"TMUX_PANE",
		"ZELLIJ",
		"PI_SUBAGENT_CHILD",
	])
		vi.stubEnv(name, "");
	vi.stubEnv("MOSHI_SOCKET_PATH", "/unused-moshi.sock");
});
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

test.each([false, true])(
	"whole-task completion with Herdr=%s",
	async (herdr) => {
		if (herdr) {
			vi.stubEnv("HERDR_ENV", "1");
			vi.stubEnv("HERDR_SOCKET_PATH", "/unused-herdr.sock");
			vi.stubEnv("HERDR_PANE_ID", "w1:p1");
		}
		const f = await fixture();
		await f.start();
		expect(f.categories()).toEqual([]);
		await f.begin();
		f.setActive(true);
		f.bus.emit("subagent:async-started", { id: "child" });
		await f.settle();
		expect(f.categories()).toEqual(["session_started"]);
		// The producer holds activity through its batching timer, even after child exit.
		f.bus.emit("subagent:async-complete", { id: "child" });
		await flush();
		expect(f.categories()).not.toContain("task_complete");
		// Actual delivery queues a continuation before releasing activity.
		f.setPending(true);
		f.setActive(false);
		await f.dispatch("agent_settled");
		expect(f.categories()).not.toContain("task_complete");
		f.setPending(false);
		await f.begin();
		await f.settle();
		await f.dispatch("agent_settled");
		expect(f.categories()).toEqual(["session_started", "task_complete"]);
		const moshi = f.envelopes.filter((e) => e.source === "pi");
		expect(new Set(moshi.map((e) => e.sessionId))).toEqual(
			new Set(["root-session"]),
		);
		expect(JSON.stringify(f.envelopes)).not.toContain("secret reply");
		if (herdr)
			expect(
				f.envelopes
					.filter((e) => e.method === "pane.report_agent")
					.map((e) => (e.params as Record<string, unknown>).state),
			).toEqual(["idle", "working", "idle"]);
	},
);

test("native input alerts once; a supervisor warning is not a human blocker", async () => {
	const f = await fixture();
	await f.start();
	await f.begin();
	f.bus.emit("herdr:blocked", { active: true });
	await flush();
	expect(f.categories()).toEqual(["session_started"]);
	await f.dispatch("ui_prompt_start", {
		kind: "custom",
		title: "secret question",
	});
	await f.dispatch("ui_prompt_start");
	expect(f.categories()).toEqual(["session_started", "approval_required"]);
	const prompt = f.envelopes.at(-1);
	expect(prompt).toMatchObject({ title: "Pi needs input" });
	expect(prompt).not.toHaveProperty("actionId");
	expect(prompt).not.toHaveProperty("toolName");
	await f.dispatch("ui_prompt_end");
	await f.settle();
	expect(f.categories()).toEqual([
		"session_started",
		"approval_required",
		"session_started",
		"task_complete",
	]);
	expect(JSON.stringify(f.envelopes)).not.toContain("secret question");
});

test("reload with active work is working, never an initial completion", async () => {
	const f = await fixture();
	f.setActive(true);
	await f.start("reload");
	expect(f.categories()).toEqual(["session_started"]);
	await f.dispatch("session_shutdown", { reason: "reload" });
	expect(f.categories()).not.toContain("session_ended");
});

test("unavailable activity contract fails closed instead of claiming completion", async () => {
	const f = await fixture();
	await f.start();
	await f.begin();
	f.setAvailable(false);
	await f.settle();
	expect(f.categories()).not.toContain("task_complete");
	await f.dispatch("agent_settled");
	expect(f.ctx.ui.notify).toHaveBeenCalledTimes(1);
	expect(f.ctx.ui.notify).toHaveBeenCalledWith(
		expect.stringContaining("mise run validate:agents"),
		"warning",
	);
	f.setAvailable(true);
	await f.dispatch("agent_settled");
	expect(f.categories()).toContain("task_complete");
});

test.each(["aborted", "error", "length"])(
	"%s is not successful completion",
	async (reason) => {
		const f = await fixture();
		await f.start();
		await f.begin();
		await f.settle(reason);
		expect(f.categories()).not.toContain("task_complete");
		expect(f.categories()).toContain("error");
	},
);

test("opening and closing an idle dialog does not complete a task", async () => {
	const f = await fixture();
	await f.start();
	await f.dispatch("ui_prompt_start");
	await f.dispatch("ui_prompt_end");
	expect(f.categories()).toEqual(["approval_required", "session_started"]);
	expect(f.envelopes.at(-1)).toMatchObject({
		eventName: "PermissionResolved",
		phase: "idle",
	});
});

test.each(["rpc", "json", "print"] as const)(
	"no Moshi reports in %s mode",
	async (mode) => {
		const f = await fixture(mode);
		await f.start();
		await f.begin();
		await f.settle();
		expect(f.envelopes).toEqual([]);
		expect(
			Reflect.get(globalThis, Symbol.for("@agegr/pi-web/session-liveness/v1")),
		).toBeUndefined();
	},
);

test("child runtimes do not publish", async () => {
	vi.stubEnv("PI_SUBAGENT_CHILD", "1");
	const f = await fixture();
	expect(
		Reflect.get(globalThis, Symbol.for("@agegr/pi-web/session-liveness/v1")),
	).toBeUndefined();
	await f.start();
	await f.begin();
	await f.settle();
	expect(f.envelopes).toEqual([]);
});

test("reconciliation handles silent work without event hints and stops at shutdown", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const f = await fixture();
	await f.start();
	await f.begin();
	f.setActive(true);
	await f.settle();
	await vi.advanceTimersByTimeAsync(1000);
	await flush();
	expect(f.categories()).not.toContain("task_complete");
	f.setActive(false);
	await vi.advanceTimersByTimeAsync(250);
	await flush();
	expect(f.categories()).toEqual(["session_started", "task_complete"]);
	expect(vi.getTimerCount()).toBe(1); // v1 has no change subscription.
	f.setActive(true); // Even work starting while idle is discovered without events.
	await vi.advanceTimersByTimeAsync(1000);
	await flush();
	expect(f.categories()).toEqual([
		"session_started",
		"task_complete",
		"session_started",
	]);
	await f.dispatch("session_shutdown", { reason: "reload" });
	expect(vi.getTimerCount()).toBe(0);
});

test("task outcomes reset across independent tasks, including errors", async () => {
	const f = await fixture();
	await f.start();
	await f.begin();
	await f.settle("aborted");
	await f.begin();
	await f.settle("stop");
	await f.begin();
	await f.dispatch("agent_end", { messages: [] });
	f.setIdle(true);
	await f.dispatch("agent_settled");
	expect(
		f.categories().filter((category) => category === "task_complete"),
	).toHaveLength(1);
	expect(
		f.categories().filter((category) => category === "error"),
	).toHaveLength(1);
});

test("a foreign session's idle provider cannot clear a task", async () => {
	const f = await fixture();
	await f.start();
	await f.begin();
	f.setAvailable(false);
	const release = registerActivity(() => false, "foreign");
	try {
		await f.settle();
		expect(f.categories()).not.toContain("task_complete");
	} finally {
		release();
	}
});

test("an explicit quit closes Moshi once; reload/new/resume/fork do not", async () => {
	const f = await fixture();
	await f.start();
	await f.begin();
	await f.dispatch("session_shutdown", { reason: "quit" });
	await f.dispatch("session_shutdown", { reason: "quit" });
	expect(f.categories()).toEqual(["session_started", "session_ended"]);
});

test("a foreign host registry suppresses completion but not genuine parent input", async () => {
	const key = Symbol.for("@agegr/pi-web/session-liveness/v1");
	const foreign = Object.freeze({ version: 1, register: () => () => {} });
	Reflect.set(globalThis, key, foreign);
	try {
		const f = await fixture();
		await f.start();
		await f.begin();
		await f.settle();
		expect(f.categories()).not.toContain("task_complete");
		expect(f.ctx.ui.notify).toHaveBeenCalledTimes(1);
		await f.dispatch("ui_prompt_start");
		expect(f.categories().at(-1)).toBe("approval_required");
		await f.dispatch("ui_prompt_end");
		expect(f.categories()).not.toContain("task_complete");
		await f.dispatch("session_shutdown", { reason: "reload" });
		expect(Reflect.get(globalThis, key)).toBe(foreign);
	} finally {
		Reflect.deleteProperty(globalThis, key);
	}
});
