import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHerdr } from "./herdr";
import { createMoshi } from "./moshi";
import { observeState } from "./state";

/** Root TUI owner: one lifecycle calculation, one writer per destination. */
export default function agentState(pi: ExtensionAPI) {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;
	let closed = false;
	let herdr: ReturnType<typeof createHerdr>;
	let moshi: ReturnType<typeof createMoshi> | undefined;
	pi.on("session_start", (event, ctx) => {
		if (closed || ctx.mode !== "tui") return;
		herdr = createHerdr();
		moshi = createMoshi();
		herdr?.associate(ctx, event.reason);
		moshi.associate(ctx);
	});
	pi.on("agent_start", (_event, ctx) => {
		if (!closed && ctx.mode === "tui") herdr?.associate(ctx);
	});
	observeState(pi, (snapshot, ctx) => {
		herdr?.update(snapshot, ctx);
		moshi?.update(snapshot, ctx);
	});
	pi.on("session_shutdown", async (event, ctx) => {
		closed = true;
		herdr?.close();
		await moshi?.close(event.reason === "quit" ? ctx : undefined);
	});
}
