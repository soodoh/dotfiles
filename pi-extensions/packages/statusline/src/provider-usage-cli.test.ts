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

test("deduplicates provider refreshes across CLI processes", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-provider-usage-cli-"));
	const agentDir = join(root, "agent");
	const claudeConfigDir = join(root, "claude");
	const cacheDir = join(root, "cache");
	await Promise.all([
		mkdir(agentDir, { recursive: true }),
		mkdir(claudeConfigDir, { recursive: true }),
		mkdir(cacheDir, { recursive: true }),
	]);

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

		await writeFile(
			join(claudeConfigDir, "settings.json"),
			JSON.stringify({
				env: {
					ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
					ANTHROPIC_AUTH_TOKEN: "test-token",
				},
			}),
		);

		const env: NodeJS.ProcessEnv = {
			...process.env,
			HOME: root,
			PI_CODING_AGENT_DIR: agentDir,
			CLAUDE_CONFIG_DIR: claudeConfigDir,
			XDG_CACHE_HOME: cacheDir,
			PI_OFFLINE: "1",
		};
		delete env.ANTHROPIC_API_KEY;
		delete env.OPENAI_API_KEY;
		delete env.OPENROUTER_API_KEY;

		const bunBin = process.env.BUN_BIN ?? "bun";
		const results = await Promise.all([
			execFileAsync(bunBin, [cliPath], { env, timeout: 20_000 }),
			execFileAsync(bunBin, [cliPath], { env, timeout: 20_000 }),
		]);

		expect(requestCount).toBe(1);
		for (const result of results) {
			expect(JSON.parse(result.stdout)).toEqual({ text: "LLMHub $12.34" });
		}
	} finally {
		if (server.listening) await closeServer(server);
		await rm(root, { recursive: true, force: true });
	}
}, 30_000);

test("merges concurrent credential-scoped cache writes", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-provider-usage-cache-write-"));
	const agentDir = join(root, "agent");
	const firstClaudeConfigDir = join(root, "claude-first");
	const secondClaudeConfigDir = join(root, "claude-second");
	const cacheDir = join(root, "cache");
	await Promise.all([
		mkdir(agentDir, { recursive: true }),
		mkdir(firstClaudeConfigDir, { recursive: true }),
		mkdir(secondClaudeConfigDir, { recursive: true }),
		mkdir(cacheDir, { recursive: true }),
	]);

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
			writeFile(
				join(firstClaudeConfigDir, "settings.json"),
				JSON.stringify({
					env: {
						ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}/first`,
						ANTHROPIC_AUTH_TOKEN: "first-token",
					},
				}),
			),
			writeFile(
				join(secondClaudeConfigDir, "settings.json"),
				JSON.stringify({
					env: {
						ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}/second`,
						ANTHROPIC_AUTH_TOKEN: "second-token",
					},
				}),
			),
		]);

		const commonEnv: NodeJS.ProcessEnv = {
			...process.env,
			HOME: root,
			PI_CODING_AGENT_DIR: agentDir,
			XDG_CACHE_HOME: cacheDir,
			PI_OFFLINE: "1",
		};
		delete commonEnv.ANTHROPIC_API_KEY;
		delete commonEnv.OPENAI_API_KEY;
		delete commonEnv.OPENROUTER_API_KEY;
		const bunBin = process.env.BUN_BIN ?? "bun";

		const results = await Promise.all([
			execFileAsync(bunBin, [cliPath], {
				env: { ...commonEnv, CLAUDE_CONFIG_DIR: firstClaudeConfigDir },
				timeout: 20_000,
			}),
			execFileAsync(bunBin, [cliPath], {
				env: { ...commonEnv, CLAUDE_CONFIG_DIR: secondClaudeConfigDir },
				timeout: 20_000,
			}),
		]);

		expect(requestCount).toBe(2);
		expect(results.map((result) => JSON.parse(result.stdout))).toEqual([
			{ text: "LLMHub $10.00" },
			{ text: "LLMHub $20.00" },
		]);
		const cache = JSON.parse(
			await readFile(join(cacheDir, "pi", "provider-usage.json"), "utf8"),
		);
		expect(cache.version).toBe(5);
		expect(Object.keys(cache.entries)).toHaveLength(2);
	} finally {
		if (server.listening) await closeServer(server);
		await rm(root, { recursive: true, force: true });
	}
}, 30_000);
