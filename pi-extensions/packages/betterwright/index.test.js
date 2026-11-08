import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BetterWright } from "betterwright";
import { afterEach, expect, test, vi } from "vitest";
import extension from "./index.ts";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

// Exercise the real upstream factory and client: reverting to its defaults
// would silently enable credential capture and the agent-facing login tool.
test("browser use and visibility restarts retain Bitwarden-only credentials", async () => {
	const home = mkdtempSync(join(tmpdir(), "betterwright-policy-"));
	vi.stubEnv("BETTERWRIGHT_HOME", home);
	const clients = [];
	vi.spyOn(BetterWright.prototype, "run").mockImplementation(async function () {
		clients.push(this);
		return { ok: true, result: {}, artifacts: [], pages: [] };
	});
	const tools = new Map();
	const events = new Map();
	extension({
		registerTool: (tool) => tools.set(tool.name, tool),
		on: (event, handler) => events.set(event, handler),
	});
	try {
		expect(tools.has("browser_login")).toBe(false);
		await tools.get("browser").execute("browse", { code: "return page.url()" });
		await tools
			.get("browser_visibility")
			.execute("visible", { mode: "visible" });
		await tools
			.get("browser_visibility")
			.execute("headless", { mode: "headless" });
		expect(clients.length).toBeGreaterThanOrEqual(3);
		for (const client of clients) {
			expect(client.vault).toBeNull();
			expect(client.credentialCapture).toBe(false);
			expect(client.liveView.host).toBe("127.0.0.1");
			expect(client.liveView.publicHost).toBe("127.0.0.1");
		}
		await events.get("session_shutdown")();
		expect(existsSync(join(home, "vault"))).toBe(false);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});
