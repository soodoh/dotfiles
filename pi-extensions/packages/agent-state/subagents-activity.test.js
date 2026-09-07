import { EventEmitter } from "node:events";
import { expect, test } from "vitest";
// Test-only imports exercise the installed upstream implementation on upgrades.
import { registerHerdrStatusBridge } from "../../node_modules/pi-subagents/src/integrations/herdr-status.ts";
import {
	hasLiveSubagentWork,
	registerPiWebSessionLiveness,
} from "../../node_modules/pi-subagents/src/integrations/pi-web-session-liveness.ts";
import { createLiveness } from "./liveness";
import { observeState } from "./state";

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
	const bus = events();
	const notices = [];
	const states = [];
	const handlers = new Map();
	const ctx = {
		mode: "tui",
		isIdle: () => true,
		hasPendingMessages: () => false,
		sessionManager: { getSessionId: () => "owner" },
		ui: {
			notify(message) {
				throw new Error(message);
			},
		},
	};
	observeState(
		{
			events: bus,
			on(name, handler) {
				handlers.set(name, [...(handlers.get(name) ?? []), handler]);
			},
		},
		(snapshot) => states.push(snapshot.state),
	);
	const dispatch = async (name) => {
		for (const handler of handlers.get(name) ?? []) await handler({}, ctx);
		await new Promise((resolve) => setImmediate(resolve));
	};
	const registration = registerPiWebSessionLiveness({
		sessionId: "owner",
		isActive: () => true,
	});
	bus.on("herdr:blocked", (value) => notices.push(value));
	const bridge = registerHerdrStatusBridge({
		events: bus,
		env: { HERDR_ENV: "1", HERDR_PANE_ID: "fixture" },
		runHerdr() {},
		refreshMs: 0,
	});
	try {
		await dispatch("session_start");
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
		await dispatch("resources_discover");
		bridge.agentStarted();
		for (const reason of ["idle", "supervisor_request"]) {
			bus.emit("subagent:control-event", {
				source: "async",
				event: {
					type: "needs_attention",
					runId: reason,
					reason,
					message: "parent intervention",
				},
			});
		}
		await dispatch("agent_settled");
		expect(notices.some((notice) => notice.active)).toBe(true);
		expect(states).toEqual(["working"]);
		await dispatch("ui_prompt_start");
		await dispatch("ui_prompt_end");
		expect(states).toEqual(["working", "blocked", "working"]);
	} finally {
		await dispatch("session_shutdown");
		registration.release();
		bridge.dispose();
		await bridge.flush();
	}
});
