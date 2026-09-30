// Local stdio MCP fixture: no credentials, network, or external services.
import { createInterface } from "node:readline";

const tools = [
	["env", "Inspect fixture environment"],
	["pipelines_build", "List fixture builds"],
	["pipelines_build_log", "Read large fixture logs"],
	["pipelines_write", "Return a fixture tool error"],
];

let clientCapabilities;
for await (const line of createInterface({ input: process.stdin })) {
	const message = JSON.parse(line);
	if (message.id === undefined) continue;
	let result;
	switch (message.method) {
		case "initialize":
			clientCapabilities = message.params.capabilities;
			result = {
				protocolVersion: message.params.protocolVersion,
				capabilities: { tools: {} },
				serverInfo: { name: "dotfiles-fixture", version: "1" },
			};
			break;
		case "tools/list":
			result = {
				tools: tools.map(([name, description]) => ({
					name,
					description,
					inputSchema: { type: "object", properties: {} },
				})),
			};
			break;
		case "tools/call": {
			let data;
			const name = message.params.name;
			if (name === "env") {
				data = Object.fromEntries(
					[
						"HOME",
						"AZURE_CONFIG_DIR",
						"AZURE_SUBSCRIPTION_ID",
						"AZURE_TOKEN_CREDENTIALS",
						"PERSONAL_ACCESS_TOKEN",
						"GRAFANA_URL",
						"INHERITED_SENTINEL",
						"HTTPS_PROXY",
					].map((key) => [key, process.env[key] ?? null]),
				);
				data.clientCapabilities = clientCapabilities;
			} else if (name === "pipelines_build_log") {
				data = {
					lines: Array.from({ length: 100 }, (_, index) => ({
						index,
						status: index === 99 ? "failed" : "passed",
						text: "fixture log ".repeat(80),
					})),
				};
			} else if (name === "pipelines_write") {
				result = {
					content: [{ type: "text", text: "fixture refusal" }],
					isError: true,
				};
				break;
			} else {
				data = { status: "complete", name };
			}
			result = {
				content: [{ type: "text", text: JSON.stringify(data) }],
				structuredContent: data,
			};
			break;
		}
		default:
			result = {};
	}
	process.stdout.write(
		`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`,
	);
}
