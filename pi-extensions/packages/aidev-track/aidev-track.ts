import { spawn as nodeSpawn } from "node:child_process";
import type {
	AgentSettledEvent,
	AgentStartEvent,
	BeforeAgentStartEvent,
	ExtensionContext,
	SessionShutdownEvent,
	ToolCallEvent,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";

/**
 * Agent identifier reported to aidev-track. The upstream CLI only recognizes
 * claude-code / copilot / gemini-cli, so "pi" is recorded with an "unknown"
 * tool label — attribution still counts fully as AI, it just isn't labeled as
 * a specific tool in the per-tool breakdown.
 */
const AGENT = "pi";
const BINARY = "aidev-track";
const HOOK_INPUT_ARGS = ["--hook-input", "stdin"];
const DEFAULT_TIMEOUT_MS = 5_000;

/** Pi built-in tools that mutate files on disk. Mirrors Claude's Edit|Write matcher. */
const TRACKED_TOOLS = new Set(["edit", "write"]);

type RunStatus = "ok" | "missing" | "timeout" | "error" | "cancelled";

/** Minimal shape of the child process this extension relies on. */
interface SpawnedProcess {
	stdin: {
		on(
			event: "error",
			listener: (error: NodeJS.ErrnoException) => void,
		): unknown;
		write(chunk: string): unknown;
		end(chunk?: string): unknown;
	} | null;
	on(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
	on(event: "close", listener: (code: number | null) => void): unknown;
	kill(signal: "SIGKILL"): unknown;
}

type SpawnFn = (
	command: string,
	args: string[],
	options: { cwd: string; stdio: ["pipe", "ignore", "ignore"] },
) => SpawnedProcess;

interface AidevTrackDeps {
	spawn: SpawnFn;
	timeoutMs: number;
}

const defaultSpawn: SpawnFn = (command, args, options) =>
	nodeSpawn(command, args, options);

const defaultDeps: AidevTrackDeps = {
	spawn: defaultSpawn,
	timeoutMs: DEFAULT_TIMEOUT_MS,
};

/**
 * Invoke an aidev-track subcommand, piping the hook payload as JSON on stdin.
 * Never throws or rejects: a failing or missing binary must never break a turn.
 */
export function runAidevTrack(
	deps: AidevTrackDeps,
	command: string,
	payload: Record<string, unknown>,
	cwd: string,
	signal?: AbortSignal,
): Promise<RunStatus> {
	if (signal?.aborted) return Promise.resolve("cancelled");
	return new Promise((resolve) => {
		let settled = false;
		let terminalStatus: RunStatus | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (status: RunStatus) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", abort);
			resolve(status);
		};
		const abort = () => terminate("cancelled");
		const terminate = (status: RunStatus) => {
			if (settled || terminalStatus) return;
			terminalStatus = status;
			clearTimeout(timer);
			// Hard termination: a hook that ignores SIGTERM must not keep writing
			// attribution state after Pi has proceeded. Wait for close when possible.
			try {
				child.kill("SIGKILL");
			} catch {
				// Still bound the wait if the OS cannot deliver the signal.
			}
			timer = setTimeout(() => finish(status), 250);
			timer.unref();
		};

		let child: SpawnedProcess;
		try {
			child = deps.spawn(BINARY, [command, AGENT, ...HOOK_INPUT_ARGS], {
				cwd,
				stdio: ["pipe", "ignore", "ignore"],
			});
		} catch (error) {
			finish(isMissingBinary(error) ? "missing" : "error");
			return;
		}

		timer = setTimeout(() => terminate("timeout"), deps.timeoutMs);
		timer.unref();
		child.on("error", (error) => {
			finish(isMissingBinary(error) ? "missing" : "error");
		});
		child.on("close", (code) => {
			finish(terminalStatus ?? (code === 0 ? "ok" : "error"));
		});
		// write()/end() failures are normally asynchronous stream events, not
		// exceptions. Keep this listener even after close to absorb late EPIPEs.
		child.stdin?.on("error", () => terminate("error"));
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) {
			abort();
			return;
		}
		try {
			child.stdin?.end(`${JSON.stringify(payload)}\n`);
		} catch {
			terminate("error");
		}
	});
}

function isMissingBinary(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
	);
}

function extractFilePath(
	input: Record<string, unknown>,
): Record<string, unknown> {
	const path = input.path;
	return typeof path === "string" ? { file_path: path } : {};
}

type EventHandler<Event> = (
	event: Event,
	ctx: AidevTrackContext,
) => void | Promise<void>;

type AidevTrackContext = {
	signal?: ExtensionContext["signal"];
	cwd: ExtensionContext["cwd"];
	sessionManager: Pick<ExtensionContext["sessionManager"], "getSessionId">;
};

type AidevTrackAPI = {
	on(
		event: "before_agent_start",
		handler: EventHandler<BeforeAgentStartEvent>,
	): void;
	on(event: "tool_call", handler: EventHandler<ToolCallEvent>): void;
	on(event: "tool_result", handler: EventHandler<ToolResultEvent>): void;
	on(event: "agent_settled", handler: EventHandler<AgentSettledEvent>): void;
	on(event: "agent_start", handler: EventHandler<AgentStartEvent>): void;
	on(
		event: "session_shutdown",
		handler: EventHandler<SessionShutdownEvent>,
	): void;
};

/**
 * Bridges Pi's agent lifecycle to aidev-track so AI-authored code is attributed
 * in git notes, matching how Claude Code / Copilot / Gemini integrate natively:
 *
 *   before_agent_start -> turn-start   (UserPromptSubmit)
 *   tool_call (edit|write) -> checkpoint (PreToolUse, pristine snapshot)
 *   tool_result (edit|write) -> checkpoint (PostToolUse, edited snapshot)
 *   agent_settled -> turn-end          (Stop, reconcile attribution)
 */
export function createAidevTrackExtension(
	deps: AidevTrackDeps = defaultDeps,
): (pi: AidevTrackAPI) => void {
	return (pi) => {
		// One baseline per settled run; automatic continuations reuse it. Commands
		// and subagent completion messages may start a run without before_agent_start.
		const state = { available: true, started: false, closed: false };
		const lifetime = new AbortController();
		let queue = Promise.resolve();
		const enqueue = (work: () => Promise<void>): Promise<void> => {
			queue = queue.then(work, work);
			return queue;
		};

		const track = async (
			command: string,
			ctx: AidevTrackContext,
			payload: Record<string, unknown>,
			useTurnSignal = true,
		): Promise<void> => {
			if (!state.available || state.closed) return;
			const status = await runAidevTrack(
				deps,
				command,
				{
					session_id: ctx.sessionManager.getSessionId(),
					cwd: ctx.cwd,
					...payload,
				},
				ctx.cwd,
				useTurnSignal && ctx.signal
					? AbortSignal.any([lifetime.signal, ctx.signal])
					: lifetime.signal,
			);
			if (status === "missing") state.available = false;
		};
		const ensureStarted = async (ctx: AidevTrackContext, prompt?: string) => {
			if (state.started || state.closed) return;
			state.started = true;
			await track("turn-start", ctx, {
				hook_event_name: "UserPromptSubmit",
				...(prompt === undefined ? {} : { prompt }),
			});
		};

		pi.on("before_agent_start", (event, ctx) =>
			enqueue(() => ensureStarted(ctx, event.prompt)),
		);
		pi.on("agent_start", (_event, ctx) => enqueue(() => ensureStarted(ctx)));

		pi.on("tool_call", async (event, ctx) => {
			if (!TRACKED_TOOLS.has(event.toolName)) return;
			await enqueue(async () => {
				await ensureStarted(ctx);
				await track("checkpoint", ctx, {
					hook_event_name: "PreToolUse",
					tool_name: event.toolName,
					tool_input: extractFilePath(event.input),
				});
			});
		});

		pi.on("tool_result", async (event, ctx) => {
			if (!TRACKED_TOOLS.has(event.toolName)) return;
			await enqueue(() =>
				track("checkpoint", ctx, {
					hook_event_name: "PostToolUse",
					tool_name: event.toolName,
					tool_input: extractFilePath(event.input),
				}),
			);
		});

		pi.on("agent_settled", (_event, ctx) =>
			enqueue(async () => {
				if (!state.started) return;
				await track("turn-end", ctx, { hook_event_name: "Stop" }, false);
				state.started = false;
			}),
		);
		pi.on("session_shutdown", async () => {
			state.closed = true;
			lifetime.abort();
			await queue;
		});
	};
}

export default createAidevTrackExtension();
