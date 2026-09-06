import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import herdrUIPrompts from "./index";

type Handler = (event: unknown, ctx: ExtensionContext) => void;
function fixture() {
	const handlers = new Map<string, Handler>();
	const emit = vi.fn();
	herdrUIPrompts({
		on: (name: string, handler: Handler) => handlers.set(name, handler),
		events: { emit },
	} as unknown as ExtensionAPI);
	return {
		emit,
		dispatch(name: string, mode: ExtensionContext["mode"] = "tui") {
			handlers.get(name)?.({ title: "sensitive prompt title" }, {
				mode,
				hasUI: mode === "tui" || mode === "rpc",
			} as ExtensionContext);
		},
	};
}

beforeEach(() => {
	vi.stubEnv("HERDR_ENV", "1");
	vi.stubEnv("HERDR_SOCKET_PATH", "/unused.sock");
	vi.stubEnv("HERDR_PANE_ID", "w1:p1");
	vi.stubEnv("PI_SUBAGENT_CHILD", "0");
});
afterEach(() => vi.unstubAllEnvs());

test.each([
	["HERDR_ENV", "0"],
	["HERDR_SOCKET_PATH", ""],
	["HERDR_PANE_ID", ""],
	["PI_SUBAGENT_CHILD", "1"],
])("does not publish with %s=%s", (name, value) => {
	vi.stubEnv(name, value);
	const f = fixture();
	for (const event of [
		"session_start",
		"ui_prompt_start",
		"ui_prompt_end",
		"session_shutdown",
	])
		f.dispatch(event);
	expect(f.emit).not.toHaveBeenCalled();
});

test.each(["rpc", "json", "print"] as const)(
	"does not publish in %s mode",
	(mode) => {
		const f = fixture();
		f.dispatch("session_start", mode);
		f.dispatch("ui_prompt_start", mode);
		f.dispatch("ui_prompt_end", mode);
		f.dispatch("session_shutdown", mode);
		expect(f.emit).not.toHaveBeenCalled();
	},
);

test("owns one balanced contribution without leaking the prompt title", () => {
	const f = fixture();
	f.dispatch("ui_prompt_start"); // Startup not complete.
	f.dispatch("ui_prompt_end"); // Must not clear another producer's contribution.
	expect(f.emit).not.toHaveBeenCalled();
	f.dispatch("session_start");
	f.dispatch("ui_prompt_start", "rpc"); // Recheck mode at prompt time.
	expect(f.emit).not.toHaveBeenCalled();
	f.dispatch("ui_prompt_start");
	f.dispatch("ui_prompt_start"); // Coalesced host span: ignore duplicate acquisition.
	f.dispatch("ui_prompt_end");
	f.dispatch("ui_prompt_end");
	f.dispatch("session_shutdown");
	expect(f.emit.mock.calls).toEqual([
		["herdr:blocked", { active: true, label: "Waiting for input" }],
		["herdr:blocked", { active: false }],
	]);
});

test("shutdown releases once and ignores late events; a fresh session can acquire", () => {
	const f = fixture();
	f.dispatch("session_start");
	f.dispatch("ui_prompt_start");
	f.dispatch("session_shutdown");
	f.dispatch("session_shutdown");
	f.dispatch("ui_prompt_start");
	f.dispatch("ui_prompt_end");
	expect(f.emit).toHaveBeenCalledTimes(2);
	f.dispatch("session_start");
	f.dispatch("ui_prompt_start");
	f.dispatch("session_start"); // Defensive cleanup if a host reuses an instance.
	f.dispatch("ui_prompt_end");
	expect(f.emit.mock.calls.map(([, data]) => data.active)).toEqual([
		true,
		false,
		true,
		false,
	]);
});
