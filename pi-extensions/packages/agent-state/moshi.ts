// Locally authored adapter for moshi-hook 0.3.19's socket protocol, not a generated hook.
import { execFileSync } from "node:child_process";
import { homedir as osHomedir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Snapshot } from "./index";
import { type ConnectSocket, createSocketQueue } from "./socket-queue";

export type MoshiDeps = {
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	homedir?: () => string;
	connect?: ConnectSocket;
	execTmux?: (args: string[]) => string;
};

function defaultExecTmux(args: string[]): string {
	return execFileSync("tmux", args, {
		encoding: "utf8",
		timeout: 200,
		stdio: ["ignore", "pipe", "ignore"],
	});
}

function socketPath(
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
	getHome: () => string,
) {
	if (env.MOSHI_SOCKET_PATH) return env.MOSHI_SOCKET_PATH;
	if (platform === "darwin")
		return join(
			getHome(),
			"Library",
			"Application Support",
			"Moshi",
			"moshi-hook.sock",
		);
	if (platform === "win32") return "\\\\.\\pipe\\moshi-hook";
	return join(env.XDG_RUNTIME_DIR || "/tmp", "moshi-hook.sock");
}

function terminalContext(
	env: NodeJS.ProcessEnv,
	execTmux: (args: string[]) => string,
): Record<string, string> {
	if (env.TMUX && env.TMUX_PANE) {
		const tmuxSocket = env.TMUX.split(",")[0] ?? "";
		try {
			const value = execTmux([
				"-S",
				tmuxSocket,
				"display-message",
				"-p",
				"-t",
				env.TMUX_PANE,
				"#{session_name}\t#{window_index}",
			]).trim();
			const [tmuxSession = "", tmuxWindow = ""] = value.split("\t");
			return {
				terminalKind: "tmux",
				tmuxSocket,
				tmuxPane: env.TMUX_PANE,
				tmuxSession,
				tmuxWindow,
			};
		} catch {
			/* No verified tmux label: retain available Herdr/Zellij identity below. */
		}
	}
	if (env.HERDR_ENV === "1" && env.HERDR_PANE_ID)
		return {
			terminalKind: "herdr",
			herdrSession: env.HERDR_SESSION ?? "",
			herdrPane: env.HERDR_PANE_ID,
			herdrWorkspaceId: env.HERDR_WORKSPACE_ID ?? "",
			herdrTabId: env.HERDR_TAB_ID ?? "",
		};
	if (env.ZELLIJ_SESSION_NAME)
		return {
			terminalKind: "zellij",
			zellijSession: env.ZELLIJ_SESSION_NAME,
			zellijPane: env.ZELLIJ_PANE_ID ?? "",
		};
	return { terminalKind: "" };
}

/** JSON-line/half-close/ack Moshi adapter. Latest state plus a resolution barrier; no retries. */
export function createMoshi(deps: MoshiDeps = {}) {
	const env = deps.env ?? process.env;
	const platform = deps.platform ?? process.platform;
	const getHome = deps.homedir ?? osHomedir;
	const execTmux = deps.execTmux ?? defaultExecTmux;
	const endpoint = socketPath(env, platform, getHome);
	const terminal = terminalContext(env, execTmux);
	const queue = createSocketQueue<"state" | "resolution">({
		endpoint,
		connect: deps.connect,
		timeoutMs: 1000,
		halfClose: true,
	});

	function send(payload: Record<string, unknown>, resolution = false) {
		// A resolved prompt supersedes any queued waiting state. Retain the
		// resolution before subsequent completion so Moshi clears its input marker.
		queue.enqueue(
			resolution ? "resolution" : "state",
			`${JSON.stringify(payload)}\n`,
			resolution ? ["state"] : undefined,
		);
	}

	function envelope(
		ctx: ExtensionContext,
		eventName: string,
	): Record<string, unknown> | undefined {
		try {
			const sessionId = ctx.sessionManager.getSessionId();
			if (!sessionId) return undefined;
			let transcriptPath: string | undefined;
			try {
				transcriptPath = ctx.sessionManager.getSessionFile();
			} catch {
				/* Ephemeral session. */
			}
			return {
				type: "session.update",
				source: "pi",
				sessionId,
				eventName,
				requestedAt: new Date().toISOString(),
				cwd: ctx.cwd,
				projectName:
					terminal.tmuxSession ||
					terminal.herdrSession ||
					terminal.zellijSession ||
					basename(ctx.cwd),
				...terminal,
				modelName: ctx.model?.name ?? ctx.model?.id,
				...(transcriptPath ? { transcriptPath } : {}),
			};
		} catch {
			return undefined;
		}
	}

	return {
		associate(ctx: ExtensionContext) {
			const base = envelope(ctx, "SessionStart");
			if (base) send(base); // Silent identity carrier, not a session-start notification.
		},
		update(snapshot: Snapshot, ctx: ExtensionContext) {
			const base = envelope(ctx, "AgentState");
			if (!base) return;
			if (snapshot.previous === "blocked" && snapshot.state !== "blocked") {
				send(
					{
						...base,
						eventName: "PermissionResolved",
						category: "session_started",
						title: snapshot.state === "idle" ? "Pi is ready" : "Pi resumed",
						...(snapshot.state === "idle" ? { phase: "idle" } : {}),
					},
					true,
				);
				if (snapshot.state === "working" || !snapshot.outcome) return;
			}
			if (snapshot.state === "blocked") {
				// The documented category covers both permission and user answers.
				// No actionId/toolName: never manufacture an actionable approval target.
				send({
					...base,
					eventName: "InputRequest",
					category: "approval_required",
					phase: "waitingForApproval",
					title: "Pi needs input",
					subtitle: "Answer in terminal",
				});
			} else if (snapshot.state === "working") {
				send({
					...base,
					eventName: "AgentStart",
					category: "session_started",
					title: "Pi is working",
				});
			} else if (snapshot.outcome === "stop") {
				send({
					...base,
					eventName: "AgentEnd",
					category: "task_complete",
					title: "Pi task finished",
				});
			} else if (snapshot.outcome) {
				send({
					...base,
					eventName: "AgentEnd",
					category: "error",
					title:
						snapshot.outcome === "aborted"
							? "Pi task stopped"
							: "Pi task ended with an error",
				});
			} else {
				send({ ...base, phase: "idle" }); // Startup/dialog closure is not task completion.
			}
		},
		async close(ctx?: ExtensionContext) {
			if (!queue.close()) return;
			// Only a real session quit closes Moshi's session. Teardown never completes a task.
			const base = ctx ? envelope(ctx, "SessionEnd") : undefined;
			if (base) {
				await queue.sendImmediate(
					`${JSON.stringify({
						...base,
						type: "session.closed",
						category: "session_ended",
						title: "Pi session ended",
					})}\n`,
				);
			}
		},
	};
}
