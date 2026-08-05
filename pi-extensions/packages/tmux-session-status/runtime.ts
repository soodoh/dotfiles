import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	currentToolName,
	initialLifecycleState,
	type LifecycleEvent,
	type LifecycleState,
	reduceLifecycle,
} from "./reducer";
import {
	createHeartbeatRecord,
	getStateDirectory,
	HEARTBEAT_INTERVAL_MS,
	heartbeatFileName,
	type ProcessIdentity,
	removeOwnedHeartbeat,
	type TmuxIdentity,
	writeHeartbeatAtomic,
} from "./store";

const FIELD_SEPARATOR = "\u001f";
const POLL_INTERVAL_MS = 1_000;
const PROCESS_QUERY_FIELDS = [
	"pid=",
	"ppid=",
	"pgid=",
	"tpgid=",
	"tty=",
	"lstart=",
];

const execText = (
	command: string,
	args: string[],
	environment: NodeJS.ProcessEnv = process.env,
): Promise<string> =>
	new Promise((resolve, reject) => {
		execFile(
			command,
			args,
			{ encoding: "utf8", env: environment, timeout: 2_000 },
			(error, stdout) => {
				if (error) reject(error);
				else resolve(stdout);
			},
		);
	});

const positiveInteger = (value: string): number | undefined => {
	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 ? number : undefined;
};

export const normalizeTty = (tty: string): string =>
	tty.trim().replace(/^\/dev\//, "");

export const parseProcessIdentity = (
	output: string,
): ProcessIdentity | undefined => {
	const fields = output.trim().split(/\s+/);
	if (fields.length < 10) return undefined;
	const pid = positiveInteger(fields[0] ?? "");
	const parentPid = positiveInteger(fields[1] ?? "");
	const processGroupId = positiveInteger(fields[2] ?? "");
	const terminalProcessGroupId = positiveInteger(fields[3] ?? "");
	const tty = fields[4];
	const startedAt = fields.slice(5).join(" ");
	if (
		pid === undefined ||
		parentPid === undefined ||
		processGroupId === undefined ||
		terminalProcessGroupId === undefined ||
		!tty ||
		tty === "?" ||
		tty === "??" ||
		!startedAt
	) {
		return undefined;
	}
	return {
		pid,
		parentPid,
		processGroupId,
		terminalProcessGroupId,
		tty,
		startedAt,
	};
};

export const parseTmuxIdentity = (output: string): TmuxIdentity | undefined => {
	const [socketPath, serverPidText, paneId, panePidText, paneTty] = output
		.trim()
		.split(FIELD_SEPARATOR);
	const serverPid = positiveInteger(serverPidText ?? "");
	const panePid = positiveInteger(panePidText ?? "");
	if (
		!socketPath ||
		serverPid === undefined ||
		!paneId?.match(/^%\d+$/) ||
		panePid === undefined ||
		!paneTty
	) {
		return undefined;
	}
	return { socketPath, serverPid, paneId, panePid, paneTty };
};

export const queryProcessIdentity = async (
	pid: number,
): Promise<ProcessIdentity | undefined> => {
	try {
		const output = await execText(
			"ps",
			[
				"-p",
				String(pid),
				...PROCESS_QUERY_FIELDS.flatMap((field) => ["-o", field]),
			],
			{ ...process.env, LC_ALL: "C" },
		);
		return parseProcessIdentity(output);
	} catch {
		return undefined;
	}
};

const isDescendantOf = async (
	processIdentity: ProcessIdentity,
	ancestorPid: number,
): Promise<boolean> => {
	let current = processIdentity;
	for (let depth = 0; depth < 64; depth += 1) {
		if (current.pid === ancestorPid || current.parentPid === ancestorPid) {
			return true;
		}
		if (current.parentPid <= 1 || current.parentPid === current.pid)
			return false;
		const parent = await queryProcessIdentity(current.parentPid);
		if (!parent) return false;
		current = parent;
	}
	return false;
};

export const discoverRuntimeIdentity = async (
	paneId: string | undefined = process.env.TMUX_PANE,
): Promise<
	{ processIdentity: ProcessIdentity; tmuxIdentity: TmuxIdentity } | undefined
> => {
	if (!process.env.TMUX || !paneId?.match(/^%\d+$/)) return undefined;
	try {
		const tmuxOutput = await execText("tmux", [
			"display-message",
			"-p",
			"-t",
			paneId,
			`#{socket_path}${FIELD_SEPARATOR}#{pid}${FIELD_SEPARATOR}#{pane_id}${FIELD_SEPARATOR}#{pane_pid}${FIELD_SEPARATOR}#{pane_tty}`,
		]);
		const tmuxIdentity = parseTmuxIdentity(tmuxOutput);
		const processIdentity = await queryProcessIdentity(process.pid);
		if (!tmuxIdentity || !processIdentity || tmuxIdentity.paneId !== paneId) {
			return undefined;
		}
		if (
			normalizeTty(processIdentity.tty) !==
				normalizeTty(tmuxIdentity.paneTty) ||
			processIdentity.processGroupId !==
				processIdentity.terminalProcessGroupId ||
			!(await isDescendantOf(processIdentity, tmuxIdentity.panePid))
		) {
			return undefined;
		}
		return { processIdentity, tmuxIdentity };
	} catch {
		return undefined;
	}
};

export const queryActivePaneIds = async (): Promise<Set<string>> => {
	try {
		const output = await execText("tmux", ["list-clients", "-F", "#{pane_id}"]);
		return new Set(
			output
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => /^%\d+$/.test(line)),
		);
	} catch {
		return new Set();
	}
};

type RuntimeMetadata = {
	piSessionId: string;
	piSessionFile?: string;
	cwd: string;
	sessionName?: string;
};

export type RuntimeDependencies = {
	now(): number;
	activePaneIds(): Promise<Set<string>>;
	write(
		filePath: string,
		record: ReturnType<typeof createHeartbeatRecord>,
	): Promise<void>;
	remove(filePath: string, instanceId: string): Promise<void>;
	setInterval(
		callback: () => void,
		intervalMs: number,
	): ReturnType<typeof setInterval>;
	clearInterval(timer: ReturnType<typeof setInterval>): void;
};

const defaultDependencies: RuntimeDependencies = {
	now: Date.now,
	activePaneIds: queryActivePaneIds,
	write: writeHeartbeatAtomic,
	remove: removeOwnedHeartbeat,
	setInterval,
	clearInterval,
};

export class TmuxSessionRuntime {
	readonly instanceId = randomUUID();
	readonly filePath: string;
	private lifecycle: LifecycleState;
	private metadata: RuntimeMetadata;
	private active = false;
	private timer: ReturnType<typeof setInterval> | undefined;
	private writeQueue = Promise.resolve();
	private lastHeartbeatAt = 0;
	private pollInFlight = false;

	constructor(
		private readonly processIdentity: ProcessIdentity,
		private readonly tmuxIdentity: TmuxIdentity,
		metadata: RuntimeMetadata,
		private readonly dependencies: RuntimeDependencies = defaultDependencies,
		stateDirectory = getStateDirectory(),
	) {
		this.metadata = metadata;
		this.lifecycle = initialLifecycleState(dependencies.now());
		this.filePath = join(
			stateDirectory,
			heartbeatFileName(tmuxIdentity, processIdentity.pid),
		);
	}

	async start(): Promise<void> {
		if (this.active) return;
		this.active = true;
		await this.publish(this.dependencies.now());
		this.timer = this.dependencies.setInterval(() => {
			void this.poll();
		}, POLL_INTERVAL_MS);
		this.timer.unref?.();
	}

	async dispatch(event: LifecycleEvent): Promise<void> {
		if (!this.active) return;
		const previous = this.lifecycle;
		this.lifecycle = reduceLifecycle(previous, event);
		if (this.lifecycle !== previous) await this.publish(event.at);
	}

	async settle(): Promise<void> {
		if (!this.active) return;
		const focused = (await this.dependencies.activePaneIds()).has(
			this.tmuxIdentity.paneId,
		);
		await this.dispatch({
			type: "AGENT_SETTLED",
			paneFocused: focused,
			at: this.dependencies.now(),
		});
	}

	async updateSessionName(sessionName: string | undefined): Promise<void> {
		if (!this.active || this.metadata.sessionName === sessionName) return;
		this.metadata = { ...this.metadata, sessionName };
		await this.publish(this.dependencies.now());
	}

	async shutdown(): Promise<void> {
		if (!this.active && !this.timer) return;
		this.active = false;
		if (this.timer) {
			this.dependencies.clearInterval(this.timer);
			this.timer = undefined;
		}
		await this.writeQueue;
		await this.dependencies
			.remove(this.filePath, this.instanceId)
			.catch(() => undefined);
	}

	get state(): LifecycleState {
		return this.lifecycle;
	}

	private async poll(): Promise<void> {
		if (!this.active || this.pollInFlight) return;
		this.pollInFlight = true;
		try {
			const now = this.dependencies.now();
			if (this.lifecycle.status === "WAITING") {
				const focused = (await this.dependencies.activePaneIds()).has(
					this.tmuxIdentity.paneId,
				);
				if (focused) {
					await this.dispatch({ type: "PANE_VISITED", at: now });
				}
			}
			if (this.active && now - this.lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
				await this.publish(now);
			}
		} finally {
			this.pollInFlight = false;
		}
	}

	private publish(at: number): Promise<void> {
		if (!this.active) return Promise.resolve();
		this.lastHeartbeatAt = at;
		const record = createHeartbeatRecord({
			instanceId: this.instanceId,
			processIdentity: this.processIdentity,
			tmuxIdentity: this.tmuxIdentity,
			piSessionId: this.metadata.piSessionId,
			piSessionFile: this.metadata.piSessionFile,
			cwd: this.metadata.cwd,
			sessionName: this.metadata.sessionName,
			lifecycle: this.lifecycle,
			toolName: currentToolName(this.lifecycle),
			heartbeatAt: at,
		});
		this.writeQueue = this.writeQueue
			.then(async () => {
				if (this.active) await this.dependencies.write(this.filePath, record);
			})
			.catch(() => undefined);
		return this.writeQueue;
	}
}

export const createTmuxSessionRuntime = async (
	ctx: ExtensionContext,
	sessionName: string | undefined,
): Promise<TmuxSessionRuntime | undefined> => {
	const identity = await discoverRuntimeIdentity();
	if (!identity) return undefined;
	return new TmuxSessionRuntime(
		identity.processIdentity,
		identity.tmuxIdentity,
		{
			piSessionId: ctx.sessionManager.getSessionId(),
			piSessionFile: ctx.sessionManager.getSessionFile(),
			cwd: ctx.cwd,
			sessionName,
		},
	);
};
