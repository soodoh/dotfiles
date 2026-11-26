// Locally authored adapter for moshi-hook 0.3.19's socket protocol, not a generated hook.
import { execFileSync } from "node:child_process";
import net from "node:net";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Snapshot } from "./index";

function socketPath() {
	if (process.env.MOSHI_SOCKET_PATH) return process.env.MOSHI_SOCKET_PATH;
	if (process.platform === "darwin")
		return join(
			homedir(),
			"Library",
			"Application Support",
			"Moshi",
			"moshi-hook.sock",
		);
	if (process.platform === "win32") return "\\\\.\\pipe\\moshi-hook";
	return join(process.env.XDG_RUNTIME_DIR || "/tmp", "moshi-hook.sock");
}

function terminalContext(): Record<string, string> {
	const env = process.env;
	if (env.TMUX && env.TMUX_PANE) {
		const tmuxSocket = env.TMUX.split(",")[0] ?? "";
		try {
			const value = execFileSync(
				"tmux",
				[
					"-S",
					tmuxSocket,
					"display-message",
					"-p",
					"-t",
					env.TMUX_PANE,
					"#{session_name}\t#{window_index}",
				],
				{ encoding: "utf8", timeout: 200, stdio: ["ignore", "pipe", "ignore"] },
			).trim();
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
export function createMoshi() {
	const endpoint = socketPath();
	const terminal = terminalContext();
	let closed = false;
	let draining = false;
	const pending = new Map<"state" | "resolution", string>();
	let cancel: (() => void) | undefined;

	function attempt(line: string): Promise<void> {
		return new Promise((resolve) => {
			let socket: net.Socket | undefined;
			let timer: ReturnType<typeof setTimeout> | undefined;
			let finished = false;
			function finish() {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				socket?.destroy();
				cancel = undefined;
				resolve();
			}
			cancel = finish;
			try {
				socket = net.createConnection(endpoint);
				socket.on("error", finish);
				socket.on("close", finish);
				socket.on("end", finish);
				socket.on("data", finish);
				socket.on("connect", () => {
					if (finished) return;
					socket?.write(line);
					socket?.end();
				});
				timer = setTimeout(finish, 1000);
				timer.unref();
			} catch {
				finish();
			}
		});
	}

	async function drain() {
		if (closed || draining) return;
		draining = true;
		try {
			while (!closed && pending.size > 0) {
				const next = pending.entries().next().value;
				if (!next) break;
				pending.delete(next[0]);
				await attempt(next[1]);
			}
		} finally {
			draining = false;
		}
	}

	function send(payload: Record<string, unknown>, resolution = false) {
		if (closed) return;
		// A resolved prompt supersedes any queued waiting state. Retain the
		// resolution before subsequent completion so Moshi clears its input marker.
		if (resolution) pending.delete("state");
		const key = resolution ? "resolution" : "state";
		pending.delete(key);
		pending.set(key, `${JSON.stringify(payload)}\n`);
		void drain();
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
			if (closed) return;
			closed = true;
			pending.clear();
			cancel?.();
			// Only a real session quit closes Moshi's session. Teardown never completes a task.
			const base = ctx ? envelope(ctx, "SessionEnd") : undefined;
			if (base) {
				await attempt(
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
