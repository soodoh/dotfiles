import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FastModeController } from "@router-for-me/pi-cliproxyapi-provider/extensions/fast";
import { FastFooterController } from "@router-for-me/pi-cliproxyapi-provider/extensions/fast-footer";
import { registerFastCommand } from "@router-for-me/pi-cliproxyapi-provider/extensions/index";
import { afterEach, expect, test, vi } from "vitest";
import {
	FAST_CHANGED_EVENT,
	FAST_READER_EVENT,
	type FastReader,
	isCliproxyFast,
} from "../statusline/src/cliproxy-fast";
import { connectCliproxyFast } from "./index";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function session(failRefresh = false) {
	const agentDir = await mkdtemp(join(tmpdir(), "pi-fast-wrapper-"));
	directories.push(agentDir);
	const mode = new FastModeController(false);
	mode.setSupportedModelIds(["gpt-fast"]);
	const notifications: string[] = [];
	const handlers = new Map<
		string,
		(args: string, ctx: never) => Promise<void>
	>();
	const listeners = new Map<string, (value: unknown) => void>();
	let reader: FastReader | undefined;
	let changes = 0;
	const pi = {
		events: {
			on(name: string, listener: (value: unknown) => void) {
				listeners.set(name, listener);
				return () => listeners.delete(name);
			},
			emit(name: string, value: unknown) {
				listeners.get(name)?.(value);
			},
		},
		on() {},
		registerCommand(
			name: string,
			options: { handler(args: string, ctx: never): Promise<void> },
		) {
			handlers.set(name, options.handler);
		},
	} as unknown as ExtensionAPI;
	pi.events.on(FAST_READER_EVENT, (value) => {
		reader = value as FastReader;
	});
	pi.events.on(FAST_CHANGED_EVENT, () => {
		changes++;
	});
	await connectCliproxyFast(pi, async (wrapped) => {
		new FastFooterController("cliproxyapi", mode).register(wrapped);
		registerFastCommand({
			pi: wrapped,
			agentDir,
			providerId: "cliproxyapi",
			fastMode: mode,
			onModeChange: async () => {
				if (failRefresh) throw new Error("refresh failed");
			},
		});
	});
	const command = handlers.get("fast");
	if (!command) throw new Error("/fast not registered");
	return {
		get changes() {
			return changes;
		},
		get fast() {
			return isCliproxyFast(
				{ provider: "cliproxyapi", id: "gpt-fast" },
				reader,
			);
		},
		run: () =>
			command("", {
				model: { provider: "cliproxyapi", id: "gpt-fast" },
				ui: { notify: (text: string) => notifications.push(text) },
			} as never),
		notifications,
	};
}

test("two independent controllers toggle and notify only their own statusline", async () => {
	const first = await session();
	const second = await session();
	expect([first.fast, second.fast]).toEqual([false, false]);
	await first.run();
	expect([first.fast, second.fast]).toEqual([true, false]);
	expect([first.changes, second.changes]).toEqual([1, 0]);
	await second.run();
	expect([first.fast, second.fast]).toEqual([true, true]);
	await first.run();
	expect([first.fast, second.fast]).toEqual([false, true]);
});

test("restores the provider hook and publishes nothing when startup fails", async () => {
	const register = FastFooterController.prototype.register;
	const emit = vi.fn();
	await expect(
		connectCliproxyFast(
			{ events: { emit } } as unknown as ExtensionAPI,
			async () => {
				throw new Error("provider unavailable");
			},
		),
	).rejects.toThrow("provider unavailable");
	expect(FastFooterController.prototype.register).toBe(register);
	expect(emit).not.toHaveBeenCalled();
});

test("reads the provider's rolled-back state after a failed refresh", async () => {
	const instance = await session(true);
	await instance.run();
	expect(instance.fast).toBe(false);
	expect(instance.changes).toBe(1);
	expect(
		instance.notifications.some((message) =>
			message.includes("Failed to refresh"),
		),
	).toBe(true);
});
