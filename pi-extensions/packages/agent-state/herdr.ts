// Locally maintained; derived from Herdr's Apache-2.0 Pi integration.
import net from "node:net";
import { isAbsolute } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Snapshot } from "./index";

type Method = "pane.report_agent" | "pane.report_agent_session";
type Request = {
	id: string;
	method: Method;
	params: Record<string, unknown>;
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
export function createHerdr() {
	const { HERDR_ENV, HERDR_SOCKET_PATH, HERDR_PANE_ID } = process.env;
	if (HERDR_ENV !== "1" || !HERDR_SOCKET_PATH || !HERDR_PANE_ID)
		return undefined;
	const endpoint =
		process.platform === "win32"
			? `\\\\.\\pipe\\${HERDR_SOCKET_PATH}`
			: HERDR_SOCKET_PATH;
	const paneId = HERDR_PANE_ID;
	const pending = new Map<Method, Request>();
	let closed = false;
	let draining = false;
	let cancelAttempt: (() => void) | undefined;

	function attempt(request: Request, timeoutMs: number): Promise<boolean> {
		return new Promise((resolve) => {
			let finished = false;
			let socket: net.Socket | undefined;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const finish = (delivered: boolean) => {
				if (finished) return;
				finished = true;
				clearTimeout(timer);
				cancelAttempt = undefined;
				socket?.destroy();
				resolve(delivered);
			};
			cancelAttempt = () => finish(false);
			try {
				socket = net.createConnection(endpoint);
				socket.on("error", () => finish(false));
				socket.on("end", () => finish(false));
				socket.on("close", () => finish(false));
				socket.on("connect", () => {
					if (!finished) socket?.write(`${JSON.stringify(request)}\n`);
				});
				socket.on("data", () => finish(true));
				timer = setTimeout(() => finish(false), timeoutMs);
				timer.unref();
			} catch {
				finish(false);
			}
		});
	}

	async function drain() {
		if (draining || closed) return;
		draining = true;
		try {
			while (!closed && pending.size > 0) {
				const request = pending.values().next().value;
				if (!request) break;
				pending.delete(request.method);
				const delivered = await attempt(request, 500);
				// Never retry an obsolete report after a newer report was queued.
				if (!delivered && !closed && !pending.has(request.method)) {
					await attempt(request, 1500);
				}
			}
		} finally {
			draining = false;
		}
	}

	function report(method: Method, params: Record<string, unknown>) {
		if (closed) return;
		sequence = Math.max(sequence + 1, Date.now() * 1000);
		const request: Request = {
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
		// At most one pending report per method; reinsertion preserves sequence order.
		pending.delete(method);
		pending.set(method, request);
		void drain();
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
			closed = true;
			pending.clear();
			cancelAttempt?.();
		},
	};
}
