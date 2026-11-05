import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createTokenProvider } from "./bridge.ts";
import { connect, initialize, sandbox, work } from "./test-support/client.ts";
import { grafanaEnvironment } from "./test-support/fixture.ts";

// Exercises the real CLI/cache boundary: expiry, parallel refreshes, a failed
// login, and a late rejected token must not freeze or poison the active session.
test("Azure token cache refreshes before expiry, coalesces calls, and recovers after login", async () => {
	const box = sandbox();
	let now = Date.now();
	const env = {
		...box.env,
		AZURE_CONFIG_DIR: join(box.root, ".azure/dev/.azure"),
		GRAFANA_AZURE_TENANT: "fixture-tenant",
		GRAFANA_AZURE_RESOURCE: "fixture-resource",
	};
	const provider = createTokenProvider({ env, now: () => now });
	try {
		expect(
			await Promise.all([provider.get(), provider.get(), provider.get()]),
		).toEqual(Array(3).fill("fixture-before"));
		expect(box.events()).toHaveLength(1);
		await provider.get();
		expect(box.events()).toHaveLength(1);
		now += 500_000;
		box.update({
			token: "fixture-after",
			expires_on: Math.floor(now / 1000) + 600,
		});
		expect(await provider.get()).toBe("fixture-after");
		expect(box.events()).toHaveLength(2);
		provider.invalidate("fixture-before");
		expect(await provider.get()).toBe("fixture-after");
		expect(box.events()).toHaveLength(2);
		provider.invalidate("fixture-after");
		box.update({ fail: true });
		await expect(provider.get()).rejects.toThrow("az login");
		await expect(provider.get()).rejects.not.toThrow("fixture-secret");
		box.update({ fail: false, token: "fixture-login" });
		expect(await provider.get()).toBe("fixture-login");
	} finally {
		box.remove();
	}
});

// HTTP chunks may split any multibyte UTF-8 character in a tool result.
test.each(["café", "漢字", "😀"])(
	"preserves fragmented JSON response text: %s",
	async (text) => {
		const box = sandbox();
		box.update({ fragmentedText: text });
		const client = connect(work["grafana-dev"], box.env);
		try {
			await initialize(client);
			expect(await client.call("tools/call", { name: "probe" })).toMatchObject({
				result: { content: [{ type: "text", text }], isError: false },
			});
		} finally {
			try {
				await client.close();
			} finally {
				box.remove();
			}
		}
	},
);

// Cross-profile routing is an independent requirement, not merely a snapshot of
// mcp.json. Each test launches its actual configured command with synthetic az.
describe.each([
	{
		name: "grafana-prod",
		profile: "prod",
	},
	{
		name: "grafana-dev",
		profile: "dev",
	},
])("$name", ({ name, profile }) => {
	const tenant = grafanaEnvironment[`AZURE_${profile.toUpperCase()}_TENANT_ID`];
	const resource =
		grafanaEnvironment[`GRAFANA_${profile.toUpperCase()}_AZURE_RESOURCE`];
	const url = grafanaEnvironment[`GRAFANA_${profile.toUpperCase()}_URL`];
	test("configured launch routes credentials, recovers in-session, never replays, cleans up", async () => {
		const box = sandbox();
		let closed = false;
		const client = connect(work[name], {
			...box.env,
			HTTP_PROXY: "http://127.0.0.1:1",
			HTTPS_PROXY: "http://127.0.0.1:1",
			GRAFANA_SERVICE_ACCOUNT_TOKEN: "fixture-unwanted",
			GRAFANA_SERVICE_ACCOUNT_TOKEN_FILE: "/nonexistent",
			GRAFANA_API_KEY: "fixture-unwanted",
		});
		try {
			await initialize(client);
			expect(await client.call("tools/list")).toMatchObject({
				result: { tools: [{ name: "probe" }] },
			});
			expect(await client.call("resources/list")).toMatchObject({
				result: { resources: [] },
			});
			expect(await client.call("tools/call", { name: "probe" })).toMatchObject({
				result: { isError: false },
			});
			const before = box
				.events()
				.filter((event) => event.kind === "request").length;
			box.update({ token: "fixture-after" });
			expect(await client.call("tools/call", { name: "probe" })).toMatchObject({
				result: { isError: true },
			});
			expect(
				box.events().filter((event) => event.kind === "request"),
				"failed call must not be replayed",
			).toHaveLength(before + 1);
			const refreshed = await Promise.all([
				client.call("tools/call", { name: "probe" }),
				client.call("tools/call", { name: "probe" }),
			]);
			expect(refreshed).toMatchObject([
				{ result: { isError: false } },
				{ result: { isError: false } },
			]);
			expect(box.events().filter((event) => event.kind === "az")).toHaveLength(
				2,
			);
			box.update({ httpFailure: true });
			expect(
				(await client.call("tools/call", { name: "probe" })).error?.message,
			).toMatch(/HTTP 401/);
			box.update({ httpFailure: false, fail: true });
			const failedLogin = await client.call("tools/call", { name: "probe" });
			expect(failedLogin.error?.message).toMatch(/az login/);
			expect(JSON.stringify(failedLogin)).not.toMatch(/fixture-secret/);
			box.update({ fail: false, token: "fixture-login" });
			expect(await client.call("tools/call", { name: "probe" })).toMatchObject({
				result: { isError: false },
			});
			const events = box.events();
			for (const cli of events.filter((event) => event.kind === "az")) {
				expect(cli.home).toBe(join(box.root, `.azure/${profile}`));
				expect(cli.config).toBe(join(box.root, `.azure/${profile}/.azure`));
				expect(cli.args[cli.args.indexOf("--tenant") + 1]).toBe(tenant);
				expect(cli.args[cli.args.indexOf("--resource") + 1]).toBe(resource);
			}
			expect(
				events.filter((event) => event.kind === "backend-start"),
			).toHaveLength(1);
			const backend = events.find((event) => event.kind === "backend-start");
			expect(backend).toMatchObject({
				host: "127.0.0.1",
				localAuth: true,
				url,
			});
			expect(backend?.inlineToken).toBeUndefined();
			expect(backend?.tokenFile).toBeUndefined();
			expect(backend?.apiKey).toBeUndefined();
			for (const event of events.filter((event) => event.kind === "request")) {
				if (event.method === "tools/call")
					expect(event.session).toBe("fixture-session");
			}
			await client.close(profile === "prod" ? undefined : "SIGTERM");
			closed = true;
			expect(box.events()).toContainEqual({ kind: "backend-stop" });
			if (!backend) throw new Error("Missing backend process");
			expect(() => process.kill(backend.pid, 0)).toThrow(
				expect.objectContaining({ code: "ESRCH" }),
			);
		} finally {
			try {
				if (!closed) await client.close();
			} finally {
				box.remove();
			}
		}
	});
});
