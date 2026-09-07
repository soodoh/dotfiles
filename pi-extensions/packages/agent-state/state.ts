import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createLiveness } from "./liveness";

export type Snapshot = {
	state: "working" | "blocked" | "idle";
	previous?: "working" | "blocked" | "idle";
	/** Only present when an observed task settles, never for initial idle. */
	outcome?: "stop" | "aborted" | "error" | "length";
};

/** One lifecycle calculation shared by both destinations. No transport or prompt text. */
export function observeState(
	pi: ExtensionAPI,
	publish: (snapshot: Snapshot, ctx: ExtensionContext) => void,
) {
	const liveness = createLiveness();
	let context: ExtensionContext | undefined;
	let closed = false;
	let ready = false;
	let parentActive = false;
	let nativePrompt = false;
	let busyCount = 0;
	let hadWork = false;
	let outcome: Snapshot["outcome"];
	let lastState: Snapshot["state"] | undefined;
	let scheduled: ReturnType<typeof setImmediate> | undefined;
	let poll: ReturnType<typeof setTimeout> | undefined;
	let warned = false;

	function activity(): boolean | undefined {
		try {
			return liveness.read(context?.sessionManager.getSessionId());
		} catch {
			// An unavailable producer/identity is not proof of completion.
		}
		return undefined;
	}
	function flush() {
		scheduled = undefined;
		if (closed || !context) return;
		const background = ready ? activity() : undefined;
		if (ready && background === undefined && !warned) {
			warned = true;
			context.ui.notify(
				"Subagent liveness unavailable; completion notifications paused. Check registry ownership and pi-subagents compatibility (mise run validate:agents), then /reload.",
				"warning",
			);
		}
		const working =
			parentActive ||
			busyCount > 0 ||
			background !== false ||
			!context.isIdle() ||
			context.hasPendingMessages();
		const state = nativePrompt ? "blocked" : working ? "working" : "idle";
		// The v1 provider has no change subscription. Read in memory even at idle
		// so timers/scheduled work need not emit optional subagent event hints.
		// This reconciles authoritative evidence; it is not a completion cooldown.
		clearTimeout(poll);
		if (ready) {
			poll = setTimeout(
				schedule,
				background !== false || context.hasPendingMessages() ? 250 : 1000,
			);
			poll.unref();
		}
		if (!ready && state !== "blocked" && !parentActive && busyCount === 0)
			return;
		if (background === true || parentActive || busyCount > 0) hadWork = true;
		if (state === lastState && !(state === "idle" && hadWork && outcome))
			return;
		const previous = lastState;
		lastState = state;
		publish(
			{
				state,
				previous,
				...(state === "idle" && hadWork && outcome ? { outcome } : {}),
			},
			context,
		);
		if (state === "idle") {
			hadWork = false;
			outcome = undefined;
		}
	}
	function schedule() {
		if (closed || !context || scheduled) return;
		// Coalesce synchronous release/acquire and completion handoff microtasks.
		// This is an event-loop boundary, not a notification cooldown.
		scheduled = setImmediate(flush);
	}
	function contribution(value: unknown): boolean | undefined {
		if (!value || typeof value !== "object" || !("active" in value))
			return undefined;
		return typeof value.active === "boolean" ? value.active : undefined;
	}
	const unsubscribes = [
		pi.events.on("herdr:busy", (value) => {
			const active = contribution(value);
			if (closed || active === undefined) return;
			busyCount = Math.max(0, busyCount + (active ? 1 : -1));
			schedule();
		}),
		...[
			"subagent:async-started",
			"subagent:async-complete",
			"subagent:foreground-complete",
			"subagent:process-terminal",
		].map((name) => pi.events.on(name, schedule)),
	];
	pi.on("session_start", (_event, ctx) => {
		if (closed) return;
		if (ctx.mode !== "tui") {
			liveness.close();
			return;
		}
		context = ctx;
		parentActive = !ctx.isIdle();
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
		hadWork = true;
		outcome = undefined;
		schedule();
	});
	pi.on("agent_end", (event) => {
		if (closed || !context) return;
		const last = [...event.messages]
			.reverse()
			.find((message) => message.role === "assistant");
		const reason = last?.stopReason;
		outcome =
			reason === "stop" ||
			reason === "aborted" ||
			reason === "error" ||
			reason === "length"
				? reason
				: undefined;
	});
	pi.on("agent_settled", (_event, ctx) => {
		if (closed || !context || ctx.mode !== "tui" || !ctx.isIdle()) return;
		context = ctx;
		parentActive = false;
		schedule();
	});
	pi.on("ui_prompt_start", (_event, ctx) => {
		if (closed || !context || ctx.mode !== "tui") return;
		nativePrompt = true;
		schedule();
	});
	pi.on("ui_prompt_end", (_event, ctx) => {
		if (closed || !context || ctx.mode !== "tui") return;
		nativePrompt = false;
		schedule();
	});
	pi.on("session_shutdown", () => {
		closed = true;
		context = undefined;
		if (scheduled) clearImmediate(scheduled);
		clearTimeout(poll);
		for (const unsubscribe of unsubscribes) unsubscribe();
		liveness.close();
	});
}
