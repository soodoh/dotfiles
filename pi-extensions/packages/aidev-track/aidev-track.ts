import { spawn as nodeSpawn } from "node:child_process";
import type {
	AgentSettledEvent,
	BeforeAgentStartEvent,
	ExtensionContext,
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

type RunStatus = "ok" | "missing" | "timeout" | "error";

/** Minimal shape of the child process this extension relies on. */
interface SpawnedProcess {
	stdin: {
		write(chunk: string): unknown;
		end(): unknown;
	} | null;
	on(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
	on(event: "close", listener: (code: number | null) => void): unknown;
	kill(): unknown;
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
): Promise<RunStatus> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (status: RunStatus) => {
			if (settled) return;
			settled = true;
			resolve(status);
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

		const timer = setTimeout(() => {
			try {
				child.kill();
			} catch {
				// ignore
			}
			finish("timeout");
		}, deps.timeoutMs);
		if (typeof timer.unref === "function") timer.unref();

		child.on("error", (error) => {
			clearTimeout(timer);
			finish(isMissingBinary(error) ? "missing" : "error");
		});
		child.on("close", () => {
			clearTimeout(timer);
			finish("ok");
		});

		try {
			child.stdin?.write(`${JSON.stringify(payload)}\n`);
			child.stdin?.end();
		} catch {
			// stdin may already be closed if the process errored immediately.
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
		// Cached availability: once we learn the binary is missing, stop spawning.
		const state = { available: true };

		const track = async (
			command: string,
			ctx: AidevTrackContext,
			payload: Record<string, unknown>,
		): Promise<void> => {
			if (!state.available) return;
			const status = await runAidevTrack(
				deps,
				command,
				{
					session_id: ctx.sessionManager.getSessionId(),
					cwd: ctx.cwd,
					...payload,
				},
				ctx.cwd,
			);
			if (status === "missing") state.available = false;
		};

		pi.on("before_agent_start", async (event, ctx) => {
			await track("turn-start", ctx, {
				hook_event_name: "UserPromptSubmit",
				prompt: event.prompt,
			});
		});

		pi.on("tool_call", async (event, ctx) => {
			if (!TRACKED_TOOLS.has(event.toolName)) return;
			await track("checkpoint", ctx, {
				hook_event_name: "PreToolUse",
				tool_name: event.toolName,
				tool_input: extractFilePath(event.input),
			});
		});

		pi.on("tool_result", async (event, ctx) => {
			if (!TRACKED_TOOLS.has(event.toolName)) return;
			await track("checkpoint", ctx, {
				hook_event_name: "PostToolUse",
				tool_name: event.toolName,
				tool_input: extractFilePath(event.input),
			});
		});

		pi.on("agent_settled", async (_event, ctx) => {
			await track("turn-end", ctx, { hook_event_name: "Stop" });
		});
	};
}

export default createAidevTrackExtension();
