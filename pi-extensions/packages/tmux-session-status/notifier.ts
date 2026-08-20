import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { TmuxIdentity } from "./store";

export type ReadyNotificationMetadata = {
	cwd: string;
	sessionName?: string;
};

export type NotificationDependencies = {
	platform: NodeJS.Platform;
	home: string;
	execute(command: string, args: string[]): Promise<void>;
};

const execute = (command: string, args: string[]): Promise<void> =>
	new Promise((resolve, reject) => {
		execFile(command, args, { timeout: 2_000 }, (error) => {
			if (error) reject(error);
			else resolve();
		});
	});

const defaultDependencies: NotificationDependencies = {
	platform: process.platform,
	home: homedir(),
	execute,
};

export const shellQuote = (value: string): string =>
	`'${value.replaceAll("'", `'"'"'`)}'`;

export const notificationGroup = (identity: TmuxIdentity): string =>
	`pi-${createHash("sha256")
		.update(`${identity.socketPath}\0${identity.serverPid}\0${identity.paneId}`)
		.digest("hex")
		.slice(0, 24)}`;

const notificationText = (
	metadata: ReadyNotificationMetadata,
): { subtitle: string; message: string } => {
	const project = basename(metadata.cwd) || "Pi session";
	return {
		subtitle: metadata.sessionName?.trim() || project,
		message: `Ready for your next prompt in ${project}`,
	};
};

export const readyNotificationArgs = (
	identity: TmuxIdentity,
	metadata: ReadyNotificationMetadata,
	home: string,
): string[] => {
	const focusScript = join(
		home,
		".config",
		"tmux",
		"scripts",
		"pi-session-focus",
	);
	const clickCommand = [
		focusScript,
		identity.socketPath,
		String(identity.serverPid),
		identity.paneId,
	]
		.map(shellQuote)
		.join(" ");
	const { subtitle, message } = notificationText(metadata);
	return [
		"-group",
		notificationGroup(identity),
		"-title",
		"Pi is ready",
		"-subtitle",
		subtitle,
		"-message",
		message,
		"-execute",
		clickCommand,
	];
};

export const postReadyNotification = async (
	identity: TmuxIdentity,
	metadata: ReadyNotificationMetadata,
	dependencies: NotificationDependencies = defaultDependencies,
): Promise<void> => {
	if (dependencies.platform !== "darwin") return;
	await dependencies
		.execute(
			"terminal-notifier",
			readyNotificationArgs(identity, metadata, dependencies.home),
		)
		.catch(() => undefined);
};

export const removeReadyNotification = async (
	identity: TmuxIdentity,
	dependencies: NotificationDependencies = defaultDependencies,
): Promise<void> => {
	if (dependencies.platform !== "darwin") return;
	await dependencies
		.execute("terminal-notifier", ["-remove", notificationGroup(identity)])
		.catch(() => undefined);
};
