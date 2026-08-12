import {
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { initialLifecycleState } from "./reducer";
import {
	createHeartbeatRecord,
	getStateDirectory,
	heartbeatFileName,
	removeOwnedHeartbeat,
	sanitizeStateString,
	writeHeartbeatAtomic,
} from "./store";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
	const directory = await mkdtemp(join(tmpdir(), "pi-tmux-status-test-"));
	temporaryDirectories.push(directory);
	return directory;
};

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

const record = (instanceId = "instance-one") =>
	createHeartbeatRecord({
		instanceId,
		processIdentity,
		tmuxIdentity,
		piSessionId: "session-one",
		piSessionFile: "/home/user/.pi/session.jsonl",
		cwd: "/home/user/project",
		sessionName: "Picker tests",
		lifecycle: initialLifecycleState(1_000),
		sessionStartedAt: 500,
		heartbeatAt: 2_000,
	});

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("tmux heartbeat storage", () => {
	test("uses XDG_STATE_HOME only when it is absolute", () => {
		expect(getStateDirectory({ XDG_STATE_HOME: "/state" }, "/home/user")).toBe(
			"/state/pi/tmux-sessions",
		);
		expect(
			getStateDirectory({ XDG_STATE_HOME: "relative" }, "/home/user"),
		).toBe("/home/user/.local/state/pi/tmux-sessions");
	});

	test("creates a server- and pane-specific bounded file name", () => {
		const name = heartbeatFileName(tmuxIdentity, processIdentity.pid);
		expect(name).toMatch(/^[a-f0-9]{16}-pane-4-pid-200\.json$/);
		expect(name).not.toContain(tmuxIdentity.socketPath);
	});

	test("sanitizes control and format characters before persistence", () => {
		expect(
			sanitizeStateString("hello\tworld\n\u001b]52;c;secret\u0007\u202e", 20),
		).toBe("hello world ]52;c;se");
	});

	test("writes atomically with private directory and file modes", async () => {
		const root = await createTemporaryDirectory();
		const filePath = join(root, "state", "heartbeat.json");
		await writeHeartbeatAtomic(filePath, record());

		const parsed = JSON.parse(await readFile(filePath, "utf8"));
		expect(parsed.instanceId).toBe("instance-one");
		expect(parsed.sessionStartedAt).toBe(500);
		expect((await stat(join(root, "state"))).mode & 0o777).toBe(0o700);
		expect((await stat(filePath)).mode & 0o777).toBe(0o600);
		expect(await readdir(join(root, "state"))).toEqual(["heartbeat.json"]);
	});

	test("does not let an old runtime delete a replacement heartbeat", async () => {
		const root = await createTemporaryDirectory();
		const filePath = join(root, "heartbeat.json");
		await writeFile(filePath, JSON.stringify(record("new-instance")), "utf8");

		await removeOwnedHeartbeat(filePath, "old-instance");
		expect(JSON.parse(await readFile(filePath, "utf8")).instanceId).toBe(
			"new-instance",
		);
		await removeOwnedHeartbeat(filePath, "new-instance");
		await expect(readFile(filePath, "utf8")).rejects.toMatchObject({
			code: "ENOENT",
		});
	});
});
