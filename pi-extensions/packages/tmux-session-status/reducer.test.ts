import { describe, expect, test } from "vitest";
import {
	currentToolName,
	initialLifecycleState,
	reduceLifecycle,
} from "./reducer";

const at = (offset: number) => 1_000 + offset;

const startAgent = () =>
	reduceLifecycle(initialLifecycleState(at(0)), {
		type: "AGENT_STARTED",
		at: at(1),
	});

describe("tmux session lifecycle reducer", () => {
	test("moves startup to idle when resources are ready", () => {
		const state = reduceLifecycle(initialLifecycleState(at(0)), {
			type: "RESOURCES_READY",
			at: at(1),
		});
		expect(state.status).toBe("IDLE");
		expect(state.stateChangedAt).toBe(at(1));
	});

	test("starts a run in thinking", () => {
		const state = startAgent();
		expect(state.status).toBe("THINKING");
		expect(state.activeTools).toEqual([]);
	});

	test("shows one active tool", () => {
		const state = reduceLifecycle(startAgent(), {
			type: "TOOL_STARTED",
			id: "one",
			name: "bash",
			at: at(2),
		});
		expect(state.status).toBe("TOOL");
		expect(currentToolName(state)).toBe("bash");
	});

	test("tracks concurrent tools and keeps the newest visible", () => {
		const one = reduceLifecycle(startAgent(), {
			type: "TOOL_STARTED",
			id: "one",
			name: "read",
			at: at(2),
		});
		const two = reduceLifecycle(one, {
			type: "TOOL_STARTED",
			id: "two",
			name: "bash",
			at: at(3),
		});
		const remaining = reduceLifecycle(two, {
			type: "TOOL_FINISHED",
			id: "two",
			at: at(4),
		});
		expect(remaining.status).toBe("TOOL");
		expect(currentToolName(remaining)).toBe("read");
	});

	test("returns to thinking after the final tool", () => {
		const tool = reduceLifecycle(startAgent(), {
			type: "TOOL_STARTED",
			id: "one",
			name: "edit",
			at: at(2),
		});
		const state = reduceLifecycle(tool, {
			type: "TOOL_FINISHED",
			id: "one",
			at: at(3),
		});
		expect(state.status).toBe("THINKING");
		expect(state.activeTools).toEqual([]);
	});

	test("settles unseen work to waiting", () => {
		const state = reduceLifecycle(startAgent(), {
			type: "AGENT_SETTLED",
			paneFocused: false,
			at: at(2),
		});
		expect(state.status).toBe("WAITING");
	});

	test("settles focused work to idle", () => {
		const state = reduceLifecycle(startAgent(), {
			type: "AGENT_SETTLED",
			paneFocused: true,
			at: at(2),
		});
		expect(state.status).toBe("IDLE");
	});

	test("clears waiting when the pane is visited", () => {
		const waiting = reduceLifecycle(startAgent(), {
			type: "AGENT_SETTLED",
			paneFocused: false,
			at: at(2),
		});
		const state = reduceLifecycle(waiting, {
			type: "PANE_VISITED",
			at: at(3),
		});
		expect(state.status).toBe("IDLE");
	});

	test("preserves an unrecovered assistant error at settlement", () => {
		const failed = reduceLifecycle(startAgent(), {
			type: "ASSISTANT_FINISHED",
			stopReason: "error",
			at: at(2),
		});
		const state = reduceLifecycle(failed, {
			type: "AGENT_SETTLED",
			paneFocused: false,
			at: at(3),
		});
		expect(state.status).toBe("ERROR");
	});

	test("does not treat a recoverable tool error as terminal", () => {
		const tool = reduceLifecycle(startAgent(), {
			type: "TOOL_STARTED",
			id: "one",
			name: "bash",
			at: at(2),
		});
		const recovered = reduceLifecycle(tool, {
			type: "TOOL_FINISHED",
			id: "one",
			at: at(3),
		});
		const state = reduceLifecycle(recovered, {
			type: "AGENT_SETTLED",
			paneFocused: false,
			at: at(4),
		});
		expect(state.status).toBe("WAITING");
	});

	test("a new run clears error and waiting state", () => {
		const failed = reduceLifecycle(startAgent(), {
			type: "ASSISTANT_FINISHED",
			stopReason: "error",
			at: at(2),
		});
		const error = reduceLifecycle(failed, {
			type: "AGENT_SETTLED",
			paneFocused: false,
			at: at(3),
		});
		const restarted = reduceLifecycle(error, {
			type: "AGENT_STARTED",
			at: at(4),
		});
		expect(restarted.status).toBe("THINKING");
		expect(restarted.terminalError).toBe(false);

		const waiting = reduceLifecycle(restarted, {
			type: "AGENT_SETTLED",
			paneFocused: false,
			at: at(5),
		});
		expect(
			reduceLifecycle(waiting, { type: "AGENT_STARTED", at: at(6) }).status,
		).toBe("THINKING");
	});

	test("an aborted run settles to idle instead of error or thinking", () => {
		const aborted = reduceLifecycle(startAgent(), {
			type: "ASSISTANT_FINISHED",
			stopReason: "aborted",
			at: at(2),
		});
		const state = reduceLifecycle(aborted, {
			type: "AGENT_SETTLED",
			paneFocused: false,
			at: at(3),
		});
		expect(state.status).toBe("IDLE");
		expect(state.terminalError).toBe(false);
	});
});
