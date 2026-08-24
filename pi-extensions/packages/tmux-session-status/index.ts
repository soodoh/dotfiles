import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createTmuxSessionRuntime, type TmuxSessionRuntime } from "./runtime";

declare global {
	var __piTmuxSessionStatusRuntime: TmuxSessionRuntime | undefined;
}

export default function tmuxSessionStatus(pi: ExtensionAPI): void {
	let ownedRuntime: TmuxSessionRuntime | undefined;

	const runtime = (): TmuxSessionRuntime | undefined =>
		globalThis.__piTmuxSessionStatusRuntime === ownedRuntime
			? ownedRuntime
			: undefined;

	const startAgent = async (): Promise<void> => {
		await runtime()?.dispatch({ type: "AGENT_STARTED", at: Date.now() });
	};

	pi.on("session_start", async (_event, ctx) => {
		await globalThis.__piTmuxSessionStatusRuntime?.shutdown();
		globalThis.__piTmuxSessionStatusRuntime = undefined;
		ownedRuntime = await createTmuxSessionRuntime(ctx, pi.getSessionName());
		if (!ownedRuntime) return;
		globalThis.__piTmuxSessionStatusRuntime = ownedRuntime;
		await ownedRuntime.start();
	});

	pi.on("resources_discover", async () => {
		await runtime()?.dispatch({ type: "RESOURCES_READY", at: Date.now() });
	});

	pi.on("before_agent_start", startAgent);
	pi.on("agent_start", startAgent);

	pi.on("tool_execution_start", async (event) => {
		await runtime()?.dispatch({
			type: "TOOL_STARTED",
			id: event.toolCallId,
			name: event.toolName,
			at: Date.now(),
		});
	});

	pi.on("tool_execution_end", async (event) => {
		await runtime()?.dispatch({
			type: "TOOL_FINISHED",
			id: event.toolCallId,
			at: Date.now(),
		});
	});

	pi.on("message_end", async (event) => {
		if (event.message.role !== "assistant") return;
		await runtime()?.dispatch({
			type: "ASSISTANT_FINISHED",
			stopReason: event.message.stopReason,
			at: Date.now(),
		});
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!ctx.isIdle()) return;
		await runtime()?.settle();
	});

	pi.on("session_info_changed", async (event) => {
		await runtime()?.updateSessionName(event.name);
	});

	pi.on("session_shutdown", async () => {
		const activeRuntime = runtime();
		if (!activeRuntime) return;
		globalThis.__piTmuxSessionStatusRuntime = undefined;
		ownedRuntime = undefined;
		await activeRuntime.shutdown();
	});
}

export {
	currentToolName,
	initialLifecycleState,
	reduceLifecycle,
} from "./reducer";
export {
	discoverRuntimeIdentity,
	normalizeTty,
	parseProcessIdentity,
	parseTmuxIdentity,
	queryFocusedPaneIds,
	TmuxSessionRuntime,
} from "./runtime";
export {
	createHeartbeatRecord,
	getStateDirectory,
	heartbeatFileName,
	removeOwnedHeartbeat,
	sanitizeStateString,
	writeHeartbeatAtomic,
} from "./store";
