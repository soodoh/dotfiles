// Isolated subprocess fixtures shared by Vitest and the real-binary smoke test.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type { RpcReply } from "../bridge.ts";
import {
	type FixtureEvent,
	type FixtureState,
	grafanaEnvironment,
} from "./fixture.ts";

const extensions = fileURLToPath(new URL("../../../", import.meta.url));
const fixture = new URL("./fixture.ts", import.meta.url).href;

interface ServerConfig {
	command: string;
	args: string[];
	env: Record<string, string>;
}

export const work: Record<string, ServerConfig> = JSON.parse(
	readFileSync(join(extensions, "../dotfiles/work/pi/agent/mcp.json"), "utf8"),
).mcpServers;

export function sandbox() {
	const root = mkdtempSync(join(tmpdir(), "grafana-bridge-test-"));
	const bin = join(root, "bin");
	mkdirSync(bin);
	for (const name of ["az", "mcp-grafana"])
		writeFileSync(
			join(bin, name),
			`#!${process.execPath}\nimport { runFixture } from ${JSON.stringify(fixture)};\nawait runFixture(${JSON.stringify(name)}, process.argv.slice(2));\n`,
			{ mode: 0o755 },
		);
	mkdirSync(join(root, ".pi/agent"), { recursive: true });
	symlinkSync(extensions, join(root, ".pi/agent/pi-extensions"));
	const statePath = join(root, "state.json");
	const log = join(root, "log.jsonl");
	writeFileSync(log, "");
	let state: FixtureState = {
		token: "fixture-before",
		expires_on: Math.floor(Date.now() / 1000) + 600,
	};
	const update = (changes: Partial<FixtureState>) => {
		state = { ...state, ...changes };
		writeFileSync(statePath, JSON.stringify(state));
	};
	update({});
	return {
		root,
		bin,
		update,
		env: {
			...grafanaEnvironment,
			HOME: root,
			PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
			FIXTURE_STATE: statePath,
			FIXTURE_LOG: log,
		},
		events: (): FixtureEvent[] =>
			readFileSync(log, "utf8")
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line)),
		remove: () => rmSync(root, { recursive: true, force: true }),
	};
}

export function connect(
	config: ServerConfig,
	baseEnv: NodeJS.ProcessEnv & { HOME: string },
) {
	const expand = (value: string) =>
		value
			.replace(/\$\{([A-Z_]+)\}/g, (_match, key: string) => {
				const value = baseEnv[key];
				if (value === undefined)
					throw new Error(`Missing fixture environment variable ${key}`);
				return value;
			})
			.replace(/^~\//, `${baseEnv.HOME}/`);
	const env = {
		...baseEnv,
		...Object.fromEntries(
			Object.entries(config.env).map(([key, value]) => [key, expand(value)]),
		),
	};
	const child = spawn(config.command, config.args.map(expand), {
		env,
		stdio: "pipe",
	});
	let stderr = "";
	child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
		stderr += chunk;
	});
	const pending = new Map<number | string, (message: RpcReply) => void>();
	let sequence = 0;
	const lines = createInterface({ input: child.stdout });
	lines.on("line", (line) => {
		const message: RpcReply = JSON.parse(line);
		if (message.id != null) {
			pending.get(message.id)?.(message);
			pending.delete(message.id);
		}
	});
	const exited = once(child, "exit");
	const send = (message: {
		id?: number;
		method: string;
		params?: Record<string, unknown>;
	}) =>
		child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
	return {
		child,
		stderr: () => stderr,
		async call(
			method: string,
			params: Record<string, unknown> = {},
		): Promise<RpcReply> {
			const id = ++sequence;
			const response = new Promise<RpcReply>((resolve) =>
				pending.set(id, resolve),
			);
			send({ id, method, params });
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				return await Promise.race([
					response,
					exited.then(() => {
						throw new Error(`Bridge exited: ${stderr}`);
					}),
					new Promise<never>((_, reject) => {
						timer = setTimeout(
							() => reject(new Error(`RPC timeout: ${stderr}`)),
							10_000,
						);
					}),
				]);
			} finally {
				clearTimeout(timer);
				pending.delete(id);
			}
		},
		notify: (method: string) => send({ method }),
		async close(signal?: NodeJS.Signals) {
			if (signal) child.kill(signal);
			else child.stdin.end();
			const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
			try {
				await exited;
			} finally {
				clearTimeout(timer);
				lines.close();
			}
		},
	};
}

export async function initialize(client: ReturnType<typeof connect>) {
	const result = await client.call("initialize", {
		protocolVersion: "2024-11-05",
		capabilities: {},
		clientInfo: { name: "bridge-test", version: "1" },
	});
	assert.ok(result.result?.serverInfo);
	client.notify("notifications/initialized");
}
