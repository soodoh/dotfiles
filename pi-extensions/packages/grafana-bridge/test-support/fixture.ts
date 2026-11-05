// Synthetic Azure CLI and HTTP MCP executables; only temporary files/loopback.
import { appendFileSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

export const grafanaEnvironment: Record<string, string> = {
	AZURE_DEV_TENANT_ID: "fixture-dev-tenant",
	AZURE_PROD_TENANT_ID: "fixture-prod-tenant",
	GRAFANA_DEV_AZURE_RESOURCE: "fixture-dev-resource",
	GRAFANA_PROD_AZURE_RESOURCE: "fixture-prod-resource",
	GRAFANA_DEV_URL: "https://dev.grafana.invalid/",
	GRAFANA_PROD_URL: "https://prod.grafana.invalid/",
};

export interface FixtureState {
	token: string;
	expires_on: number;
	fail?: boolean;
	httpFailure?: boolean;
	fragmentedText?: string;
}

export type FixtureEvent =
	| { kind: "az"; args: string[]; home?: string; config?: string }
	| {
			kind: "backend-start";
			pid: number;
			host: string;
			port: number;
			args: string[];
			url?: string;
			inlineToken?: string;
			tokenFile?: string;
			apiKey?: string;
			localAuth: boolean;
	  }
	| {
			kind: "request";
			id?: number | string;
			method: string;
			token?: string | string[];
			session?: string | string[];
	  }
	| { kind: "backend-stop" };

export async function runFixture(kind: string, args: string[]) {
	const statePath = process.env.FIXTURE_STATE;
	const logPath = process.env.FIXTURE_LOG;
	if (!statePath || !logPath) throw new Error("Missing fixture paths");
	const state = (): FixtureState => JSON.parse(readFileSync(statePath, "utf8"));
	const record = (event: FixtureEvent) =>
		appendFileSync(logPath, `${JSON.stringify(event)}\n`);
	if (kind === "az") {
		record({
			kind,
			args,
			home: process.env.HOME,
			config: process.env.AZURE_CONFIG_DIR,
		});
		const current = state();
		if (current.fail) {
			process.stderr.write("fixture-secret-must-not-leak\n");
			process.exitCode = 1;
			return;
		}
		await delay(30);
		process.stdout.write(
			JSON.stringify({
				accessToken: current.token,
				expires_on: current.expires_on,
			}),
		);
		return;
	}
	const address = args[args.indexOf("--address") + 1];
	const [host, port] = address.split(":");
	record({
		kind: "backend-start",
		pid: process.pid,
		host,
		port: Number(port),
		args,
		url: process.env.GRAFANA_URL,
		inlineToken: process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN,
		tokenFile: process.env.GRAFANA_SERVICE_ACCOUNT_TOKEN_FILE,
		apiKey: process.env.GRAFANA_API_KEY,
		localAuth: Boolean(process.env.MCP_GRAFANA_SERVER_TOKEN),
	});
	const server = createServer(async (request, response) => {
		if (request.url === "/healthz") {
			response.end("ok");
			return;
		}
		if (
			request.headers.authorization !==
			`Bearer ${process.env.MCP_GRAFANA_SERVER_TOKEN}`
		) {
			response.writeHead(401).end();
			return;
		}
		let body = "";
		for await (const chunk of request) body += chunk;
		const message: {
			id?: number | string;
			method: string;
			params: { protocolVersion?: string };
		} = JSON.parse(body);
		record({
			kind: "request",
			id: message.id,
			method: message.method,
			token: request.headers["x-grafana-service-account-token"],
			session: request.headers["mcp-session-id"],
		});
		if (state().httpFailure) {
			response.writeHead(401).end();
			return;
		}
		if (message.id === undefined) {
			response.writeHead(202).end();
			return;
		}
		let result: Record<string, unknown>;
		if (message.method === "initialize") {
			response.setHeader("Mcp-Session-Id", "fixture-session");
			result = {
				protocolVersion: message.params.protocolVersion,
				capabilities: { tools: {}, resources: {} },
				serverInfo: { name: "grafana-fixture", version: "1" },
			};
		} else if (message.method === "tools/list") {
			result = {
				tools: [
					{ name: "probe", inputSchema: { type: "object", properties: {} } },
				],
			};
		} else if (message.method === "tools/call") {
			const authorized =
				request.headers["x-grafana-service-account-token"] === state().token;
			result = {
				content: [
					{
						type: "text",
						text: authorized
							? (state().fragmentedText ?? "accepted")
							: "401 expired fixture token",
					},
				],
				isError: !authorized,
			};
		} else result = { resources: [] };
		const reply = { jsonrpc: "2.0", id: message.id, result };
		if (message.method === "tools/list") {
			// CRLF, comments, multiline data, and fragmented frames are valid SSE.
			response.setHeader("Content-Type", "text/event-stream");
			const event = `: heartbeat\r\nevent: message\r\ndata: ${JSON.stringify(reply, null, 2).split("\n").join("\r\ndata: ")}\r\n\r\n`;
			response.write(event.slice(0, 11));
			response.end(event.slice(11));
		} else {
			response.setHeader("Content-Type", "application/json");
			const body = Buffer.from(JSON.stringify(reply));
			const split = body.findIndex((byte) => byte >= 0x80) + 1;
			if (state().fragmentedText !== undefined && split > 0) {
				// Split inside a UTF-8 character, allowing the first bytes to arrive.
				response.write(body.subarray(0, split));
				await delay(100);
				response.end(body.subarray(split));
			} else response.end(body);
		}
	});
	server.listen(Number(port), host);
	process.once("SIGTERM", () => {
		record({ kind: "backend-stop" });
		server.close(() => process.exit(0));
	});
}
