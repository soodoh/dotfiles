import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
// Test-only imports exercise the installed upstream implementation on upgrades.
import { registerHerdrStatusBridge } from "../../node_modules/pi-subagents/src/integrations/herdr-status.js";
import {
	hasLiveSubagentWork,
	registerPiWebSessionLiveness,
} from "../../node_modules/pi-subagents/src/integrations/pi-web-session-liveness.js";
import agentState from "./index";
import { createLiveness } from "./liveness";

function events() {
	const bus = new EventEmitter();
	return {
		emit: (name, value) => bus.emit(name, value),
		on(name, handler) {
			bus.on(name, handler);
			return () => bus.off(name, handler);
		},
	};
}

async function waitFor(check, timeoutMs = 1500) {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("timed out waiting for report");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

test("unmodified upstream registers session-scoped liveness, not display counts", () => {
	const reader = createLiveness();
	const state = {
		asyncJobs: new Map(),
		foregroundControls: new Map(),
		retainedForegroundNestedRoutes: new Map(),
	};
	let pendingDelivery = false;
	const registration = registerPiWebSessionLiveness({
		sessionId: "owner",
		isActive: () => hasLiveSubagentWork(state) || pendingDelivery,
	});
	try {
		expect(registration.registered).toBe(true);
		expect(reader.read("owner")).toBe(false);
		expect(reader.read("foreign")).toBeUndefined();
		state.asyncJobs.set("one", { status: "queued" });
		state.asyncJobs.set("two", { status: "running" });
		expect(reader.read("owner")).toBe(true);
		state.asyncJobs.delete("one");
		expect(reader.read("owner")).toBe(true);
		state.asyncJobs.set("two", { status: "complete" });
		expect(reader.read("owner")).toBe(false);
		pendingDelivery = true;
		expect(reader.read("owner")).toBe(true);
		pendingDelivery = false;
		state.foregroundControls.set("control", { schedulingOwners: 1 });
		expect(reader.read("owner")).toBe(true);
		state.foregroundControls.set("control", {
			activeChildren: new Set(["child"]),
		});
		expect(reader.read("owner")).toBe(true);
		state.foregroundControls.clear();
		state.retainedForegroundNestedRoutes.set("nested", {});
		expect(reader.read("owner")).toBe(true);
		state.retainedForegroundNestedRoutes.clear();
		expect(reader.read("owner")).toBe(false);
		registration.release();
		expect(reader.read("owner")).toBeUndefined();
	} finally {
		registration.release();
		reader.close();
	}
});

test("upstream supervisor attention stays working; only the parent's prompt blocks", async () => {
	const dir = mkdtempSync(join(tmpdir(), "agent-state-subagents-"));
	const herdrSocket = join(dir, "herdr.sock");
	const states = [];
	const server = net.createServer((socket) => {
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			for (const line of buffer.split("\n").filter(Boolean)) {
				const report = JSON.parse(line);
				if (report.method === "pane.report_agent")
					states.push(report.params.state);
			}
			socket.end("{}\n");
		});
	});
	await new Promise((resolve) => server.listen(herdrSocket, resolve));

	const savedEnv = {
		HERDR_ENV: process.env.HERDR_ENV,
		HERDR_SOCKET_PATH: process.env.HERDR_SOCKET_PATH,
		HERDR_PANE_ID: process.env.HERDR_PANE_ID,
		MOSHI_SOCKET_PATH: process.env.MOSHI_SOCKET_PATH,
		PI_SUBAGENT_CHILD: process.env.PI_SUBAGENT_CHILD,
	};
	process.env.HERDR_ENV = "1";
	process.env.HERDR_SOCKET_PATH = herdrSocket;
	process.env.HERDR_PANE_ID = "fixture";
	process.env.MOSHI_SOCKET_PATH = join(dir, "unused-moshi.sock");
	process.env.PI_SUBAGENT_CHILD = "0";

	const bus = events();
	const handlers = new Map();
	const ctx = {
		mode: "tui",
		cwd: dir,
		isIdle: () => true,
		hasPendingMessages: () => false,
		sessionManager: {
			getSessionId: () => "owner",
			getSessionFile: () => join(dir, "session.jsonl"),
		},
		ui: {
			notify(message) {
				throw new Error(message);
			},
		},
	};
	agentState({
		events: bus,
		on(name, handler) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
	});
	const dispatch = async (name, data = {}) => {
		for (const handler of handlers.get(name) ?? []) await handler(data, ctx);
		await new Promise((resolve) => setImmediate(resolve));
	};
	const registration = registerPiWebSessionLiveness({
		sessionId: "owner",
		isActive: () => true,
	});
	const bridge = registerHerdrStatusBridge({
		events: bus,
		env: { HERDR_ENV: "1", HERDR_PANE_ID: "fixture" },
		runHerdr() {},
		refreshMs: 0,
	});
	try {
		await dispatch("session_start", { reason: "startup" });
		bridge.sessionStarted({
			hasUI: true,
			runs: [
				{
					id: "one",
					agent: "fixture",
					needsAttention: true,
					attentionLabel: "restored",
				},
			],
		});
		await dispatch("resources_discover", { reason: "startup" });
		bridge.agentStarted();
		for (const reason of ["idle", "supervisor_request"]) {
			bus.emit("subagent:control-event", {
				source: "async",
				event: {
					type: "needs_attention",
					runId: "one",
					reason,
					message: `${reason}: parent intervention`,
				},
			});
		}
		await dispatch("agent_settled");
		await waitFor(() => states.length >= 1);
		expect(states).toEqual(["working"]);
		await dispatch("ui_prompt_start");
		await waitFor(() => states.length >= 2);
		await dispatch("ui_prompt_end");
		await waitFor(() => states.length >= 3);
		expect(states).toEqual(["working", "blocked", "working"]);
	} finally {
		await dispatch("session_shutdown", { reason: "reload" });
		registration.release();
		bridge.dispose();
		await bridge.flush();
		await new Promise((resolve) => server.close(resolve));
		rmSync(dir, { recursive: true, force: true });
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});
