import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(
	new URL("./provider-usage-cli.ts", import.meta.url),
);

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

async function writePiConfiguration(
	agentDir: string,
	baseUrl: string,
	token: string,
): Promise<void> {
	await mkdir(agentDir, { recursive: true });
	await Promise.all([
		writeFile(
			join(agentDir, "models.json"),
			JSON.stringify({
				providers: {
					"llm-hub": {
						baseUrl,
						api: "anthropic-messages",
						models: [
							{
								id: "claude-sonnet-5",
								name: "Claude Sonnet 5",
								reasoning: true,
								input: ["text", "image"],
								contextWindow: 1_000_000,
								maxTokens: 128_000,
								cost: {
									input: 2,
									output: 10,
									cacheRead: 0.2,
									cacheWrite: 2.5,
								},
							},
						],
					},
				},
			}),
		),
		writeFile(
			join(agentDir, "auth.json"),
			JSON.stringify({
				"llm-hub": { type: "api_key", key: token },
			}),
			{ mode: 0o600 },
		),
	]);
}

function cliEnvironment(
	root: string,
	agentDir: string,
	cacheDir: string,
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		HOME: root,
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		PI_CODING_AGENT_DIR: agentDir,
		XDG_CACHE_HOME: cacheDir,
		PI_OFFLINE: "1",
	};
	for (const name of [
		"ANTHROPIC_BASE_URL",
		"ANTHROPIC_AUTH_TOKEN",
		"ANTHROPIC_API_KEY",
		"LLMHUB_BASE_URL",
		"LLMHUB_AUTH_TOKEN",
		"CLAUDE_CONFIG_DIR",
	]) {
		delete env[name];
	}
	return env;
}

test("exports safe account details separately from direct text while retaining compact text", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-provider-usage-details-"));
	const agentDir = join(root, "agent");
	const now = Date.now();
	const server = createServer((request, response) => {
		const send = (body: unknown) => {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify(body));
		};
		if (request.url === "/v8/management/credentials") {
			send({
				files: ["a", "b", "c"].map((id, index) => ({
					provider: "codex",
					auth_index: id,
					status: "active",
					email: "private-email@example.test",
					id_token: {
						plan_type: "pro",
						chatgpt_account_id: "private-account-id",
					},
					quota: {
						observed_at: new Date(now).toISOString(),
						signals: {
							"X-Codex-Primary-Used-Percent": String((index + 1) * 10),
							"X-Codex-Primary-Window-Minutes": "10080",
							"X-Codex-Primary-Reset-At": String(
								Math.floor(now / 1000) + 86400,
							),
						},
					},
				})),
			});
		} else if (request.url === "/v8/management/requests/api-call") {
			send({
				status_code: 200,
				body: JSON.stringify({
					available_count: 2,
					credits: [
						{
							id: "private-credit-id",
							status: "available",
							expires_at: "2035-01-01T00:00:00Z",
						},
					],
				}),
			});
		} else send({ info: { spend: 12.34 } });
	});
	try {
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Missing test server address");
		const baseUrl = `http://127.0.0.1:${address.port}`;
		await writePiConfiguration(agentDir, baseUrl, "private-llm-token");
		const result = await execFileAsync(
			process.env.BUN_BIN ?? "bun",
			[cliPath],
			{
				env: {
					...cliEnvironment(root, agentDir, join(root, "cache")),
					CLIPROXYAPI_BASE_URL: baseUrl,
					CLIPROXYAPI_MANAGEMENT_KEY: "private-management-key",
				},
				timeout: 20_000,
			},
		);
		const output = JSON.parse(result.stdout);
		expect(output.directText).toBe("LLMHub $12.34");
		expect(output.text.split(" · ")).toEqual([
			"LLMHub $12.34",
			expect.stringMatching(/^\uF120 \d+%/),
			expect.stringMatching(/^\uF120 \d+%/),
			"+1",
		]);
		expect(output.proxyAccounts).toHaveLength(3);
		for (const account of output.proxyAccounts) {
			expect(account.key).toMatch(/^[a-f0-9]{64}$/);
			expect(account.summary).toContain("↻2");
			expect(account).toMatchObject({
				plan: "pro",
				health: "active",
				resetCredits: [{ expiresAt: Date.parse("2035-01-01T00:00:00Z") }],
			});
		}
		expect(result.stdout).not.toContain("private-");
		expect(result.stdout).not.toContain("auth_index");
	} finally {
		if (server.listening) await closeServer(server);
		await rm(root, { recursive: true, force: true });
	}
});

test("exports Copilot as its own cached hover target without duplicating its compact badge", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-copilot-usage-cli-"));
	const agentDir = join(root, "agent");
	const cacheDir = join(root, "cache");
	const preload = join(root, "copilot-fixture.ts");
	const requests = join(root, "requests.jsonl");
	try {
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			join(agentDir, "auth.json"),
			JSON.stringify({
				"github-copilot": {
					type: "oauth",
					access: "private-session-token",
					refresh: "private-github-token",
					expires: Date.now() + 3_600_000,
				},
			}),
			{ mode: 0o600 },
		);
		await writeFile(
			preload,
			`
import { appendFileSync } from "node:fs";
globalThis.fetch = async (url, init) => {
  if (String(url) !== "https://api.github.com/copilot_internal/user" || (init?.method ?? "GET") !== "GET") throw new Error("Unexpected network request");
  if (new Headers(init?.headers).get("Authorization") !== "token private-github-token") throw new Error("Incorrect usage credential");
  appendFileSync(${JSON.stringify(requests)}, "GET user\\n");
  return Response.json({
    copilot_plan: "business", token_based_billing: true,
    quota_reset_date_utc: "2035-02-01T00:00:00Z", login: "private-login",
    quota_snapshots: { premium_interactions: {
      entitlement: 1000, quota_remaining: 750, percent_remaining: 75,
      overage_permitted: true, overage_count: 0,
    } },
  });
};
`,
		);
		const env = cliEnvironment(root, agentDir, cacheDir);
		const invoke = () =>
			execFileAsync(
				process.env.BUN_BIN ?? "bun",
				["--preload", preload, cliPath],
				{ env, timeout: 20_000 },
			);
		const first = await invoke();
		const output = JSON.parse(first.stdout);
		expect(output.text).toBe(" 25%");
		expect(output.directText).toBe("");
		expect(output.proxyAccounts).toEqual([]);
		expect(output.copilot).toMatchObject({
			summary: "25%",
			state: "ready",
			stale: false,
			details: {
				plan: "Business",
				premium: {
					unit: "credits",
					allowance: 1000,
					used: 250,
					remaining: 750,
					overagePermitted: true,
					overageUsed: 0,
				},
			},
		});
		expect(JSON.parse((await invoke()).stdout)).toEqual(output);
		expect(await readFile(requests, "utf8")).toBe("GET user\n");
		for (const text of [
			first.stdout,
			first.stderr,
			await readFile(join(cacheDir, "pi", "provider-usage.json"), "utf8"),
		]) {
			expect(text).not.toContain("private-");
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("deduplicates provider refreshes across CLI processes", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-provider-usage-cli-"));
	const agentDir = join(root, "agent");
	const cacheDir = join(root, "cache");
	await mkdir(cacheDir, { recursive: true });

	let requestCount = 0;
	const server = createServer((_request, response) => {
		requestCount++;
		setTimeout(() => {
			const body = JSON.stringify({ info: { spend: 12.34 } });
			response.writeHead(200, {
				"content-type": "application/json",
				"content-length": Buffer.byteLength(body),
			});
			response.end(body);
		}, 200);
	});

	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Expected a TCP test server address");
		}

		await writePiConfiguration(
			agentDir,
			`http://127.0.0.1:${address.port}`,
			"test-token",
		);
		const env = cliEnvironment(root, agentDir, cacheDir);
		const bunBin = process.env.BUN_BIN ?? "bun";
		const results = await Promise.all([
			execFileAsync(bunBin, [cliPath], { env, timeout: 20_000 }),
			execFileAsync(bunBin, [cliPath], { env, timeout: 20_000 }),
		]);

		expect(requestCount).toBe(1);
		for (const result of results) {
			expect(JSON.parse(result.stdout)).toEqual({
				text: "LLMHub $12.34",
				directText: "LLMHub $12.34",
				proxyAccounts: [],
			});
		}
		const cacheText = await readFile(
			join(cacheDir, "pi", "provider-usage.json"),
			"utf8",
		);
		expect(cacheText).not.toContain("test-token");
	} finally {
		if (server.listening) await closeServer(server);
		await rm(root, { recursive: true, force: true });
	}
}, 30_000);

test("merges concurrent Pi credential-scoped cache writes", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-provider-usage-cache-write-"));
	const firstAgentDir = join(root, "agent-first");
	const secondAgentDir = join(root, "agent-second");
	const cacheDir = join(root, "cache");
	await mkdir(cacheDir, { recursive: true });

	let requestCount = 0;
	const server = createServer((request, response) => {
		requestCount++;
		setTimeout(() => {
			const spend = request.url?.startsWith("/first/") ? 10 : 20;
			const body = JSON.stringify({ info: { spend } });
			response.writeHead(200, {
				"content-type": "application/json",
				"content-length": Buffer.byteLength(body),
			});
			response.end(body);
		}, 200);
	});

	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", resolve);
		});
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("Expected a TCP test server address");
		}

		await Promise.all([
			writePiConfiguration(
				firstAgentDir,
				`http://127.0.0.1:${address.port}/first`,
				"first-token",
			),
			writePiConfiguration(
				secondAgentDir,
				`http://127.0.0.1:${address.port}/second`,
				"second-token",
			),
		]);
		const bunBin = process.env.BUN_BIN ?? "bun";
		const results = await Promise.all([
			execFileAsync(bunBin, [cliPath], {
				env: cliEnvironment(root, firstAgentDir, cacheDir),
				timeout: 20_000,
			}),
			execFileAsync(bunBin, [cliPath], {
				env: cliEnvironment(root, secondAgentDir, cacheDir),
				timeout: 20_000,
			}),
		]);

		expect(requestCount).toBe(2);
		expect(results.map((result) => JSON.parse(result.stdout))).toEqual([
			{ text: "LLMHub $10.00", directText: "LLMHub $10.00", proxyAccounts: [] },
			{ text: "LLMHub $20.00", directText: "LLMHub $20.00", proxyAccounts: [] },
		]);
		const cacheText = await readFile(
			join(cacheDir, "pi", "provider-usage.json"),
			"utf8",
		);
		const cache = JSON.parse(cacheText);
		expect(Object.keys(cache.entries)).toHaveLength(2);
		expect(cacheText).not.toContain("first-token");
		expect(cacheText).not.toContain("second-token");
	} finally {
		if (server.listening) await closeServer(server);
		await rm(root, { recursive: true, force: true });
	}
}, 30_000);

test.each(["openai", "openai-codex"])(
	"standalone %s OAuth deduplicates matched proxy usage and shares the cache across processes",
	async (provider) => {
		const root = await mkdtemp(join(tmpdir(), "pi-native-proxy-"));
		const agentDir = join(root, "agent");
		const cacheDir = join(root, "cache");
		const forwarded: {
			url: string;
			method: string;
			header: Record<string, string>;
		}[] = [];
		const clientId = "oaiapp_private-registration";
		const server = createServer(async (request, response) => {
			const send = (body: unknown) => {
				response.writeHead(200, { "content-type": "application/json" });
				response.end(JSON.stringify(body));
			};
			if (request.url === "/v8/management/credentials") {
				send({
					files: [
						{
							provider: "codex",
							auth_index: "private-proxy-id",
							disabled: true,
							id_token: { chatgpt_account_id: "private-account-id" },
						},
					],
				});
			} else if (request.url === "/v8/management/requests/api-call") {
				let input = "";
				for await (const chunk of request) input += chunk;
				const data = JSON.parse(input);
				forwarded.push(data);
				const body = data.url.endsWith("/chatpass/apps")
					? { items: [{ id: clientId }] }
					: data.url.endsWith("/usage")
						? {
								rate_limit: {
									primary_window: {
										used_percent: 37,
										limit_window_seconds: 604800,
										reset_at: Math.floor(Date.now() / 1000) + 86400,
									},
								},
							}
						: { available_count: 2 };
				send({ status_code: 200, body: JSON.stringify(body) });
			} else send({ info: { spend: 12.34 } });
		});
		try {
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", resolve),
			);
			const address = server.address();
			if (!address || typeof address === "string")
				throw new Error("Missing test server address");
			const baseUrl = `http://127.0.0.1:${address.port}`;
			await writePiConfiguration(agentDir, baseUrl, "private-llm-token");
			const auth = JSON.parse(
				await readFile(join(agentDir, "auth.json"), "utf8"),
			);
			auth[provider] = {
				type: "oauth",
				access:
					provider === "openai"
						? "private-native-token"
						: `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "private-account-id" } })).toString("base64url")}.signature`,
				refresh: "private-native-refresh",
				expires: Date.now() + 3600_000,
				...(provider === "openai"
					? { clientId, scopes: ["chatgpt.tokens.use.direct"] }
					: {}),
			};
			await writeFile(join(agentDir, "auth.json"), JSON.stringify(auth));
			const preload = join(root, "local-fetch-only.js");
			await writeFile(
				preload,
				`const original = globalThis.fetch; globalThis.fetch = (input, init) => { const url = new URL(typeof input === "string" ? input : input.url ?? input); if (url.hostname !== "127.0.0.1") throw new Error("Unexpected nonlocal request"); return original(input, init); };`,
			);
			const run = () =>
				execFileAsync(
					process.env.BUN_BIN ?? "bun",
					["--preload", preload, cliPath],
					{
						env: {
							...cliEnvironment(root, agentDir, cacheDir),
							CLIPROXYAPI_BASE_URL: baseUrl,
							CLIPROXYAPI_MANAGEMENT_KEY: "private-management-key",
						},
						timeout: 20_000,
					},
				);
			for (let i = 0; i < 2; i++) {
				const result = await run();
				const output = JSON.parse(result.stdout);
				expect(output.directText).toContain("LLMHub $12.34");
				expect(output.proxyAccounts).toHaveLength(1);
				expect(output.proxyAccounts[0].summary).toBe("37% (1d ↻2)");
				expect(output.directText).toBe("LLMHub $12.34");
				expect(output.text).toBe(
					`LLMHub $12.34 · \u{F0004} \uF120 ${output.proxyAccounts[0].summary}`,
				);
				expect(output.proxyAccounts[0].disabled).toBe(true);
				expect(output.proxyAccounts[0].scope.availableResets).toBe(2);
				expect(result.stdout).not.toContain("private-");
				expect(result.stderr).toBe("");
			}
			const expectedCalls = provider === "openai" ? 3 : 2;
			expect(forwarded).toHaveLength(expectedCalls);
			for (const call of forwarded) {
				expect(call.method).toBe("GET");
				expect(call.header.Authorization).toBe("Bearer $TOKEN$");
			}
			expect(JSON.stringify(forwarded)).not.toContain("private-native");
			const cache = await readFile(
				join(cacheDir, "pi", "cliproxy-usage.json"),
				"utf8",
			);
			expect(cache).not.toContain("private-");
			// Changed/removed logins cannot inherit the cached account association.
			if (provider === "openai") {
				auth.openai.clientId = "oaiapp_changed-registration";
				auth.openai.access = "changed-native-token";
			} else delete auth[provider];
			await writeFile(join(agentDir, "auth.json"), JSON.stringify(auth));
			const changed = JSON.parse((await run()).stdout);
			expect(changed.directText).toBe(
				provider === "openai" ? "LLMHub $12.34 · \u{F0004} ?" : "LLMHub $12.34",
			);
			expect(changed.proxyAccounts).toHaveLength(1);
			expect(forwarded).toHaveLength(expectedCalls);
		} finally {
			if (server.listening) await closeServer(server);
			await rm(root, { recursive: true, force: true });
		}
	},
	30_000,
);
