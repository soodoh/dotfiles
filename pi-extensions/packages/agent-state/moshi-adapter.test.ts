import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";
import { flush } from "./agent-state.test.fixture";
import { createMoshi } from "./moshi";

const cleanups: Array<() => Promise<void> | void> = [];

async function waitFor(check: () => boolean, timeoutMs = 1500) {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("timed out waiting for socket");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
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
	cleanups.push(async () => {
		for (const ack of acks) ack();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(dir, { recursive: true, force: true });
	});
	return { sockPath, messages, halfClosed, acks };
}

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

test("one bounded tmux identity query per adapter, not per update", async () => {
	const server = await startUnixServer();
	const execTmux = vi.fn(() => "session-name\t2\n");
	const ctx = makeCtx();
	const adapter = createMoshi({
		env: {
			MOSHI_SOCKET_PATH: server.sockPath,
			TMUX: "/fixture/tmux,123,0",
			TMUX_PANE: "%1",
		},
		execTmux,
	});
	cleanups.push(() => adapter.close());
	adapter.associate(ctx);
	await waitFor(() => server.messages.length === 1);
	adapter.update({ state: "working" }, ctx);
	await waitFor(() => server.messages.length === 2);
	expect(execTmux).toHaveBeenCalledTimes(1);
	expect(execTmux).toHaveBeenCalledWith([
		"-S",
		"/fixture/tmux",
		"display-message",
		"-p",
		"-t",
		"%1",
		"#{session_name}\t#{window_index}",
	]);
	expect(server.messages.at(-1)).toMatchObject({
		terminalKind: "tmux",
		tmuxSession: "session-name",
		tmuxWindow: "2",
		tmuxPane: "%1",
		tmuxSocket: "/fixture/tmux",
	});
});

test("failed tmux lookup retains available Herdr or Zellij identity", async () => {
	const server = await startUnixServer();
	const execTmux = () => {
		throw new Error("no tmux");
	};
	const herdrAdapter = createMoshi({
		env: {
			MOSHI_SOCKET_PATH: server.sockPath,
			TMUX: "/fixture/tmux,123,0",
			TMUX_PANE: "%1",
			HERDR_ENV: "1",
			HERDR_PANE_ID: "w1:p1",
		},
		execTmux,
	});
	cleanups.push(() => herdrAdapter.close());
	herdrAdapter.associate(makeCtx());
	await waitFor(() => server.messages.length === 1);
	expect(server.messages.at(-1)).toMatchObject({
		terminalKind: "herdr",
		herdrPane: "w1:p1",
	});

	const zellijAdapter = createMoshi({
		env: {
			MOSHI_SOCKET_PATH: server.sockPath,
			TMUX: "/fixture/tmux,123,0",
			TMUX_PANE: "%1",
			ZELLIJ_SESSION_NAME: "zellij-name",
			ZELLIJ_PANE_ID: "3",
		},
		execTmux,
	});
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
	const server = await startUnixServer();
	const ctx = makeCtx();
	vi.spyOn(ctx.sessionManager, "getSessionFile").mockImplementation(() => {
		throw new Error("ephemeral");
	});
	const adapter = createMoshi({
		env: { MOSHI_SOCKET_PATH: server.sockPath },
	});
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
	const server = await startUnixServer({ manualAck: true });
	const ctx = makeCtx();
	const adapter = createMoshi({
		env: { MOSHI_SOCKET_PATH: server.sockPath },
	});
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
	const server = await startUnixServer({ manualAck: true });
	const ctx = makeCtx();
	const adapter = createMoshi({
		env: { MOSHI_SOCKET_PATH: server.sockPath },
	});
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
	const server = await startUnixServer({ manualAck: true });
	const ctx = makeCtx();
	const adapter = createMoshi({
		env: { MOSHI_SOCKET_PATH: server.sockPath },
	});
	cleanups.push(() => adapter.close());

	adapter.associate(ctx);
	await waitFor(() => server.acks.length === 1);
	adapter.update({ state: "working" }, ctx);
	const closing = adapter.close(ctx);
	await waitFor(() => server.acks.length === 2);
	server.acks[1]?.();
	await closing;
	// Post-close updates must be ignored by the adapter itself.
	adapter.update({ state: "idle", outcome: "stop" }, ctx);
	await flush();

	expect(server.messages.map((m) => [m.type, m.eventName])).toEqual([
		["session.update", "SessionStart"],
		["session.closed", "SessionEnd"],
	]);
});
