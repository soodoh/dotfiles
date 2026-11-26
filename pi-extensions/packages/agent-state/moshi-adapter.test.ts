import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	exec: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFileSync: mocks.exec }));
vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	return { ...actual, homedir: () => "/fixture-home" };
});

import { createMoshi } from "./moshi";

const platform = Object.getOwnPropertyDescriptor(process, "platform");
const cleanups: Array<() => Promise<void> | void> = [];

async function flush() {
	for (let n = 0; n < 4; n++)
		await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitFor(check: () => boolean, timeoutMs = 1500) {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("timed out waiting for socket");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

function clearEnv() {
	for (const name of [
		"HERDR_ENV",
		"HERDR_PANE_ID",
		"HERDR_SESSION",
		"HERDR_WORKSPACE_ID",
		"HERDR_TAB_ID",
		"MOSHI_SOCKET_PATH",
		"XDG_RUNTIME_DIR",
		"TMUX",
		"TMUX_PANE",
		"ZELLIJ_SESSION_NAME",
		"ZELLIJ_PANE_ID",
	])
		vi.stubEnv(name, "");
}

function makeCtx(): ExtensionContext {
	return {
		cwd: "/fixture/project",
		model: { id: "model-id", name: "Model" },
		sessionManager: {
			getSessionId: () => "uuid",
			getSessionFile: () => "/fixture/session.jsonl",
		},
	} as unknown as ExtensionContext;
}

async function startUnixServer(options?: { manualAck?: boolean }) {
	const dir = mkdtempSync(join(tmpdir(), "moshi-adapter-"));
	const sockPath = join(dir, "moshi.sock");
	const messages: Record<string, unknown>[] = [];
	const halfClosed: boolean[] = [];
	const acks: Array<() => void> = [];
	const server = net.createServer({ allowHalfOpen: true }, (socket) => {
		let buffer = "";
		socket.on("error", () => {});
		socket.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
		});
		socket.on("end", () => {
			halfClosed.push(true);
			const line = buffer.trim();
			if (line) messages.push(JSON.parse(line));
			const ack = () => {
				if (!socket.destroyed && !socket.writableEnded) socket.end("{}\n");
			};
			if (options?.manualAck) acks.push(ack);
			else ack();
		});
	});
	await new Promise<void>((resolve) => server.listen(sockPath, resolve));
	vi.stubEnv("MOSHI_SOCKET_PATH", sockPath);
	cleanups.push(async () => {
		for (const ack of acks) ack();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(dir, { recursive: true, force: true });
	});
	return { sockPath, messages, halfClosed, acks };
}

function spySockets() {
	const endpoints: unknown[] = [];
	const sockets: EventEmitter[] = [];
	const lines: Record<string, unknown>[] = [];
	vi.spyOn(net, "createConnection").mockImplementation(((endpoint: unknown) => {
		endpoints.push(endpoint);
		const socket = new EventEmitter();
		Object.assign(socket, {
			destroy: vi.fn(),
			end: vi.fn(),
			write: (line: string) => lines.push(JSON.parse(line)),
		});
		sockets.push(socket);
		queueMicrotask(() => socket.emit("connect"));
		return socket;
	}) as unknown as typeof net.createConnection);
	return { endpoints, sockets, lines };
}

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	if (platform) Object.defineProperty(process, "platform", platform);
	vi.restoreAllMocks();
	vi.clearAllMocks();
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

test.each([
	["linux", "/tmp/moshi-hook.sock"],
	["darwin", "/fixture-home/Library/Application Support/Moshi/moshi-hook.sock"],
	["win32", "\\\\.\\pipe\\moshi-hook"],
])(
	"%s default socket, stable identity and safe metadata",
	async (os, endpoint) => {
		clearEnv();
		Object.defineProperty(process, "platform", { value: os });
		const spy = spySockets();
		const adapter = createMoshi();
		cleanups.push(() => adapter.close());
		adapter.associate(makeCtx());
		await flush();
		expect(spy.endpoints).toEqual([endpoint]);
		expect(spy.lines[0]).toMatchObject({
			sessionId: "uuid",
			transcriptPath: "/fixture/session.jsonl",
			projectName: "project",
			modelName: "Model",
		});
	},
);

test("explicit socket override wins over XDG runtime directory", async () => {
	clearEnv();
	Object.defineProperty(process, "platform", { value: "linux" });
	const spy = spySockets();
	vi.stubEnv("XDG_RUNTIME_DIR", "/fixture/runtime");
	const first = createMoshi();
	cleanups.push(() => first.close());
	first.associate(makeCtx());
	await flush();
	expect(spy.endpoints.at(-1)).toBe("/fixture/runtime/moshi-hook.sock");

	vi.stubEnv("MOSHI_SOCKET_PATH", "/fixture/override.sock");
	const second = createMoshi();
	cleanups.push(() => second.close());
	second.associate(makeCtx());
	await flush();
	expect(spy.endpoints.at(-1)).toBe("/fixture/override.sock");
});

test("one bounded tmux identity query per adapter, not per update", async () => {
	clearEnv();
	const server = await startUnixServer();
	vi.stubEnv("TMUX", "/fixture/tmux,123,0");
	vi.stubEnv("TMUX_PANE", "%1");
	mocks.exec.mockReturnValue("session-name\t2\n");
	const ctx = makeCtx();
	const adapter = createMoshi();
	cleanups.push(() => adapter.close());
	adapter.associate(ctx);
	await waitFor(() => server.messages.length === 1);
	adapter.update({ state: "working" }, ctx);
	await waitFor(() => server.messages.length === 2);
	expect(mocks.exec).toHaveBeenCalledTimes(1);
	expect(mocks.exec).toHaveBeenCalledWith(
		"tmux",
		[
			"-S",
			"/fixture/tmux",
			"display-message",
			"-p",
			"-t",
			"%1",
			"#{session_name}\t#{window_index}",
		],
		expect.objectContaining({ timeout: 200 }),
	);
	expect(server.messages.at(-1)).toMatchObject({
		terminalKind: "tmux",
		tmuxSession: "session-name",
		tmuxWindow: "2",
		tmuxPane: "%1",
		tmuxSocket: "/fixture/tmux",
	});
});

test("failed tmux lookup retains available Herdr or Zellij identity", async () => {
	clearEnv();
	const server = await startUnixServer();
	vi.stubEnv("TMUX", "/fixture/tmux,123,0");
	vi.stubEnv("TMUX_PANE", "%1");
	mocks.exec.mockImplementation(() => {
		throw new Error("no tmux");
	});
	vi.stubEnv("HERDR_ENV", "1");
	vi.stubEnv("HERDR_PANE_ID", "w1:p1");
	const herdrAdapter = createMoshi();
	cleanups.push(() => herdrAdapter.close());
	herdrAdapter.associate(makeCtx());
	await waitFor(() => server.messages.length === 1);
	expect(server.messages.at(-1)).toMatchObject({
		terminalKind: "herdr",
		herdrPane: "w1:p1",
	});

	vi.stubEnv("HERDR_ENV", "");
	vi.stubEnv("ZELLIJ_SESSION_NAME", "zellij-name");
	vi.stubEnv("ZELLIJ_PANE_ID", "3");
	const zellijAdapter = createMoshi();
	cleanups.push(() => zellijAdapter.close());
	zellijAdapter.associate(makeCtx());
	await waitFor(() => server.messages.length === 2);
	expect(server.messages.at(-1)).toMatchObject({
		terminalKind: "zellij",
		zellijSession: "zellij-name",
		zellijPane: "3",
	});
});

test("missing transcript is allowed; missing session identity never uses a shared fallback", async () => {
	clearEnv();
	const server = await startUnixServer();
	const ctx = makeCtx();
	vi.spyOn(ctx.sessionManager, "getSessionFile").mockImplementation(() => {
		throw new Error("ephemeral");
	});
	const adapter = createMoshi();
	cleanups.push(() => adapter.close());
	adapter.associate(ctx);
	await waitFor(() => server.messages.length === 1);
	expect(server.messages[0]).not.toHaveProperty("transcriptPath");

	vi.spyOn(ctx.sessionManager, "getSessionId").mockReturnValue("");
	adapter.associate(ctx);
	vi.mocked(ctx.sessionManager.getSessionId).mockImplementation(() => {
		throw new Error("unavailable");
	});
	adapter.update({ state: "blocked" }, ctx);
	await flush();
	expect(server.messages).toHaveLength(1);
});

test("ordered latest state half-closes and suppresses obsolete waiting/completion updates", async () => {
	clearEnv();
	const server = await startUnixServer({ manualAck: true });
	const ctx = makeCtx();
	const adapter = createMoshi();
	cleanups.push(() => adapter.close());

	adapter.associate(ctx);
	await waitFor(() => server.acks.length === 1);
	adapter.update({ state: "blocked" }, ctx);
	adapter.update({ state: "idle", outcome: "stop" }, ctx);
	adapter.update({ state: "working" }, ctx);
	server.acks[0]?.();
	await waitFor(() => server.acks.length === 2);
	server.acks[1]?.();

	expect(server.halfClosed).toEqual([true, true]);
	expect(server.messages.map((m) => m.eventName)).toEqual([
		"SessionStart",
		"AgentStart",
	]);
});

test("prompt resolution survives conflation before completion over a real Unix socket", async () => {
	clearEnv();
	const server = await startUnixServer({ manualAck: true });
	const ctx = makeCtx();
	const adapter = createMoshi();
	cleanups.push(() => adapter.close());

	adapter.update({ state: "blocked" }, ctx);
	await waitFor(() => server.acks.length === 1);
	adapter.update({ state: "idle", previous: "blocked", outcome: "stop" }, ctx);
	server.acks[0]?.();
	await waitFor(() => server.acks.length === 2);
	server.acks[1]?.();
	await waitFor(() => server.acks.length === 3);
	server.acks[2]?.();

	expect(server.messages.map((m) => [m.eventName, m.category])).toEqual([
		["InputRequest", "approval_required"],
		["PermissionResolved", "session_started"],
		["AgentEnd", "task_complete"],
	]);
});

test("a real quit cancels stale reports and sends only the session closure", async () => {
	clearEnv();
	const server = await startUnixServer({ manualAck: true });
	const ctx = makeCtx();
	const adapter = createMoshi();
	cleanups.push(() => adapter.close());

	adapter.associate(ctx);
	await waitFor(() => server.acks.length === 1);
	adapter.update({ state: "working" }, ctx);
	const closing = adapter.close(ctx);
	await waitFor(() => server.acks.length === 2);
	server.acks[1]?.();
	await closing;

	expect(server.messages.map((m) => [m.type, m.eventName])).toEqual([
		["session.update", "SessionStart"],
		["session.closed", "SessionEnd"],
	]);
});

test.each(["error", "end", "close"])(
	"%s fails silently without retrying a notification",
	async (event) => {
		clearEnv();
		const spy = spySockets();
		const adapter = createMoshi();
		cleanups.push(() => adapter.close());
		adapter.update({ state: "idle", outcome: "stop" }, makeCtx());
		await flush();
		spy.sockets[0]?.emit(event, new Error("fixture failure"));
		await flush();
		expect(spy.sockets).toHaveLength(1);
		expect(
			(spy.sockets[0] as unknown as net.Socket).destroy,
		).toHaveBeenCalled();
	},
);

test("stalled daemon attempts are bounded and shutdown cancels unsent work", async () => {
	clearEnv();
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
	const spy = spySockets();
	const ctx = makeCtx();
	const adapter = createMoshi();
	cleanups.push(() => adapter.close());

	adapter.associate(ctx);
	await flush();
	await vi.advanceTimersByTimeAsync(1000);
	expect((spy.sockets[0] as unknown as net.Socket).destroy).toHaveBeenCalled();
	adapter.update({ state: "working" }, ctx);
	await flush();
	adapter.update({ state: "blocked" }, ctx);
	await adapter.close();
	adapter.update({ state: "idle", outcome: "stop" }, ctx);
	await vi.advanceTimersByTimeAsync(1000);
	await flush();
	expect(spy.lines.map((m) => m.eventName)).toEqual([
		"SessionStart",
		"AgentStart",
	]);
});

test("synchronous connection failure cannot escape", async () => {
	clearEnv();
	const spy = spySockets();
	vi.mocked(net.createConnection).mockImplementation(() => {
		throw new Error("no transport");
	});
	const adapter = createMoshi();
	cleanups.push(() => adapter.close());
	expect(() =>
		adapter.update({ state: "idle", outcome: "stop" }, makeCtx()),
	).not.toThrow();
	await flush();
	expect(spy.lines).toEqual([]);
});
