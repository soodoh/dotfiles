// Locally maintained; derived from Herdr's Apache-2.0 Pi integration.
// See README.md for provenance, the sibling event contract, and lifecycle guarantees.
import { isAbsolute } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createReporter } from "./transport";

type State = "working" | "blocked" | "idle";

function sessionRef(ctx: ExtensionContext): Record<string, unknown> {
	try {
		const file = ctx.sessionManager.getSessionFile();
		if (file && isAbsolute(file)) return { agent_session_path: file };
	} catch {
		// Ephemeral/unavailable transcript: try the stable session id instead.
	}
	try {
		const id = ctx.sessionManager.getSessionId();
		if (id) return { agent_session_id: id };
	} catch {
		// State reporting still works without session association.
	}
	return {};
}

/** The only Pi lifecycle writer for this Herdr pane. */
export default function herdrAgentState(pi: ExtensionAPI) {
	const { HERDR_ENV, HERDR_SOCKET_PATH, HERDR_PANE_ID, PI_SUBAGENT_CHILD } =
		process.env;
	if (
		HERDR_ENV !== "1" ||
		!HERDR_SOCKET_PATH ||
		!HERDR_PANE_ID ||
		PI_SUBAGENT_CHILD === "1"
	)
		return;
	const endpoint =
		process.platform === "win32"
			? `\\\\.\\pipe\\${HERDR_SOCKET_PATH}`
			: HERDR_SOCKET_PATH;
	let context: ExtensionContext | undefined;
	let reporter: ReturnType<typeof createReporter> | undefined;
	let closed = false;
	let ready = false;
	let parentActive = false;
	let nativePrompt = false;
	let busyCount = 0;
	let blockedCount = 0;
	let lastState: State | undefined;
	let scheduled: ReturnType<typeof setImmediate> | undefined;

	function desiredState(): State {
		if (nativePrompt || blockedCount > 0) return "blocked";
		// Re-read live core state: completion delivery can queue a continuation before
		// agent_start fires. Background producers must hold busy until that delivery.
		if (
			parentActive ||
			busyCount > 0 ||
			context?.isIdle() === false ||
			context?.hasPendingMessages()
		)
			return "working";
		return "idle";
	}

	function publish() {
		scheduled = undefined;
		if (closed || !context || !reporter) return;
		const state = desiredState();
		// resources_discover follows ALL session_start handlers, including producers
		// restoring runs asynchronously. Never announce idle halfway through restore.
		// Actual prompts and work may be reported immediately during startup.
		if (state === "idle" && !ready) return;
		if (state === lastState) return;
		lastState = state;
		reporter.report("pane.report_agent", {
			...sessionRef(context),
			state,
			// Never send prompt titles, task text, or untrusted sibling labels.
			...(state === "blocked"
				? { message: "Waiting for input or attention" }
				: {}),
		});
	}

	function schedule() {
		if (closed || !context || scheduled) return;
		// Coalesce synchronous release/acquire label updates and their microtasks.
		// This is an event-loop boundary, not a guessed notification cooldown.
		scheduled = setImmediate(publish);
	}

	function contribution(data: unknown): boolean | undefined {
		if (!data || typeof data !== "object" || !("active" in data))
			return undefined;
		return typeof data.active === "boolean" ? data.active : undefined;
	}

	// Listen before session_start: sibling restoration may run before this handler.
	// Keep native prompts independent from counted external blocker contributions.
	const unsubscribes = [
		pi.events.on("herdr:busy", (data) => {
			if (closed) return;
			const active = contribution(data);
			if (active === undefined) return;
			busyCount = Math.max(0, busyCount + (active ? 1 : -1));
			schedule();
		}),
		pi.events.on("herdr:blocked", (data) => {
			if (closed) return;
			const active = contribution(data);
			if (active === undefined) return;
			// Legacy events have no source/reason. Do not guess human-vs-supervisor
			// intent from their label or accidentally drop real blockers.
			blockedCount = Math.max(0, blockedCount + (active ? 1 : -1));
			schedule();
		}),
	];

	function reportSession(ctx: ExtensionContext, reason?: string) {
		const ref = sessionRef(ctx);
		if (Object.keys(ref).length === 0) return;
		reporter?.report("pane.report_agent_session", {
			...ref,
			...(reason ? { session_start_source: reason } : {}),
		});
	}

	pi.on("session_start", (event, ctx) => {
		// RPC also has hasUI=true. Only the owning TUI may write this pane's state.
		if (closed || ctx.mode !== "tui") return;
		context = ctx;
		reporter = createReporter(endpoint, HERDR_PANE_ID);
		parentActive = !ctx.isIdle();
		reportSession(ctx, event.reason);
		schedule();
	});
	pi.on("resources_discover", () => {
		ready = true;
		schedule();
	});
	pi.on("agent_start", (_event, ctx) => {
		if (closed || !context || ctx.mode !== "tui") return;
		context = ctx;
		parentActive = true;
		reportSession(ctx);
		schedule();
	});
	pi.on("agent_settled", (_event, ctx) => {
		if (closed || !context || ctx.mode !== "tui" || !ctx.isIdle()) return;
		parentActive = false;
		schedule();
	});
	pi.on("ui_prompt_start", (_event, ctx) => {
		if (closed || !context || ctx.mode !== "tui") return;
		// Pi coalesces overlapping dialogs into one native waiting span.
		nativePrompt = true;
		schedule();
	});
	pi.on("ui_prompt_end", (_event, ctx) => {
		if (closed || !context || ctx.mode !== "tui") return;
		nativePrompt = false;
		schedule();
	});
	pi.on("session_shutdown", () => {
		// Pi creates a fresh extension instance after reload/new/resume/fork.
		// Do not turn teardown releases into a false completion notification.
		closed = true;
		context = undefined;
		if (scheduled) clearImmediate(scheduled);
		scheduled = undefined;
		for (const unsubscribe of unsubscribes) unsubscribe();
		reporter?.close();
	});
}
