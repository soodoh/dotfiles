import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { sanitizeStateString, type TmuxIdentity } from "./store";

export type ReadyNotificationMetadata = {
	cwd: string;
	sessionName?: string;
	tmuxSessionName?: string;
	gitBranch?: string;
};

export type NotificationDependencies = {
	platform: NodeJS.Platform;
	home: string;
	execute(command: string, args: string[]): Promise<void>;
	query(command: string, args: string[]): Promise<string>;
};

const execute = (command: string, args: string[]): Promise<void> =>
	new Promise((resolve, reject) => {
		execFile(command, args, { timeout: 2_000 }, (error) => {
			if (error) reject(error);
			else resolve();
		});
	});

const query = (command: string, args: string[]): Promise<string> =>
	new Promise((resolve, reject) => {
		execFile(
			command,
			args,
			{ encoding: "utf8", timeout: 2_000 },
			(error, stdout) => {
				if (error) reject(error);
				else resolve(stdout);
			},
		);
	});

const defaultDependencies: NotificationDependencies = {
	platform: process.platform,
	home: homedir(),
	execute,
	query,
};

const queryDisplayText = async (
	dependencies: NotificationDependencies,
	command: string,
	args: string[],
): Promise<string | undefined> =>
	sanitizeStateString(
		await dependencies.query(command, args).catch(() => ""),
		160,
	);

const gitBranchForCwd = async (
	cwd: string,
	dependencies: NotificationDependencies,
): Promise<string | undefined> => {
	const branch = await queryDisplayText(dependencies, "git", [
		"-C",
		cwd,
		"symbolic-ref",
		"--quiet",
		"--short",
		"HEAD",
	]);
	if (branch) return branch;
	return queryDisplayText(dependencies, "git", [
		"-C",
		cwd,
		"rev-parse",
		"--short",
		"HEAD",
	]);
};

const resolveNotificationMetadata = async (
	identity: TmuxIdentity,
	metadata: ReadyNotificationMetadata,
	dependencies: NotificationDependencies,
): Promise<ReadyNotificationMetadata> => {
	const [tmuxSessionName, gitBranch] = await Promise.all([
		queryDisplayText(dependencies, "tmux", [
			"-S",
			identity.socketPath,
			"display-message",
			"-p",
			"-t",
			identity.paneId,
			"#{session_name}",
		]),
		gitBranchForCwd(metadata.cwd, dependencies),
	]);
	return { ...metadata, tmuxSessionName, gitBranch };
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
	const project =
		sanitizeStateString(basename(metadata.cwd), 80) ?? "Pi session";
	const tmuxSessionName =
		sanitizeStateString(metadata.tmuxSessionName, 80) ?? "tmux session";
	const gitBranch = sanitizeStateString(metadata.gitBranch, 80);
	const piSessionName = sanitizeStateString(metadata.sessionName, 160);
	return {
		subtitle: gitBranch ? `${tmuxSessionName} · ${gitBranch}` : tmuxSessionName,
		message: piSessionName ?? `Ready for your next prompt in ${project}`,
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
	const resolvedMetadata = await resolveNotificationMetadata(
		identity,
		metadata,
		dependencies,
	);
	await dependencies
		.execute(
			"terminal-notifier",
			readyNotificationArgs(identity, resolvedMetadata, dependencies.home),
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
