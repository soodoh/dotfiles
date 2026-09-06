import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Supply prompt state to the official reporter; never report to Herdr directly. */
export default function herdrUIPrompts(pi: ExtensionAPI) {
	if (
		process.env.HERDR_ENV !== "1" ||
		!process.env.HERDR_SOCKET_PATH ||
		!process.env.HERDR_PANE_ID ||
		process.env.PI_SUBAGENT_CHILD === "1"
	)
		return;

	let active = false;
	let held = false;
	const release = () => {
		if (!held) return;
		held = false;
		pi.events.emit("herdr:blocked", { active: false });
	};

	pi.on("session_start", (_event, ctx) => {
		release();
		active = ctx.mode === "tui";
	});
	pi.on("ui_prompt_start", (_event, ctx) => {
		if (!active || ctx.mode !== "tui" || held) return;
		// Pi coalesces overlapping dialogs. Own one contribution, independently
		// of subagent attention. Do not expose potentially sensitive prompt titles.
		held = true;
		pi.events.emit("herdr:blocked", {
			active: true,
			label: "Waiting for input",
		});
	});
	pi.on("ui_prompt_end", release);
	pi.on("session_shutdown", () => {
		active = false;
		release();
	});
}
