import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	CURSOR_MARKER,
	decodeKittyPrintable,
	type Focusable,
	isKeyRelease,
	Key,
	matchesKey,
	renderFakeCursor,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import {
	BITWARDEN_IDLE_TIMEOUT_MS,
	type BitwardenSession,
} from "./bitwarden-session.ts";

/** Dedicated secret input: no editor history, completion, plaintext rendering, or tool output. */
export async function promptBitwardenPassword(
	ctx: Pick<ExtensionCommandContext, "ui">,
	signal: AbortSignal,
): Promise<string | undefined> {
	if (signal.aborted) return undefined;
	return ctx.ui.custom<string | undefined>(
		(tui, theme, keybindings, done) => {
			let password = "";
			let paste: string | undefined;
			let completed = false;
			let hint = "Enter unlocks · Escape cancels · Ctrl+U clears";
			const segmenter = new Intl.Segmenter();
			const pasteStart = "\x1b[200~";
			const pasteEnd = "\x1b[201~";
			const clear = () => {
				password = "";
				paste = undefined;
				signal.removeEventListener("abort", abort);
			};
			const finish = (value: string | undefined) => {
				if (completed) return;
				completed = true;
				clear();
				done(value);
			};
			const abort = () => finish(undefined);
			const append = (value: string) => {
				const controls = [...value].some((character) => {
					const code = character.codePointAt(0) ?? 0;
					return code < 32 || (code >= 127 && code <= 159);
				});
				if (controls || password.length + value.length > 4096) {
					hint = "Use a single-line password, at most 4096 characters.";
					return;
				}
				password += value;
			};
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) queueMicrotask(abort);
			const component: Component & Focusable & { dispose(): void } = {
				focused: false,
				render(width: number) {
					const count = [...segmenter.segment(password)].length;
					const masks = "*".repeat(Math.min(count, Math.max(0, width - 3)));
					const cursor = this.focused
						? CURSOR_MARKER + renderFakeCursor(" ")
						: "";
					return [
						theme.fg("accent", "Unlock Bitwarden — master password"),
						`> ${masks}${cursor}`,
						theme.fg("dim", hint),
					].map((line) => truncateToWidth(line, width));
				},
				handleInput(data: string) {
					if (completed || isKeyRelease(data)) return;
					if (
						keybindings.matches(data, "tui.select.cancel") ||
						matchesKey(data, Key.ctrl("c"))
					) {
						finish(undefined);
						return;
					}
					if (paste === undefined && data.startsWith(pasteStart)) {
						paste = "";
						data = data.slice(pasteStart.length);
					}
					if (paste !== undefined) {
						paste += data;
						const end = paste.indexOf(pasteEnd);
						if (end >= 0) {
							append(paste.slice(0, end));
							paste = undefined;
						} else if (paste.length > 4096 + pasteEnd.length) {
							paste = undefined;
							hint = "Paste rejected: password is too long.";
						}
					} else if (
						keybindings.matches(data, "tui.input.submit") ||
						data === "\n"
					) {
						if (password) finish(password);
						return;
					} else if (
						keybindings.matches(data, "tui.editor.deleteCharBackward")
					) {
						const graphemes = [...segmenter.segment(password)];
						password = password.slice(0, graphemes.at(-1)?.index ?? 0);
					} else if (matchesKey(data, Key.ctrl("u"))) {
						password = "";
					} else {
						append(decodeKittyPrintable(data) ?? data);
					}
					tui.requestRender();
				},
				invalidate() {},
				dispose() {
					completed = true;
					clear();
				},
			};
			return component;
		},
		{ blocked: { kind: "auth", message: "Unlock Bitwarden" } },
	);
}

/** Commands run in Pi's human command channel, never as model-callable tools. */
export function registerBitwardenCommands(
	pi: Pick<ExtensionAPI, "registerCommand" | "on">,
	session: BitwardenSession,
) {
	let pending: AbortController | undefined;
	let enteringSecret = false;
	let disposed = false;
	pi.on("tool_call", () => {
		if (enteringSecret)
			return {
				block: true,
				reason:
					"Bitwarden unlock is in progress. Wait for the human to finish.",
			};
	});
	pi.on("session_shutdown", () => {
		disposed = true;
		pending?.abort();
		enteringSecret = false;
		session.dispose();
	});
	pi.registerCommand("bw", {
		description: "Unlock, lock, or check this Pi instance's Bitwarden adapter",
		getArgumentCompletions: (prefix) =>
			["unlock", "lock", "status"]
				.filter((value) => value.startsWith(prefix))
				.map((value) => ({ value, label: value })),
		async handler(args, ctx) {
			if (disposed) return;
			const action = args.trim().toLowerCase() || "status";
			if (action === "lock") {
				pending?.abort();
				session.lock();
				ctx.ui.notify("Bitwarden adapter locked.", "info");
				return;
			}
			if (action === "status") {
				ctx.ui.notify(`Bitwarden adapter is ${session.status()}.`, "info");
				return;
			}
			if (action !== "unlock") {
				ctx.ui.notify(
					"Use /bw unlock, /bw lock, or /bw status. Never put passwords in command arguments.",
					"error",
				);
				return;
			}
			if (ctx.mode !== "tui") {
				ctx.ui.notify(
					"Bitwarden unlock requires Pi's interactive terminal and masked password prompt.",
					"error",
				);
				return;
			}
			if (pending) {
				ctx.ui.notify("Bitwarden unlock is already in progress.", "info");
				return;
			}
			if (session.status() === "unlocked") {
				ctx.ui.notify("Bitwarden adapter is already unlocked.", "info");
				return;
			}
			const controller = new AbortController();
			pending = controller;
			let password: string | undefined;
			try {
				// Drain current work before showing the prompt. A temporary tool
				// gate also covers a background wake during secret entry/unlock.
				await ctx.waitForIdle();
				if (controller.signal.aborted) return;
				enteringSecret = true;
				password = await promptBitwardenPassword(ctx, controller.signal);
				if (password === undefined) {
					if (!controller.signal.aborted)
						ctx.ui.notify("Bitwarden unlock cancelled.", "info");
					return;
				}
				await session.unlock(password);
				if (!controller.signal.aborted)
					ctx.ui.notify(
						`Bitwarden unlocked; locks after ${BITWARDEN_IDLE_TIMEOUT_MS / 60_000} idle minutes.`,
						"info",
					);
			} catch {
				if (!controller.signal.aborted)
					ctx.ui.notify(
						"Bitwarden unlock failed. Check that bw is installed and logged in, then retry.",
						"error",
					);
			} finally {
				password = undefined;
				enteringSecret = false;
				if (pending === controller) pending = undefined;
			}
		},
	});
}
