import { describe, expect, test, vi } from "vitest";
import type { NotificationDependencies } from "./notifier";
import {
	notificationGroup,
	postReadyNotification,
	readyNotificationArgs,
	removeReadyNotification,
	shellQuote,
} from "./notifier";

const identity = {
	socketPath: "/tmp/tmux user's/default",
	serverPid: 50,
	paneId: "%4",
	panePid: 100,
	paneTty: "/dev/ttys001",
};

const metadata = {
	cwd: "/home/user/my-project",
	sessionName: "Refactor notifications",
};

const displayMetadata = {
	...metadata,
	tmuxSessionName: "dotfiles",
	gitBranch: "feature/notifier-copy",
};

describe("tmux session notifications", () => {
	test("builds a stable group and safely quoted click command", () => {
		const group = notificationGroup(identity);
		expect(group).toMatch(/^pi-[a-f0-9]{24}$/);
		expect(notificationGroup(identity)).toBe(group);
		expect(shellQuote("it's ready")).toBe(`'it'"'"'s ready'`);

		const args = readyNotificationArgs(
			identity,
			displayMetadata,
			"/Users/test user",
		);
		expect(args).toEqual([
			"-group",
			group,
			"-title",
			"Pi is ready",
			"-subtitle",
			"dotfiles · feature/notifier-copy",
			"-message",
			"Refactor notifications",
			"-execute",
			"'/Users/test user/.config/tmux/scripts/pi-session-focus' '/tmp/tmux user'\"'\"'s/default' '50' '%4'",
		]);

		const unnamedArgs = readyNotificationArgs(
			identity,
			{
				cwd: metadata.cwd,
				tmuxSessionName: "dotfiles",
				gitBranch: "main",
			},
			"/Users/test",
		);
		expect(unnamedArgs.slice(4, 8)).toEqual([
			"-subtitle",
			"dotfiles · main",
			"-message",
			"Ready for your next prompt in my-project",
		]);
	});

	test("posts and removes native notifications only on macOS", async () => {
		const execute = vi.fn(async () => {});
		const query = vi.fn(async (command: string, args: string[]) => {
			if (command === "tmux") return "dotfiles\n";
			if (args.includes("symbolic-ref")) return "feature/notifier-copy\n";
			return "";
		});
		const dependencies: NotificationDependencies = {
			platform: "darwin",
			home: "/Users/test",
			execute,
			query,
		};
		await postReadyNotification(identity, metadata, dependencies);
		expect(execute).toHaveBeenCalledWith(
			"terminal-notifier",
			readyNotificationArgs(identity, displayMetadata, dependencies.home),
		);

		await removeReadyNotification(identity, dependencies);
		expect(execute).toHaveBeenLastCalledWith("terminal-notifier", [
			"-remove",
			notificationGroup(identity),
		]);

		execute.mockClear();
		query.mockClear();
		await postReadyNotification(identity, metadata, {
			...dependencies,
			platform: "linux",
		});
		expect(execute).not.toHaveBeenCalled();
		expect(query).not.toHaveBeenCalled();
	});

	test("uses the short commit when Git HEAD is detached", async () => {
		const execute = vi.fn(async () => {});
		const dependencies: NotificationDependencies = {
			platform: "darwin",
			home: "/Users/test",
			execute,
			query: async (command, args) => {
				if (command === "tmux") return "dotfiles\n";
				if (args.includes("symbolic-ref")) return "";
				return "abc123\n";
			},
		};

		await postReadyNotification(identity, metadata, dependencies);
		expect(execute).toHaveBeenCalledWith(
			"terminal-notifier",
			readyNotificationArgs(
				identity,
				{ ...metadata, tmuxSessionName: "dotfiles", gitBranch: "abc123" },
				dependencies.home,
			),
		);
	});

	test("does not disrupt Pi when terminal-notifier is unavailable", async () => {
		await expect(
			postReadyNotification(identity, metadata, {
				platform: "darwin",
				home: "/Users/test",
				execute: async () => {
					throw new Error("missing");
				},
				query: async () => "",
			}),
		).resolves.toBeUndefined();
	});
});
