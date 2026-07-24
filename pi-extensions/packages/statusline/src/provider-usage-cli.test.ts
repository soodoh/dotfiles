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
			expect(JSON.parse(result.stdout)).toEqual({ text: "LLMHub $12.34" });
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
			{ text: "LLMHub $10.00" },
			{ text: "LLMHub $20.00" },
		]);
		const cacheText = await readFile(
			join(cacheDir, "pi", "provider-usage.json"),
			"utf8",
		);
		const cache = JSON.parse(cacheText);
		expect(cache.version).toBe(5);
		expect(Object.keys(cache.entries)).toHaveLength(2);
		expect(cacheText).not.toContain("first-token");
		expect(cacheText).not.toContain("second-token");
	} finally {
		if (server.listening) await closeServer(server);
		await rm(root, { recursive: true, force: true });
	}
}, 30_000);
