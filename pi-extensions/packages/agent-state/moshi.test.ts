import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";
import {
	type AgentStateHarnessOptions,
	createAgentStateHarness,
	flush,
} from "./agent-state.test.fixture";
import { registerActivity } from "./liveness.test.fixture";

const cleanups: Array<() => Promise<void>> = [];

async function fixture(
	mode: ExtensionContext["mode"] = "tui",
	envOverrides: NodeJS.ProcessEnv = {},
	extra: Omit<AgentStateHarnessOptions, "mode" | "env" | "cleanups"> = {},
) {
	return createAgentStateHarness({
		mode,
		env: envOverrides,
		sessionFile: "/tmp/session.jsonl",
		autoFlush: true,
		shutdownReason: "reload",
		cleanups,
		...extra,
	});
}
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

test.each([false, true])(
	"whole-task completion with Herdr=%s",
	async (herdr) => {
		const f = await fixture(
			"tui",
			herdr
				? {
						HERDR_ENV: "1",
						HERDR_SOCKET_PATH: "/unused-herdr.sock",
						HERDR_PANE_ID: "w1:p1",
					}
				: {},
		);
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
		if (herdr) expect(f.states()).toEqual(["idle", "working", "idle"]);
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
		expect.stringContaining("mise run validate:agents:integration"),
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
	const f = await fixture("tui", { PI_SUBAGENT_CHILD: "1" });
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

test.each([
	["linux", "/tmp/moshi-hook.sock"],
	["darwin", "/fixture-home/Library/Application Support/Moshi/moshi-hook.sock"],
	["win32", "\\\\.\\pipe\\moshi-hook"],
] as const)(
	"%s default socket, stable identity and safe metadata",
	async (platform, endpoint) => {
		const f = await fixture(
			"tui",
			{ MOSHI_SOCKET_PATH: undefined },
			{
				platform,
				homedir: () => "/fixture-home",
				cwd: "/fixture/project",
				model: { id: "model-id", name: "Model" },
				sessionId: "uuid",
				sessionFile: "/fixture/session.jsonl",
			},
		);
		await f.dispatch("session_start", { reason: "startup" });
		expect(f.endpoints).toEqual([endpoint]);
		expect(f.envelopes[0]).toMatchObject({
			sessionId: "uuid",
			transcriptPath: "/fixture/session.jsonl",
			projectName: "project",
			modelName: "Model",
		});
	},
);

test("explicit socket override wins over XDG runtime directory", async () => {
	const first = await fixture(
		"tui",
		{ MOSHI_SOCKET_PATH: undefined, XDG_RUNTIME_DIR: "/fixture/runtime" },
		{ platform: "linux" },
	);
	await first.dispatch("session_start", { reason: "startup" });
	expect(first.endpoints.at(-1)).toBe("/fixture/runtime/moshi-hook.sock");

	const second = await fixture(
		"tui",
		{
			XDG_RUNTIME_DIR: "/fixture/runtime",
			MOSHI_SOCKET_PATH: "/fixture/override.sock",
		},
		{ platform: "linux" },
	);
	await second.dispatch("session_start", { reason: "startup" });
	expect(second.endpoints.at(-1)).toBe("/fixture/override.sock");
});

test.each(["error", "end", "close"])(
	"socket %s fails silently without retrying a notification",
	async (event) => {
		const f = await fixture("tui", {}, { autoRespondMoshi: false });
		await f.dispatch("session_start", { reason: "startup" });
		f.moshiSockets[0]?.emit(event, new Error("fixture failure"));
		await flush();
		expect(f.moshiSockets).toHaveLength(1);
		expect(f.moshiSockets[0]?.destroy).toHaveBeenCalled();
	},
);

test("stalled daemon attempts are bounded and shutdown cancels unsent work", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const f = await fixture("tui", {}, { autoRespondMoshi: false });
	await f.dispatch("session_start", { reason: "startup" });
	await vi.advanceTimersByTimeAsync(1000);
	expect(f.moshiSockets[0]?.destroy).toHaveBeenCalled();
	await f.dispatch("resources_discover", { reason: "startup" });
	await f.begin();
	await f.dispatch("ui_prompt_start");
	await f.close();
	await f.settle();
	await vi.advanceTimersByTimeAsync(1000);
	await flush();
	expect(f.envelopes.map((m) => m.eventName)).toEqual([
		"SessionStart",
		"AgentState",
	]);
});

test("synchronous connection failure cannot escape", async () => {
	const f = await fixture(
		"tui",
		{},
		{
			connect: () => {
				throw new Error("no transport");
			},
		},
	);
	await expect(f.start()).resolves.toBeUndefined();
});
