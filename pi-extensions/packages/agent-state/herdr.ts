// Locally maintained; derived from Herdr's Apache-2.0 Pi integration.
import { isAbsolute } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Snapshot } from "./index";
import { type ConnectSocket, createSocketQueue } from "./socket-queue";

type Method = "pane.report_agent" | "pane.report_agent_session";

export type HerdrDeps = {
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
	connect?: ConnectSocket;
};

// Shared across instances in this runtime; monotonic even within one millisecond.
let sequence = Date.now() * 1000;

function sessionRef(ctx: ExtensionContext): Record<string, unknown> {
	try {
		const file = ctx.sessionManager.getSessionFile();
		if (file && isAbsolute(file)) return { agent_session_path: file };
	} catch {
		/* Ephemeral transcript: try the stable session id. */
	}
	try {
		const id = ctx.sessionManager.getSessionId();
		if (id) return { agent_session_id: id };
	} catch {
		/* State reporting still works without session association. */
	}
	return {};
}

/** One session's bounded, ordered, best-effort Herdr socket adapter. No I/O at creation. */
export function createHerdr(deps: HerdrDeps = {}) {
	const env = deps.env ?? process.env;
	const platform = deps.platform ?? process.platform;
	const { HERDR_ENV, HERDR_SOCKET_PATH, HERDR_PANE_ID } = env;
	if (HERDR_ENV !== "1" || !HERDR_SOCKET_PATH || !HERDR_PANE_ID)
		return undefined;
	const endpoint =
		platform === "win32"
			? `\\\\.\\pipe\\${HERDR_SOCKET_PATH}`
			: HERDR_SOCKET_PATH;
	const paneId = HERDR_PANE_ID;
	const queue = createSocketQueue<Method>({
		endpoint,
		connect: deps.connect,
		timeoutMs: 500,
		retryTimeoutMs: 1500,
	});

	function report(method: Method, params: Record<string, unknown>) {
		sequence = Math.max(sequence + 1, Date.now() * 1000);
		const request = {
			id: `herdr:pi:${sequence}`,
			method,
			params: {
				...params,
				pane_id: paneId,
				source: "herdr:pi",
				agent: "pi",
				seq: sequence,
			},
		};
		queue.enqueue(method, `${JSON.stringify(request)}\n`);
	}

	return {
		associate(ctx: ExtensionContext, reason?: string) {
			const ref = sessionRef(ctx);
			if (Object.keys(ref).length)
				report("pane.report_agent_session", {
					...ref,
					...(reason ? { session_start_source: reason } : {}),
				});
		},
		update(snapshot: Snapshot, ctx: ExtensionContext) {
			report("pane.report_agent", {
				...sessionRef(ctx),
				state: snapshot.state,
				...(snapshot.state === "blocked"
					? { message: "Waiting for input or attention" }
					: {}),
			});
		},
		close() {
			queue.close();
		},
	};
}
