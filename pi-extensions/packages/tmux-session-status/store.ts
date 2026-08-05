import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
	chmod,
	lstat,
	mkdir,
	open,
	readFile,
	rename,
	unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { LifecycleState, PiSessionStatus } from "./reducer";

export const HEARTBEAT_SCHEMA_VERSION = 1;
export const HEARTBEAT_INTERVAL_MS = 5_000;
export const HEARTBEAT_STALE_MS = 15_000;

export type ProcessIdentity = {
	pid: number;
	parentPid: number;
	processGroupId: number;
	terminalProcessGroupId: number;
	tty: string;
	startedAt: string;
};

export type TmuxIdentity = {
	socketPath: string;
	serverPid: number;
	paneId: string;
	panePid: number;
	paneTty: string;
};

export type HeartbeatRecord = {
	schemaVersion: typeof HEARTBEAT_SCHEMA_VERSION;
	instanceId: string;
	processPid: number;
	processParentPid: number;
	processGroupId: number;
	terminalProcessGroupId: number;
	processTty: string;
	processStartedAt: string;
	tmuxSocketPath: string;
	tmuxServerPid: number;
	tmuxPaneId: string;
	tmuxPanePid: number;
	tmuxPaneTty: string;
	piSessionId: string;
	piSessionFile?: string;
	cwd: string;
	sessionName?: string;
	state: PiSessionStatus;
	toolName?: string;
	stateChangedAt: number;
	heartbeatAt: number;
};

const MAX_LENGTHS = {
	instanceId: 80,
	paneId: 32,
	sessionId: 160,
	path: 1_024,
	title: 160,
	tool: 80,
	identity: 160,
};

export const sanitizeStateString = (
	value: string | undefined,
	maxLength: number,
): string | undefined => {
	if (value === undefined) return undefined;
	const sanitized = value
		.normalize("NFC")
		.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, maxLength);
	return sanitized || undefined;
};

export const getStateDirectory = (
	environment: NodeJS.ProcessEnv = process.env,
	home = homedir(),
): string => {
	const configured = environment.XDG_STATE_HOME;
	const stateHome =
		configured && isAbsolute(configured)
			? configured
			: join(home, ".local", "state");
	return join(stateHome, "pi", "tmux-sessions");
};

export const heartbeatFileName = (
	identity: TmuxIdentity,
	processPid: number,
): string => {
	const serverKey = createHash("sha256")
		.update(`${identity.socketPath}\0${identity.serverPid}`)
		.digest("hex")
		.slice(0, 16);
	const paneNumber = identity.paneId.replace(/^%/, "");
	return `${serverKey}-pane-${paneNumber}-pid-${processPid}.json`;
};

export const createHeartbeatRecord = ({
	instanceId,
	processIdentity,
	tmuxIdentity,
	piSessionId,
	piSessionFile,
	cwd,
	sessionName,
	lifecycle,
	toolName,
	heartbeatAt,
}: {
	instanceId: string;
	processIdentity: ProcessIdentity;
	tmuxIdentity: TmuxIdentity;
	piSessionId: string;
	piSessionFile?: string;
	cwd: string;
	sessionName?: string;
	lifecycle: LifecycleState;
	toolName?: string;
	heartbeatAt: number;
}): HeartbeatRecord => ({
	schemaVersion: HEARTBEAT_SCHEMA_VERSION,
	instanceId:
		sanitizeStateString(instanceId, MAX_LENGTHS.instanceId) ?? randomUUID(),
	processPid: processIdentity.pid,
	processParentPid: processIdentity.parentPid,
	processGroupId: processIdentity.processGroupId,
	terminalProcessGroupId: processIdentity.terminalProcessGroupId,
	processTty:
		sanitizeStateString(processIdentity.tty, MAX_LENGTHS.identity) ?? "unknown",
	processStartedAt:
		sanitizeStateString(processIdentity.startedAt, MAX_LENGTHS.identity) ??
		"unknown",
	tmuxSocketPath:
		sanitizeStateString(tmuxIdentity.socketPath, MAX_LENGTHS.path) ?? "unknown",
	tmuxServerPid: tmuxIdentity.serverPid,
	tmuxPaneId:
		sanitizeStateString(tmuxIdentity.paneId, MAX_LENGTHS.paneId) ?? "unknown",
	tmuxPanePid: tmuxIdentity.panePid,
	tmuxPaneTty:
		sanitizeStateString(tmuxIdentity.paneTty, MAX_LENGTHS.identity) ??
		"unknown",
	piSessionId:
		sanitizeStateString(piSessionId, MAX_LENGTHS.sessionId) ?? "unknown",
	piSessionFile: sanitizeStateString(piSessionFile, MAX_LENGTHS.path),
	cwd: sanitizeStateString(cwd, MAX_LENGTHS.path) ?? "unknown",
	sessionName: sanitizeStateString(sessionName, MAX_LENGTHS.title),
	state: lifecycle.status,
	toolName: sanitizeStateString(toolName, MAX_LENGTHS.tool),
	stateChangedAt: lifecycle.stateChangedAt,
	heartbeatAt,
});

export const ensurePrivateStateDirectory = async (
	directory: string,
): Promise<void> => {
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const stats = await lstat(directory);
	if (!stats.isDirectory() || stats.isSymbolicLink()) {
		throw new Error(`Unsafe Pi tmux state directory: ${directory}`);
	}
	const uid = process.getuid?.();
	if (uid !== undefined && stats.uid !== uid) {
		throw new Error(`Pi tmux state directory is not owned by uid ${uid}`);
	}
	await chmod(directory, 0o700);
};

export const writeHeartbeatAtomic = async (
	filePath: string,
	record: HeartbeatRecord,
): Promise<void> => {
	const directory = filePath.slice(0, filePath.lastIndexOf("/"));
	await ensurePrivateStateDirectory(directory);
	const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		handle = await open(
			temporaryPath,
			constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
			0o600,
		);
		await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
		await handle.sync();
		await handle.close();
		handle = undefined;
		await rename(temporaryPath, filePath);
		await chmod(filePath, 0o600);
	} finally {
		await handle?.close().catch(() => undefined);
		await unlink(temporaryPath).catch(() => undefined);
	}
};

const hasInstanceId = (value: unknown): value is { instanceId: string } =>
	typeof value === "object" &&
	value !== null &&
	"instanceId" in value &&
	typeof value.instanceId === "string";

export const removeOwnedHeartbeat = async (
	filePath: string,
	instanceId: string,
): Promise<void> => {
	try {
		const contents = await readFile(filePath, "utf8");
		const parsed: unknown = JSON.parse(contents);
		if (!hasInstanceId(parsed) || parsed.instanceId !== instanceId) return;
		await unlink(filePath);
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return;
		}
		throw error;
	}
};
