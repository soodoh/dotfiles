import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	normalizeTty,
	parseProcessIdentity,
	parseTmuxIdentity,
	TmuxSessionRuntime,
} from "./runtime";
import type { HeartbeatRecord } from "./store";

const processIdentity = {
	pid: 200,
	parentPid: 100,
	processGroupId: 200,
	terminalProcessGroupId: 200,
	tty: "ttys001",
	startedAt: "Wed Aug 5 10:00:00 2026",
};

const tmuxIdentity = {
	socketPath: "/tmp/tmux-501/default",
	serverPid: 50,
	paneId: "%4",
	panePid: 100,
	paneTty: "/dev/ttys001",
};

const metadata = {
	piSessionId: "session-one",
	piSessionFile: "/home/user/.pi/session.jsonl",
	cwd: "/home/user/project",
	sessionName: "Picker tests",
};

const flushPromises = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
};

describe("tmux session runtime", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test("parses portable process and tmux identities", () => {
		expect(
			parseProcessIdentity("200 100 200 200 ttys001 Wed Aug 5 10:00:00 2026\n"),
		).toEqual(processIdentity);
		expect(
			parseTmuxIdentity(
				"/tmp/tmux-501/default\u001f50\u001f%4\u001f100\u001f/dev/ttys001\n",
			),
		).toEqual(tmuxIdentity);
		expect(normalizeTty("/dev/pts/4")).toBe("pts/4");
		expect(parseProcessIdentity("200 100 200 0 ?? bad")).toBeUndefined();
	});

	test("starts one timer, writes transitions, and cleans up on shutdown", async () => {
		const writes: HeartbeatRecord[] = [];
		const removals: Array<{ filePath: string; instanceId: string }> = [];
		let activePaneIds = new Set<string>();
		const runtime = new TmuxSessionRuntime(
			processIdentity,
			tmuxIdentity,
			metadata,
			{
				now: Date.now,
				activePaneIds: async () => activePaneIds,
				write: async (_filePath, record) => {
					writes.push(record);
				},
				remove: async (filePath, instanceId) => {
					removals.push({ filePath, instanceId });
				},
				setInterval,
				clearInterval,
			},
			"/tmp/test-state",
		);

		await runtime.start();
		await runtime.start();
		expect(vi.getTimerCount()).toBe(1);
		expect(writes.at(-1)?.state).toBe("STARTING");

		await runtime.dispatch({ type: "RESOURCES_READY", at: 1_100 });
		await runtime.dispatch({ type: "AGENT_STARTED", at: 1_200 });
		await runtime.dispatch({
			type: "TOOL_STARTED",
			id: "tool-one",
			name: "bash",
			at: 1_300,
		});
		expect(writes.at(-1)?.state).toBe("TOOL");
		expect(writes.at(-1)?.toolName).toBe("bash");

		await runtime.dispatch({
			type: "TOOL_FINISHED",
			id: "tool-one",
			at: 1_400,
		});
		await runtime.settle();
		expect(runtime.state.status).toBe("WAITING");

		activePaneIds = new Set(["%4"]);
		vi.setSystemTime(2_000);
		await vi.advanceTimersByTimeAsync(1_000);
		await flushPromises();
		expect(runtime.state.status).toBe("IDLE");

		const writesBeforeShutdown = writes.length;
		await runtime.shutdown();
		expect(vi.getTimerCount()).toBe(0);
		expect(removals).toEqual([
			{ filePath: runtime.filePath, instanceId: runtime.instanceId },
		]);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(writes).toHaveLength(writesBeforeShutdown);
	});

	test("refreshes a heartbeat every five seconds", async () => {
		const writes: HeartbeatRecord[] = [];
		const runtime = new TmuxSessionRuntime(
			processIdentity,
			tmuxIdentity,
			metadata,
			{
				now: Date.now,
				activePaneIds: async () => new Set(),
				write: async (_filePath, record) => {
					writes.push(record);
				},
				remove: async () => {},
				setInterval,
				clearInterval,
			},
			"/tmp/test-state",
		);
		await runtime.start();
		await vi.advanceTimersByTimeAsync(5_000);
		await flushPromises();
		expect(writes.at(-1)?.heartbeatAt).toBe(6_000);
		await runtime.shutdown();
	});
});
