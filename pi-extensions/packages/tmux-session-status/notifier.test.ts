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

describe("tmux session notifications", () => {
	test("builds a stable group and safely quoted click command", () => {
		const group = notificationGroup(identity);
		expect(group).toMatch(/^pi-[a-f0-9]{24}$/);
		expect(notificationGroup(identity)).toBe(group);
		expect(shellQuote("it's ready")).toBe(`'it'"'"'s ready'`);

		const args = readyNotificationArgs(identity, metadata, "/Users/test user");
		expect(args).toEqual([
			"-group",
			group,
			"-title",
			"Pi is ready",
			"-subtitle",
			"Refactor notifications",
			"-message",
			"Ready for your next prompt in my-project",
			"-execute",
			"'/Users/test user/.config/tmux/scripts/pi-session-focus' '/tmp/tmux user'\"'\"'s/default' '50' '%4'",
		]);
	});

	test("posts and removes native notifications only on macOS", async () => {
		const execute = vi.fn(async () => {});
		const dependencies: NotificationDependencies = {
			platform: "darwin",
			home: "/Users/test",
			execute,
		};
		await postReadyNotification(identity, metadata, dependencies);
		expect(execute).toHaveBeenCalledWith(
			"terminal-notifier",
			readyNotificationArgs(identity, metadata, dependencies.home),
		);

		await removeReadyNotification(identity, dependencies);
		expect(execute).toHaveBeenLastCalledWith("terminal-notifier", [
			"-remove",
			notificationGroup(identity),
		]);

		execute.mockClear();
		await postReadyNotification(identity, metadata, {
			...dependencies,
			platform: "linux",
		});
		expect(execute).not.toHaveBeenCalled();
	});

	test("does not disrupt Pi when terminal-notifier is unavailable", async () => {
		await expect(
			postReadyNotification(identity, metadata, {
				platform: "darwin",
				home: "/Users/test",
				execute: async () => {
					throw new Error("missing");
				},
			}),
		).resolves.toBeUndefined();
	});
});
