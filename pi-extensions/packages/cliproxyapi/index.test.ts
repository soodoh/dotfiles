import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FastModeController } from "@router-for-me/pi-cliproxyapi-provider/extensions/fast";
import { FastFooterController } from "@router-for-me/pi-cliproxyapi-provider/extensions/fast-footer";
import { registerFastCommands } from "@router-for-me/pi-cliproxyapi-provider/extensions/index";
import { resolveFastDefault } from "@router-for-me/pi-cliproxyapi-provider/extensions/lib";
import { afterEach, expect, test, vi } from "vitest";
import {
	connectCliproxyFast,
	FAST_CHANGED_EVENT,
	FAST_READER_EVENT,
	type SpeedReader,
} from "./index";

const directories: string[] = [];
afterEach(async () => {
	vi.unstubAllEnvs();
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function createAgentDir() {
	const agentDir = await mkdtemp(join(tmpdir(), "pi-fast-wrapper-"));
	directories.push(agentDir);
	return agentDir;
}

async function session(agentDir: string, failRefresh = false) {
	vi.stubEnv("CLIPROXYAPI_FAST", undefined);
	const mode = new FastModeController(resolveFastDefault(agentDir));
	mode.setSupportedModelIds(["gpt-fast"]);
	const notifications: string[] = [];
	const handlers = new Map<
		string,
		(args: string, ctx: never) => Promise<void>
	>();
	const listeners = new Map<string, (value: unknown) => void>();
	let reader: SpeedReader | undefined;
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
		reader = value as SpeedReader;
	});
	pi.events.on(FAST_CHANGED_EVENT, () => {
		changes++;
	});
	await connectCliproxyFast(pi, async (wrapped) => {
		new FastFooterController("cliproxyapi", mode).register(wrapped);
		registerFastCommands({
			pi: wrapped,
			agentDir,
			providerId: "cliproxyapi",
			fastMode: mode,
			onModeChange: async () => {
				if (failRefresh) throw new Error("refresh failed");
			},
		});
	});
	return {
		get changes() {
			return changes;
		},
		get speed() {
			return reader?.("cliproxyapi", "gpt-fast");
		},
		run: (name = "fast") => {
			const command = handlers.get(name);
			if (!command) throw new Error(`/${name} not registered`);
			return command("", {
				model: { provider: "cliproxyapi", id: "gpt-fast" },
				ui: { notify: (text: string) => notifications.push(text) },
			} as never);
		},
		notifications,
	};
}

test("instances sharing a config toggle Fast independently", async () => {
	const agentDir = await createAgentDir();
	const first = await session(agentDir);
	const second = await session(agentDir);
	expect([first.speed, second.speed]).toEqual([undefined, undefined]);
	await first.run();
	expect([first.speed, second.speed]).toEqual(["fast", undefined]);
	expect([first.changes, second.changes]).toEqual([1, 0]);
	await second.run();
	expect([first.speed, second.speed]).toEqual(["fast", "fast"]);
	await first.run();
	expect([first.speed, second.speed]).toEqual([undefined, "fast"]);
});

test("switches to Ultrafast locally and persists it for new instances", async () => {
	const agentDir = await createAgentDir();
	const instance = await session(agentDir);
	await instance.run("fast");
	const other = await session(agentDir);
	await instance.run("ultrafast");
	expect([instance.speed, other.speed]).toEqual(["ultrafast", "fast"]);
	expect([instance.changes, other.changes]).toEqual([2, 0]);
	const later = await session(agentDir);
	expect(later.speed).toBe("ultrafast");
	await instance.run("ultrafast");
	expect([instance.speed, later.speed]).toEqual([undefined, "ultrafast"]);
	expect(instance.changes).toBe(3);
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
	const instance = await session(await createAgentDir(), true);
	await instance.run();
	expect(instance.speed).toBeUndefined();
	expect(instance.changes).toBe(1);
	expect(
		instance.notifications.some((message) =>
			message.includes("Failed to refresh"),
		),
	).toBe(true);
});
