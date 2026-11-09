import { getKeybindings, visibleWidth } from "@earendil-works/pi-tui";
import { expect, test, vi } from "vitest";
import {
	promptBitwardenPassword,
	registerBitwardenCommands,
} from "./bitwarden-commands.ts";

function dialog() {
	let component;
	let open;
	let completed = false;
	const opened = new Promise((resolve) => {
		open = resolve;
	});
	const custom = vi.fn(
		(factory) =>
			new Promise((resolve) => {
				component = factory(
					{ requestRender() {} },
					{ fg: (_color, text) => text },
					getKeybindings(),
					(value) => {
						completed = true;
						resolve(value);
					},
				);
				component.focused = true;
				open(component);
			}),
	);
	return {
		custom,
		opened,
		get completed() {
			return completed;
		},
		get component() {
			return component;
		},
	};
}

function passwordDialog() {
	const view = dialog();
	const controller = new AbortController();
	const result = promptBitwardenPassword(
		{ ui: { custom: view.custom } },
		controller.signal,
	);
	return { view, controller, result };
}

test("password rendering stays masked at every width and clears after submission", async () => {
	const { view, result } = passwordDialog();
	const component = await view.opened;
	for (const character of "fixture-master") {
		component.handleInput(character);
		for (const width of [1, 5, 30, 80]) {
			const lines = component.render(width);
			expect(lines.join("\n")).not.toContain("fixture-master");
			for (const line of lines)
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	}
	expect(component.render(80)[1]).toContain("**************");
	component.handleInput("\r");
	await expect(result).resolves.toBe("fixture-master");
	expect(component.render(80)[1]).not.toContain("*");
	component.handleInput("must-be-ignored-after-completion");
	expect(component.render(80)[1]).not.toContain("*");
});

test("Unicode backspace and Kitty printable input preserve password content", async () => {
	const { view, result } = passwordDialog();
	const component = await view.opened;
	component.handleInput("pa");
	component.handleInput("\x1b[223u");
	component.handleInput("🧑‍💻");
	component.handleInput("\x7f");
	component.handleInput("\r");
	await expect(result).resolves.toBe("paß");
});

test("clear does not copy secret text into a normal editor or history", async () => {
	const { view, result } = passwordDialog();
	const component = await view.opened;
	component.handleInput("discarded-fixture-password");
	component.handleInput("\x15");
	component.handleInput("replacement-fixture");
	component.handleInput("\r");
	await expect(result).resolves.toBe("replacement-fixture");
});

test("chunked bracketed paste cannot submit a password automatically", async () => {
	const { view, result } = passwordDialog();
	const component = await view.opened;
	component.handleInput("\x1b[200~fixture-");
	component.handleInput("pasted-password");
	component.handleInput("\x1b[201~\r");
	expect(view.completed).toBe(false);
	component.handleInput("\r");
	await expect(result).resolves.toBe("fixture-pasted-password");
});

test("pasted control characters are rejected instead of triggering commands", async () => {
	const { view, result } = passwordDialog();
	const component = await view.opened;
	component.handleInput("safe-fixture");
	component.handleInput("\x1b[200~unsafe\n/bw unlock\x1b[201~");
	expect(view.completed).toBe(false);
	component.handleInput("\r");
	await expect(result).resolves.toBe("safe-fixture");
});

test.each(["\x1b", "\x03"])("cancel clears the secret buffer", async (key) => {
	const { view, result } = passwordDialog();
	const component = await view.opened;
	component.handleInput("fixture-master");
	component.handleInput(key);
	await expect(result).resolves.toBeUndefined();
	expect(component.render(80)[1]).not.toContain("*");
});

test("shutdown abort closes a pending prompt and clears its buffers", async () => {
	const { view, controller, result } = passwordDialog();
	const component = await view.opened;
	component.handleInput("\x1b[200~fixture-unfinished-paste");
	controller.abort();
	await expect(result).resolves.toBeUndefined();
	expect(component.render(80)[1]).not.toContain("*");
});

test("empty input does not submit and an oversized paste is not retained", async () => {
	const { view, result } = passwordDialog();
	const component = await view.opened;
	component.handleInput("\r");
	expect(view.completed).toBe(false);
	component.handleInput(`\x1b[200~${"x".repeat(5000)}`);
	component.handleInput("\r");
	expect(view.completed).toBe(false);
	component.handleInput("fixture-master");
	component.handleInput("\r");
	await expect(result).resolves.toBe("fixture-master");
});

function commands() {
	const view = dialog();
	const registered = new Map();
	const events = new Map();
	let state = "locked";
	const session = {
		status: vi.fn(() => state),
		lock: vi.fn(() => {
			state = "locked";
		}),
		unlock: vi.fn(async () => {
			state = "unlocked";
		}),
		dispose: vi.fn(),
	};
	registerBitwardenCommands(
		{
			registerCommand: (name, definition) => registered.set(name, definition),
			on: (name, handler) => events.set(name, handler),
		},
		session,
	);
	const ctx = {
		mode: "tui",
		waitForIdle: vi.fn(async () => {}),
		ui: { custom: view.custom, notify: vi.fn() },
	};
	return { view, session, ctx, events, command: registered.get("bw") };
}

test("human unlock uses the masked component and never reports the password", async () => {
	const { view, session, ctx, command } = commands();
	const result = command.handler("unlock", ctx);
	const component = await view.opened;
	component.handleInput("fixture-master");
	component.handleInput("\r");
	await result;
	expect(ctx.waitForIdle).toHaveBeenCalledOnce();
	expect(session.unlock).toHaveBeenCalledWith("fixture-master");
	expect(JSON.stringify(ctx.ui.notify.mock.calls)).not.toContain(
		"fixture-master",
	);
	expect(ctx.ui.notify).toHaveBeenLastCalledWith(
		expect.stringContaining("15 idle minutes"),
		"info",
	);
});

test("secret entry waits for idle and gates tools until the human finishes", async () => {
	const { view, session, ctx, command, events } = commands();
	let idle;
	ctx.waitForIdle.mockImplementation(
		() =>
			new Promise((resolve) => {
				idle = resolve;
			}),
	);
	const result = command.handler("unlock", ctx);
	expect(view.custom).not.toHaveBeenCalled();
	expect(events.get("tool_call")()).toBeUndefined();
	idle();
	const component = await view.opened;
	expect(events.get("tool_call")()).toMatchObject({ block: true });
	component.handleInput("\x1b");
	await result;
	expect(session.unlock).not.toHaveBeenCalled();
	expect(events.get("tool_call")()).toBeUndefined();
});

test.each(["rpc", "json", "print"])(
	"unlock refuses an unmasked %s context",
	async (mode) => {
		const { view, session, ctx, command } = commands();
		ctx.mode = mode;
		await command.handler("unlock", ctx);
		expect(view.custom).not.toHaveBeenCalled();
		expect(session.unlock).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("masked password prompt"),
			"error",
		);
	},
);

test("command arguments cannot carry a password or be echoed back", async () => {
	const { view, session, ctx, command } = commands();
	await command.handler("unlock fixture-never-an-argument", ctx);
	expect(view.custom).not.toHaveBeenCalled();
	expect(session.unlock).not.toHaveBeenCalled();
	expect(JSON.stringify(ctx.ui.notify.mock.calls)).not.toContain(
		"fixture-never-an-argument",
	);
});

test("status is local and repeated unlock does not invalidate the existing session", async () => {
	const { view, session, ctx, command } = commands();
	await command.handler("status", ctx);
	expect(ctx.ui.notify).toHaveBeenLastCalledWith(
		"Bitwarden adapter is locked.",
		"info",
	);
	session.status.mockReturnValue("unlocked");
	await command.handler("unlock", ctx);
	expect(session.unlock).not.toHaveBeenCalled();
	expect(view.custom).not.toHaveBeenCalled();
});

test("lock cancels a pending prompt without unlocking or leaving secret text", async () => {
	const { view, session, ctx, command } = commands();
	const result = command.handler("unlock", ctx);
	const component = await view.opened;
	component.handleInput("fixture-master");
	await command.handler("lock", ctx);
	await result;
	expect(session.lock).toHaveBeenCalledOnce();
	expect(session.unlock).not.toHaveBeenCalled();
	expect(component.render(80)[1]).not.toContain("*");
});

test("duplicate requests cannot open overlapping password prompts", async () => {
	const { view, ctx, command } = commands();
	const result = command.handler("unlock", ctx);
	const component = await view.opened;
	await command.handler("unlock", ctx);
	expect(view.custom).toHaveBeenCalledOnce();
	component.handleInput("\x1b");
	await result;
});

test("command errors never include unlock failures or session tokens", async () => {
	const { view, session, ctx, command } = commands();
	session.unlock.mockRejectedValue(new Error("fixture-secret-key"));
	const result = command.handler("unlock", ctx);
	const component = await view.opened;
	component.handleInput("fixture-master");
	component.handleInput("\r");
	await result;
	expect(ctx.ui.notify).toHaveBeenLastCalledWith(
		expect.stringContaining("unlock failed"),
		"error",
	);
	expect(JSON.stringify(ctx.ui.notify.mock.calls)).not.toMatch(
		/fixture-(master|secret-key)/,
	);
});

test("session shutdown disposes the session and cancels pending input silently", async () => {
	const { view, session, ctx, command, events } = commands();
	const result = command.handler("unlock", ctx);
	const component = await view.opened;
	component.handleInput("fixture-master");
	events.get("session_shutdown")();
	await result;
	expect(session.dispose).toHaveBeenCalledOnce();
	expect(session.unlock).not.toHaveBeenCalled();
	expect(ctx.ui.notify).not.toHaveBeenCalled();
	expect(component.render(80)[1]).not.toContain("*");
});
