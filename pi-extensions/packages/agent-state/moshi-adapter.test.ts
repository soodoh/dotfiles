import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	send: vi.fn(),
	close: vi.fn(),
	create: vi.fn(),
	exec: vi.fn(),
}));
vi.mock("./moshi-transport", () => ({ createMoshiWriter: mocks.create }));
vi.mock("node:child_process", () => ({ execFileSync: mocks.exec }));
vi.mock("node:os", () => ({ homedir: () => "/fixture-home" }));

import { createMoshi } from "./moshi";

const platform = Object.getOwnPropertyDescriptor(process, "platform");
function setup(os = "linux") {
	Object.defineProperty(process, "platform", { value: os });
	for (const name of [
		"HERDR_ENV",
		"HERDR_PANE_ID",
		"MOSHI_SOCKET_PATH",
		"XDG_RUNTIME_DIR",
		"TMUX",
		"TMUX_PANE",
		"ZELLIJ_SESSION_NAME",
	])
		vi.stubEnv(name, "");
	mocks.create.mockReturnValue({ send: mocks.send, close: mocks.close });
	return {
		cwd: "/fixture/project",
		model: { id: "model-id", name: "Model" },
		sessionManager: {
			getSessionId: () => "uuid",
			getSessionFile: () => "/fixture/session.jsonl",
		},
	} as unknown as ExtensionContext;
}
afterEach(() => {
	if (platform) Object.defineProperty(process, "platform", platform);
	vi.clearAllMocks();
	vi.unstubAllEnvs();
});

test.each([
	["linux", "/tmp/moshi-hook.sock"],
	["darwin", "/fixture-home/Library/Application Support/Moshi/moshi-hook.sock"],
	["win32", "\\\\.\\pipe\\moshi-hook"],
])("%s default socket, stable identity and safe metadata", (os, endpoint) => {
	const ctx = setup(os);
	createMoshi().associate(ctx);
	expect(mocks.create).toHaveBeenCalledWith(endpoint);
	expect(mocks.send).toHaveBeenCalledWith(
		expect.objectContaining({
			sessionId: "uuid",
			transcriptPath: "/fixture/session.jsonl",
			projectName: "project",
			modelName: "Model",
		}),
	);
});

test("explicit socket override wins over XDG runtime directory", () => {
	setup();
	vi.stubEnv("XDG_RUNTIME_DIR", "/fixture/runtime");
	createMoshi();
	expect(mocks.create).toHaveBeenLastCalledWith(
		"/fixture/runtime/moshi-hook.sock",
	);
	vi.stubEnv("MOSHI_SOCKET_PATH", "/fixture/override.sock");
	createMoshi();
	expect(mocks.create).toHaveBeenLastCalledWith("/fixture/override.sock");
});

test("one bounded tmux identity query per adapter, not per update", () => {
	const ctx = setup();
	vi.stubEnv("TMUX", "/fixture/tmux,123,0");
	vi.stubEnv("TMUX_PANE", "%1");
	mocks.exec.mockReturnValue("session-name\t2\n");
	const adapter = createMoshi();
	adapter.associate(ctx);
	adapter.update({ state: "working" }, ctx);
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
	expect(mocks.send).toHaveBeenLastCalledWith(
		expect.objectContaining({
			terminalKind: "tmux",
			tmuxSession: "session-name",
			tmuxWindow: "2",
			tmuxPane: "%1",
			tmuxSocket: "/fixture/tmux",
		}),
	);
});

test("failed tmux lookup retains available Herdr or Zellij identity", () => {
	const ctx = setup();
	vi.stubEnv("TMUX", "/fixture/tmux,123,0");
	vi.stubEnv("TMUX_PANE", "%1");
	mocks.exec.mockImplementation(() => {
		throw new Error("no tmux");
	});
	vi.stubEnv("HERDR_ENV", "1");
	vi.stubEnv("HERDR_PANE_ID", "w1:p1");
	createMoshi().associate(ctx);
	expect(mocks.send).toHaveBeenLastCalledWith(
		expect.objectContaining({ terminalKind: "herdr", herdrPane: "w1:p1" }),
	);
	vi.stubEnv("HERDR_ENV", "");
	vi.stubEnv("ZELLIJ_SESSION_NAME", "zellij-name");
	vi.stubEnv("ZELLIJ_PANE_ID", "3");
	createMoshi().associate(ctx);
	expect(mocks.send).toHaveBeenLastCalledWith(
		expect.objectContaining({
			terminalKind: "zellij",
			zellijSession: "zellij-name",
			zellijPane: "3",
		}),
	);
});

test("missing transcript is allowed; missing session identity never uses a shared fallback", () => {
	const ctx = setup();
	vi.spyOn(ctx.sessionManager, "getSessionFile").mockImplementation(() => {
		throw new Error("ephemeral");
	});
	const adapter = createMoshi();
	adapter.associate(ctx);
	expect(mocks.send).toHaveBeenCalledTimes(1);
	expect(mocks.send.mock.calls[0]?.[0]).not.toHaveProperty("transcriptPath");
	vi.spyOn(ctx.sessionManager, "getSessionId").mockReturnValue("");
	adapter.associate(ctx);
	vi.mocked(ctx.sessionManager.getSessionId).mockImplementation(() => {
		throw new Error("unavailable");
	});
	adapter.update({ state: "blocked" }, ctx);
	expect(mocks.send).toHaveBeenCalledTimes(1);
});
