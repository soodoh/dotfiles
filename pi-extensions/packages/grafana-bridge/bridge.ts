// Session-scoped stdio → loopback HTTP bridge for the official Grafana MCP.
// No dependencies, credential files, background service, or tool-call retries.
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
	type IncomingMessage,
	type OutgoingHttpHeaders,
	request,
} from "node:http";
import { type AddressInfo, createServer } from "node:net";
import { createInterface, type Interface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const refreshSkewMs = 120_000;

export interface AzureEnvironment extends NodeJS.ProcessEnv {
	AZURE_CONFIG_DIR: string;
	GRAFANA_AZURE_TENANT: string;
	GRAFANA_AZURE_RESOURCE: string;
}

export interface RpcRequest {
	jsonrpc: "2.0";
	id?: number | string;
	method: string;
	params?: Record<string, unknown>;
}

export interface RpcReply {
	jsonrpc: "2.0";
	id?: number | string | null;
	method?: string;
	result?: {
		[key: string]: unknown;
		protocolVersion?: string;
		isError?: boolean;
	};
	error?: { code: number; message: string };
}

export function createTokenProvider({
	env,
	signal,
	now = Date.now,
}: {
	env: AzureEnvironment;
	signal?: AbortSignal;
	now?: () => number;
}) {
	let cached: { token: string; expiresAt: number } | undefined;
	let pending: Promise<string> | undefined;
	return {
		async get() {
			if (cached && cached.expiresAt - refreshSkewMs > now())
				return cached.token;
			pending ??= (async () => {
				try {
					const { stdout } = await execute(
						"az",
						[
							"account",
							"get-access-token",
							"--tenant",
							env.GRAFANA_AZURE_TENANT,
							"--resource",
							env.GRAFANA_AZURE_RESOURCE,
							"--output",
							"json",
							"--only-show-errors",
						],
						{
							env,
							signal,
							timeout: 30_000,
							killSignal: "SIGKILL",
							maxBuffer: 1024 * 1024,
						},
					);
					const result: { accessToken?: unknown; expires_on?: unknown } =
						JSON.parse(stdout);
					const expiresAt = Number(result.expires_on) * 1000;
					if (
						typeof result.accessToken !== "string" ||
						!result.accessToken ||
						!Number.isFinite(expiresAt) ||
						expiresAt <= now()
					)
						throw new Error("Invalid token response");
					cached = { token: result.accessToken, expiresAt };
					return cached.token;
				} catch {
					cached = undefined;
					// Never print execFile's error: it includes captured credential output.
					throw new Error(
						`Azure authentication unavailable. Run AZURE_CONFIG_DIR="${env.AZURE_CONFIG_DIR}" az login --tenant ${env.GRAFANA_AZURE_TENANT}, then retry; no MCP reconnect needed.`,
					);
				}
			})().finally(() => {
				pending = undefined;
			});
			return pending;
		},
		invalidate(rejectedToken: string | undefined) {
			// A late failure must not evict a newer token acquired concurrently.
			if (cached?.token === rejectedToken) cached = undefined;
		},
	};
}

function localRequest(
	url: string,
	{
		method = "GET",
		headers,
		body,
		signal,
	}: {
		method?: string;
		headers?: OutgoingHttpHeaders;
		body?: string;
		signal?: AbortSignal;
	} = {},
): Promise<IncomingMessage> {
	// node:http deliberately bypasses inherited corporate HTTP proxy settings.
	return new Promise((resolve, reject) => {
		const req = request(url, { method, headers, signal }, resolve);
		req.on("error", reject);
		req.end(body);
	});
}

async function availablePort() {
	const socket = createServer();
	socket.listen(0, "127.0.0.1");
	await once(socket, "listening");
	const { port } = socket.address() as AddressInfo;
	await new Promise<void>((resolve, reject) =>
		socket.close((error) => (error ? reject(error) : resolve())),
	);
	return port;
}

async function forwardResponse(
	response: IncomingMessage,
	emit: (message: RpcReply) => void,
) {
	response.setEncoding("utf8");
	if (response.headers["content-type"]?.includes("text/event-stream")) {
		let buffer = "";
		let data: string[] = [];
		for await (const chunk of response) {
			buffer += chunk;
			for (;;) {
				const end = buffer.indexOf("\n");
				if (end === -1) break;
				const line = buffer.slice(0, end).replace(/\r$/, "");
				buffer = buffer.slice(end + 1);
				if (line.startsWith("data:"))
					data.push(line.slice(5).replace(/^ /, ""));
				if (line === "" && data.length) {
					emit(JSON.parse(data.join("\n")));
					data = [];
				}
			}
		}
	} else {
		let body = "";
		for await (const chunk of response) body += chunk;
		if (body) emit(JSON.parse(body));
	}
}

function validateEnvironment(
	env: NodeJS.ProcessEnv,
): asserts env is AzureEnvironment & { GRAFANA_URL: string } {
	for (const key of [
		"AZURE_CONFIG_DIR",
		"GRAFANA_URL",
		"GRAFANA_AZURE_TENANT",
		"GRAFANA_AZURE_RESOURCE",
	])
		if (!env[key]) throw new Error(`Missing ${key}`);
}

export async function runBridge(env: NodeJS.ProcessEnv = process.env) {
	validateEnvironment(env);
	const controller = new AbortController();
	const tokenProvider = createTokenProvider({ env, signal: controller.signal });
	const port = await availablePort();
	const origin = `http://127.0.0.1:${port}`;
	const localToken = randomBytes(32).toString("hex");
	const backendEnv: NodeJS.ProcessEnv = {
		...env,
		MCP_GRAFANA_SERVER_TOKEN: localToken,
		GRAFANA_ALLOW_URL_OVERRIDE: "false",
		GRAFANA_ALLOW_CROSS_ORIGIN_REDIRECTS: "false",
	};
	// Per-request Azure tokens must be the only source of Grafana authentication.
	for (const key of [
		"GRAFANA_SERVICE_ACCOUNT_TOKEN",
		"GRAFANA_SERVICE_ACCOUNT_TOKEN_FILE",
		"GRAFANA_API_KEY",
		"GRAFANA_USERNAME",
		"GRAFANA_PASSWORD",
		"GRAFANA_EXTRA_HEADERS",
		"GRAFANA_FORWARD_HEADERS",
	])
		delete backendEnv[key];
	const backend = spawn(
		"mcp-grafana",
		[
			"-t",
			"streamable-http",
			"--address",
			`127.0.0.1:${port}`,
			"--usage-stats",
			"disabled",
		],
		{ env: backendEnv, stdio: ["ignore", "ignore", "inherit"] },
	);
	let backendFailure: Error | undefined;
	let stopped = false;
	let lines: Interface | undefined;
	let session: string | undefined;
	let protocol: string | undefined;
	const emit = (message: RpcReply) =>
		process.stdout.write(`${JSON.stringify(message)}\n`);
	const stop = () => {
		if (stopped) return;
		stopped = true;
		controller.abort();
		lines?.close();
		process.stdin.pause();
		backend.kill("SIGTERM");
	};
	backend.on("error", () => {
		backendFailure = new Error("Could not launch mcp-grafana");
		stop();
	});
	backend.on("exit", () => {
		if (!stopped) {
			backendFailure = new Error("mcp-grafana exited unexpectedly");
			stop();
		}
	});
	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);
	try {
		let ready = false;
		for (let attempt = 0; attempt < 150 && !stopped; attempt++) {
			try {
				const response = await localRequest(`${origin}/healthz`, {
					signal: AbortSignal.any([
						controller.signal,
						AbortSignal.timeout(1000),
					]),
				});
				response.resume();
				if (response.statusCode === 200) {
					ready = true;
					break;
				}
			} catch {
				/* The child has not bound its socket yet. */
			}
			await delay(100, undefined, { signal: controller.signal });
		}
		if (!ready)
			throw backendFailure ?? new Error("mcp-grafana did not become ready");
		async function forward(message: RpcRequest) {
			let token: string | undefined;
			try {
				token = await tokenProvider.get();
				const response = await localRequest(`${origin}/mcp`, {
					method: "POST",
					signal: AbortSignal.any([
						controller.signal,
						AbortSignal.timeout(30_000),
					]),
					headers: {
						Authorization: `Bearer ${localToken}`,
						"X-Grafana-Service-Account-Token": token,
						"Content-Type": "application/json",
						Accept: "application/json, text/event-stream",
						...(session ? { "Mcp-Session-Id": session } : {}),
						...(protocol ? { "MCP-Protocol-Version": protocol } : {}),
					},
					body: JSON.stringify(message),
				});
				if (
					!response.statusCode ||
					response.statusCode < 200 ||
					response.statusCode >= 300
				) {
					response.resume();
					throw new Error(
						`Grafana MCP HTTP ${response.statusCode}; request was not retried`,
					);
				}
				const nextSession = response.headers["mcp-session-id"];
				if (typeof nextSession === "string") session = nextSession;
				await forwardResponse(response, (reply) => {
					if (message.method === "initialize" && reply.result?.protocolVersion)
						protocol = reply.result.protocolVersion;
					// Grafana API auth failures arrive as tool errors, not HTTP 401s.
					// Invalidate on errors so a new az login is picked up on the next call.
					if (reply.error || reply.result?.isError)
						tokenProvider.invalidate(token);
					emit(reply);
				});
			} catch (error) {
				if (stopped) return;
				tokenProvider.invalidate(token);
				const detail =
					error instanceof Error &&
					/^(Azure authentication unavailable|Grafana MCP HTTP)/.test(
						error.message,
					)
						? error.message
						: "Grafana MCP request failed; request was not retried";
				if (message.id !== undefined)
					emit({
						jsonrpc: "2.0",
						id: message.id,
						error: { code: -32000, message: detail },
					});
				else process.stderr.write(`[grafana-bridge] ${detail}\n`);
			}
		}
		lines = createInterface({ input: process.stdin });
		lines.on("line", (line) => {
			try {
				const message: RpcRequest = JSON.parse(line);
				if (message?.jsonrpc !== "2.0" || typeof message.method !== "string")
					throw new Error("Invalid request");
				void forward(message);
			} catch {
				emit({
					jsonrpc: "2.0",
					id: null,
					error: { code: -32700, message: "Invalid JSON-RPC input" },
				});
			}
		});
		await once(lines, "close");
		if (backendFailure) throw backendFailure;
	} finally {
		stop();
		process.removeListener("SIGTERM", stop);
		process.removeListener("SIGINT", stop);
		const kill = setTimeout(() => backend.kill("SIGKILL"), 2000);
		kill.unref();
		if (backend.exitCode === null && backend.signalCode === null)
			await once(backend, "close");
		clearTimeout(kill);
	}
}
