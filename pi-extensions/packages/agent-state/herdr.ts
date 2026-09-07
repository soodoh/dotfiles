// Locally maintained; derived from Herdr's Apache-2.0 Pi integration.
import { isAbsolute } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Snapshot } from "./state";
import { createReporter } from "./transport";

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

export function createHerdr() {
	const { HERDR_ENV, HERDR_SOCKET_PATH, HERDR_PANE_ID } = process.env;
	if (HERDR_ENV !== "1" || !HERDR_SOCKET_PATH || !HERDR_PANE_ID)
		return undefined;
	const endpoint =
		process.platform === "win32"
			? `\\\\.\\pipe\\${HERDR_SOCKET_PATH}`
			: HERDR_SOCKET_PATH;
	const writer = createReporter(endpoint, HERDR_PANE_ID);
	return {
		associate(ctx: ExtensionContext, reason?: string) {
			const ref = sessionRef(ctx);
			if (Object.keys(ref).length)
				writer.report("pane.report_agent_session", {
					...ref,
					...(reason ? { session_start_source: reason } : {}),
				});
		},
		update(snapshot: Snapshot, ctx: ExtensionContext) {
			writer.report("pane.report_agent", {
				...sessionRef(ctx),
				state: snapshot.state,
				...(snapshot.state === "blocked"
					? { message: "Waiting for input or attention" }
					: {}),
			});
		},
		close: writer.close,
	};
}
