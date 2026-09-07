import { EventEmitter } from "node:events";
import net from "node:net";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Handler = (
	event: Record<string, unknown>,
	ctx: ExtensionContext,
) => unknown;
type Report = { method: string; params: Record<string, unknown> };
const flush = async () => {
	for (let n = 0; n < 3; n++)
		await new Promise<void>((resolve) => setImmediate(resolve));
};
const cleanups: Array<() => Promise<void>> = [];

async function fixture(mode: ExtensionContext["mode"] = "tui") {
	const reports: Report[] = [];
	const sockets: EventEmitter[] = [];
	let respond = true;
	vi.spyOn(net, "createConnection").mockImplementation((() => {
		const socket = new EventEmitter();
		Object.assign(socket, {
			destroy: vi.fn(),
			write: (line: string) => {
				reports.push(JSON.parse(line));
				if (respond)
					queueMicrotask(() => socket.emit("data", Buffer.from("{}\n")));
			},
		});
		sockets.push(socket);
		queueMicrotask(() => socket.emit("connect"));
		return socket;
	}) as unknown as typeof net.createConnection);
	const handlers = new Map<string, Handler>();
	const bus = new EventEmitter();
	const { default: extension } = await import("./index");
	extension({
		on: (event: string, handler: Handler) => handlers.set(event, handler),
		events: {
			on: (event: string, handler: (data: unknown) => void) => {
				bus.on(event, handler);
				return () => bus.off(event, handler);
			},
		},
	} as unknown as ExtensionAPI);
	let idle = true;
	let pending = false;
	let file: string | undefined = "/tmp/root-session.jsonl";
	const ctx = {
		mode,
		hasUI: mode === "tui" || mode === "rpc",
		isIdle: () => idle,
		hasPendingMessages: () => pending,
		sessionManager: {
			getSessionFile: () => file,
			getSessionId: () => "root-session",
		},
	} as unknown as ExtensionContext;
	async function dispatch(event: string, data: Record<string, unknown> = {}) {
		await handlers.get(event)?.({ type: event, ...data }, ctx);
	}
	async function start() {
		await dispatch("session_start", { reason: "startup" });
		await dispatch("resources_discover", { reason: "startup" });
		await flush();
	}
	cleanups.push(async () => {
		await dispatch("session_shutdown", { reason: "quit" });
		await flush();
	});
	return {
		reports,
		sockets,
		bus,
		ctx,
		dispatch,
		start,
		states: () =>
			reports
				.filter((r) => r.method === "pane.report_agent")
				.map((r) => r.params.state),
		setIdle: (value: boolean) => {
			idle = value;
		},
		setPending: (value: boolean) => {
			pending = value;
		},
		setFile: (value: string | undefined) => {
			file = value;
		},
		setRespond: (value: boolean) => {
			respond = value;
		},
	};
}

beforeEach(() => {
	vi.resetModules();
	vi.stubEnv("HERDR_ENV", "1");
	vi.stubEnv("HERDR_SOCKET_PATH", "/unused.sock");
	vi.stubEnv("HERDR_PANE_ID", "w1:p1");
	vi.stubEnv("PI_SUBAGENT_CHILD", "0");
});
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

test("parent settlement stays working until every busy contribution is released", async () => {
	const f = await fixture();
	await f.start();
	f.setIdle(false);
	await f.dispatch("agent_start");
	f.bus.emit("herdr:busy", { active: true });
	f.bus.emit("herdr:busy", { active: true });
	await flush();
	f.setIdle(true);
	await f.dispatch("agent_settled");
	await flush();
	f.bus.emit("herdr:busy", { active: false });
	await flush();
	expect(f.states()).toEqual(["idle", "working"]);
	f.bus.emit("herdr:busy", { active: false });
	await flush();
	expect(f.states()).toEqual(["idle", "working", "idle"]);
	f.bus.emit("herdr:busy", { active: false });
	await flush();
	expect(f.states()).toEqual(["idle", "working", "idle"]);
});

test("busy label replacement cannot emit a transient idle report", async () => {
	const f = await fixture();
	await f.start();
	f.bus.emit("herdr:busy", { active: true, label: "one" });
	await flush();
	f.bus.emit("herdr:busy", { active: false });
	f.bus.emit("herdr:busy", { active: true, label: "two" });
	await flush();
	expect(f.states()).toEqual(["idle", "working"]);
});

test.each(["active", "queued"])(
	"final-child handoff remains working with %s continuation",
	async (kind) => {
		const f = await fixture();
		await f.start();
		f.bus.emit("herdr:busy", { active: true });
		await flush();
		// The completion producer delivers/queues the parent wake before releasing busy.
		if (kind === "queued") f.setPending(true);
		else f.setIdle(false);
		f.bus.emit("herdr:busy", { active: false });
		await flush();
		expect(f.states()).toEqual(["idle", "working"]);
		f.setPending(false);
		f.setIdle(false);
		await f.dispatch("agent_start");
		await flush();
		f.setIdle(true);
		await f.dispatch("agent_settled");
		await flush();
		expect(f.states()).toEqual(["idle", "working", "idle"]);
	},
);

test("native prompts and external blockers are independent of busy work", async () => {
	const f = await fixture();
	await f.start();
	f.bus.emit("herdr:busy", { active: true });
	await flush();
	await f.dispatch("ui_prompt_start", { title: "secret question" });
	await f.dispatch("ui_prompt_start"); // Native overlapping span is coalesced.
	await flush();
	f.bus.emit("herdr:blocked", { active: true, label: "secret external label" });
	await f.dispatch("ui_prompt_end");
	await flush();
	expect(f.states().at(-1)).toBe("blocked");
	f.bus.emit("herdr:blocked", { active: false });
	await flush();
	expect(f.states().at(-1)).toBe("working");
	await f.dispatch("ui_prompt_end");
	await flush();
	expect(JSON.stringify(f.reports)).not.toContain("secret");
	f.bus.emit("herdr:busy", { active: false });
	await flush();
	expect(f.states().at(-1)).toBe("idle");
});

test("a native prompt can report blocked during session startup", async () => {
	const f = await fixture();
	await f.dispatch("session_start", { reason: "startup" });
	await f.dispatch("ui_prompt_start");
	await flush();
	expect(f.states()).toEqual(["blocked"]);
	await f.dispatch("ui_prompt_end");
	await f.dispatch("resources_discover");
	await flush();
	expect(f.states()).toEqual(["blocked", "idle"]);
});

test.each(["before", "after"])(
	"reload restores busy %s reporter startup without initial idle",
	async (order) => {
		const f = await fixture();
		if (order === "before") f.bus.emit("herdr:busy", { active: true });
		await f.dispatch("session_start", { reason: "reload" });
		await flush(); // Later session_start handlers can await I/O before restoring runs.
		if (order === "after") f.bus.emit("herdr:busy", { active: true });
		await f.dispatch("resources_discover", { reason: "reload" });
		await flush();
		expect(f.states()).toEqual(["working"]);
	},
);

test("shutdown cancels queued reports and ignores late prompt/bus events", async () => {
	const f = await fixture();
	await f.start();
	f.bus.emit("herdr:busy", { active: true });
	await flush();
	const before = f.reports.length;
	f.bus.emit("herdr:busy", { active: false });
	await f.dispatch("session_shutdown", { reason: "reload" });
	await f.dispatch("ui_prompt_start");
	await f.dispatch("ui_prompt_end");
	f.bus.emit("herdr:blocked", { active: true });
	await flush();
	expect(f.reports).toHaveLength(before);
	expect(f.bus.listenerCount("herdr:busy")).toBe(0);
	expect(f.bus.listenerCount("herdr:blocked")).toBe(0);
});

test.each(["rpc", "json", "print"] as const)(
	"does not report in %s mode",
	async (mode) => {
		const f = await fixture(mode);
		await f.start();
		f.bus.emit("herdr:busy", { active: true });
		f.bus.emit("herdr:blocked", { active: true });
		await f.dispatch("ui_prompt_start");
		await f.dispatch("agent_start");
		await f.dispatch("agent_settled");
		await flush();
		expect(f.reports).toEqual([]);
	},
);

test.each([
	["HERDR_ENV", "0"],
	["HERDR_SOCKET_PATH", ""],
	["HERDR_PANE_ID", ""],
	["PI_SUBAGENT_CHILD", "1"],
])("does not report with %s=%s", async (name, value) => {
	vi.stubEnv(name, value);
	const f = await fixture();
	await f.start();
	await f.dispatch("ui_prompt_start");
	f.bus.emit("herdr:busy", { active: true });
	await flush();
	expect(f.reports).toEqual([]);
});

test("low-level end and spurious settled events do not clear parent activity", async () => {
	const f = await fixture();
	await f.start();
	f.setIdle(false);
	await f.dispatch("agent_start");
	await flush();
	await f.dispatch("agent_end");
	await f.dispatch("agent_settled");
	await flush();
	expect(f.states()).toEqual(["idle", "working"]);
});

test("reports identity snapshots and monotonic sequences, with UUID fallback", async () => {
	const f = await fixture();
	await f.start();
	expect(f.reports[0]?.params).toMatchObject({
		agent_session_path: "/tmp/root-session.jsonl",
		session_start_source: "startup",
	});
	f.setFile(undefined);
	f.setIdle(false);
	await f.dispatch("agent_start");
	await flush();
	expect(f.reports.at(-1)?.params).toMatchObject({
		agent_session_id: "root-session",
		source: "herdr:pi",
		pane_id: "w1:p1",
	});
	expect(f.reports.at(-1)?.params.agent_session_path).toBeUndefined();
	const seqs = f.reports.map((r) => r.params.seq as number);
	expect(seqs.every((seq, n) => n === 0 || seq > (seqs[n - 1] ?? 0))).toBe(
		true,
	);
});

test("malformed events cannot release an existing busy contribution", async () => {
	const f = await fixture();
	await f.start();
	f.bus.emit("herdr:busy", { active: true });
	await flush();
	for (const data of [null, {}, { active: "false" }])
		f.bus.emit("herdr:busy", data);
	await flush();
	expect(f.states()).toEqual(["idle", "working"]);
});

test("factory starts no socket; shutdown cancels a stalled attempt without retry", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const f = await fixture();
	expect(f.sockets).toEqual([]);
	f.setRespond(false);
	await f.start();
	expect(f.sockets).toHaveLength(1);
	await f.dispatch("session_shutdown");
	await vi.advanceTimersByTimeAsync(3000);
	await flush();
	expect(f.sockets).toHaveLength(1);
	expect((f.sockets[0] as unknown as net.Socket).destroy).toHaveBeenCalled();
});

test("transport retries once, then advances to the latest queued state", async () => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const f = await fixture();
	f.setRespond(false);
	await f.start(); // Session report is in flight; idle is queued.
	f.bus.emit("herdr:busy", { active: true });
	await flush(); // Supersedes the queued idle report.
	await vi.advanceTimersByTimeAsync(500);
	expect(f.sockets).toHaveLength(2);
	f.setRespond(true);
	await vi.advanceTimersByTimeAsync(1500);
	await flush();
	expect(f.states()).toEqual(["working"]);
	expect(f.reports[0]?.params.seq).toBe(f.reports[1]?.params.seq);
});

test.each(["error", "end", "close"])(
	"a socket %s cannot break lifecycle reporting",
	async (event) => {
		const f = await fixture();
		f.setRespond(false);
		await f.start();
		f.setRespond(true);
		f.sockets[0]?.emit(event, new Error("fixture transport failure"));
		await flush();
		expect(f.states()).toEqual(["idle"]);
	},
);

test("obsolete state is not retried after newer state was queued", async () => {
	const f = await fixture();
	await f.start();
	f.setRespond(false);
	f.bus.emit("herdr:busy", { active: true });
	await flush();
	const socket = f.sockets.at(-1);
	await f.dispatch("ui_prompt_start");
	await flush();
	f.setRespond(true);
	socket?.emit("error", new Error("fixture transport failure"));
	await flush();
	expect(f.states()).toEqual(["idle", "working", "blocked"]);
});

test("each external blocker owns its count; malformed releases cannot clear it", async () => {
	const f = await fixture();
	await f.start();
	f.bus.emit("herdr:blocked", { active: true });
	f.bus.emit("herdr:blocked", { active: true });
	await flush();
	f.bus.emit("herdr:blocked", {});
	f.bus.emit("herdr:blocked", { active: false });
	await flush();
	expect(f.states()).toEqual(["idle", "blocked"]);
	f.bus.emit("herdr:blocked", { active: false });
	await flush();
	expect(f.states()).toEqual(["idle", "blocked", "idle"]);
});

test("a prompt from a non-TUI context cannot alter the root's native span", async () => {
	const f = await fixture();
	await f.start();
	f.ctx.mode = "rpc";
	await f.dispatch("ui_prompt_start");
	await flush();
	expect(f.states()).toEqual(["idle"]);
	f.ctx.mode = "tui";
	await f.dispatch("ui_prompt_start");
	await flush();
	f.ctx.mode = "rpc";
	await f.dispatch("ui_prompt_end");
	await flush();
	expect(f.states()).toEqual(["idle", "blocked"]);
	f.ctx.mode = "tui";
});

test("identity lookup failures do not prevent state reporting", async () => {
	const f = await fixture();
	vi.spyOn(f.ctx.sessionManager, "getSessionFile").mockImplementation(() => {
		throw new Error("no transcript");
	});
	vi.spyOn(f.ctx.sessionManager, "getSessionId").mockImplementation(() => {
		throw new Error("no id");
	});
	await f.start();
	expect(f.states()).toEqual(["idle"]);
	expect(f.reports.at(-1)?.params.agent_session_path).toBeUndefined();
	expect(f.reports.at(-1)?.params.agent_session_id).toBeUndefined();
});
