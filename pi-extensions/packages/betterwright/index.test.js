import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getKeybindings } from "@earendil-works/pi-tui";
import { BetterWright } from "betterwright";
import { afterEach, expect, test, vi } from "vitest";
import extension from "./index.ts";
import { fakeBw } from "./test-support/fake-bw.js";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

test("the upstream prompt hook preserves host guidance and appends routing guardrails", async () => {
	const hooks = [];
	extension({
		registerTool() {},
		registerCommand() {},
		on: (event, handler) => {
			if (event === "before_agent_start") hooks.push(handler);
		},
	});
	let systemPrompt = "Host guidance: use browser for multi-page research.";
	for (const hook of hooks)
		systemPrompt = (await hook({ systemPrompt }))?.systemPrompt ?? systemPrompt;
	expect(systemPrompt).toMatch(/^Host guidance:/);
	const guardrails = systemPrompt.split("## Guardrails for this session")[1];
	expect(guardrails).toBeDefined();
	for (const capability of [
		"Tool routing takes precedence",
		"web_search",
		"fetch_content",
		"Context7",
		"tool_search",
		"UI interaction",
		"authentication/authorization",
		"Bitwarden",
	])
		expect(guardrails).toContain(capability);
});

// Exercise the real upstream factory and client: defaults would create a
// separate local vault and enable credential capture instead of using bw.
test("browser use and visibility restarts retain Bitwarden-only credentials", async () => {
	const home = mkdtempSync(join(tmpdir(), "betterwright-policy-"));
	vi.stubEnv("BETTERWRIGHT_HOME", home);
	const clients = [];
	vi.spyOn(BetterWright.prototype, "run").mockImplementation(async function () {
		clients.push(this);
		return { ok: true, result: {}, artifacts: [], pages: [] };
	});
	const tools = new Map();
	const commands = new Map();
	const events = new Map();
	const cli = fakeBw(
		JSON.stringify([
			{
				id: "11111111-1111-1111-1111-111111111111",
				type: 1,
				name: "Fixture account",
				login: {
					username: "fixture-user",
					password: "fixture-password",
					uris: [{ uri: "https://example.com", match: 0 }],
				},
			},
		]),
	);
	extension({
		registerTool: (tool) => tools.set(tool.name, tool),
		registerCommand: (name, command) => commands.set(name, command),
		on: (event, handler) =>
			events.set(event, [...(events.get(event) ?? []), handler]),
	});
	try {
		expect(tools.has("browser_login")).toBe(true);
		expect(existsSync(cli.argsFile)).toBe(false);
		await commands.get("bw").handler("unlock", {
			mode: "tui",
			waitForIdle: async () => {},
			ui: {
				notify() {},
				custom: (factory) =>
					new Promise((resolve) => {
						const component = factory(
							{ requestRender() {} },
							{ fg: (_color, text) => text },
							getKeybindings(),
							resolve,
						);
						component.handleInput("fixture-master");
						component.handleInput("\r");
					}),
			},
		});
		await tools.get("browser").execute("browse", { code: "return page.url()" });
		await tools
			.get("browser_visibility")
			.execute("visible", { mode: "visible" });
		await tools
			.get("browser_visibility")
			.execute("headless", { mode: "headless" });
		expect(clients.length).toBeGreaterThanOrEqual(3);
		for (const client of clients) {
			expect(client.vault).toBe(clients[0].vault);
			await expect(
				client.vault.handleRequest("save", {}, "https://example.com"),
			).rejects.toThrow("read-only");
			await expect(
				client.vault.handleRequest("list", {}, "https://example.com"),
			).resolves.toMatchObject({ credentials: [{ username: "fixture-user" }] });
			expect(client.credentialCapture).toBe(false);
			expect(client.liveView.host).toBe("127.0.0.1");
			expect(client.liveView.publicHost).toBe("127.0.0.1");
		}
		for (const handler of events.get("session_shutdown")) await handler();
		await expect(
			clients[0].vault.handleRequest("list", {}, "https://example.com"),
		).rejects.toThrow("locked");
		expect(existsSync(join(home, "vault"))).toBe(false);
	} finally {
		for (const handler of events.get("session_shutdown")) await handler();
		cli.dispose();
		rmSync(home, { recursive: true, force: true });
	}
});
