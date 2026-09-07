// Locally authored adapter for moshi-hook 0.3.19's socket protocol, not a generated hook.
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createMoshiWriter } from "./moshi-transport";
import type { Snapshot } from "./state";

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

export function createMoshi() {
	const writer = createMoshiWriter(socketPath());
	const terminal = terminalContext();
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
			if (base) writer.send(base); // Silent identity carrier, not a session-start notification.
		},
		update(snapshot: Snapshot, ctx: ExtensionContext) {
			const base = envelope(ctx, "AgentState");
			if (!base) return;
			if (snapshot.previous === "blocked" && snapshot.state !== "blocked") {
				writer.send(
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
				writer.send({
					...base,
					eventName: "InputRequest",
					category: "approval_required",
					phase: "waitingForApproval",
					title: "Pi needs input",
					subtitle: "Answer in terminal",
				});
			} else if (snapshot.state === "working") {
				writer.send({
					...base,
					eventName: "AgentStart",
					category: "session_started",
					title: "Pi is working",
				});
			} else if (snapshot.outcome === "stop") {
				writer.send({
					...base,
					eventName: "AgentEnd",
					category: "task_complete",
					title: "Pi task finished",
				});
			} else if (snapshot.outcome) {
				writer.send({
					...base,
					eventName: "AgentEnd",
					category: "error",
					title:
						snapshot.outcome === "aborted"
							? "Pi task stopped"
							: "Pi task ended with an error",
				});
			} else {
				writer.send({ ...base, phase: "idle" }); // Startup/dialog closure is not task completion.
			}
		},
		close(ctx?: ExtensionContext) {
			const base = ctx ? envelope(ctx, "SessionEnd") : undefined;
			return writer.close(
				base
					? {
							...base,
							type: "session.closed",
							category: "session_ended",
							title: "Pi session ended",
						}
					: undefined,
			);
		},
	};
}
