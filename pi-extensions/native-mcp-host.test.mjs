// Actual mise Pi client/codemode, synthetic credentials, local stdio fixtures only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolvePiHost } from "./test-support/host-runtime.mjs";

const file = fileURLToPath(import.meta.url);
const repo = dirname(dirname(file));
const fixture = join(dirname(file), "test-support/mcp-fixture.mjs");

if (process.argv[2] !== "--worker") {
	await test("native MCP configuration, environment routing, and codemode behavior", () => {
		const host = resolvePiHost(process.argv[2]);
		const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-native-mcp-")));
		try {
			const result = spawnSync(
				process.execPath,
				[file, "--worker", host.root],
				{
					cwd: root,
					env: {
						HOME: root,
						TMPDIR: root,
						PATH: process.env.PATH,
						PI_CODING_AGENT_DIR: root,
						PI_OFFLINE: "1",
						PI_SKIP_VERSION_CHECK: "1",
						AZURE_CONFIG_DIR: join(root, ".azure/dev/.azure"),
						AZURE_SUBSCRIPTION_ID: "fixture-production-subscription",
						ADO_MCP_PAT_BASIC: "fixture-pat",
						GWS_MCP_CLIENT_SECRET: "fixture-google-oauth-secret",
						HTTPS_PROXY: "http://127.0.0.1:1055",
						INHERITED_SENTINEL: "fixture-inherited",
					},
					timeout: 60000,
					killSignal: "SIGKILL",
					encoding: "utf8",
				},
			);
			assert.ifError(result.error);
			assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
} else {
	const host = process.argv[3];
	const load = (path) => import(pathToFileURL(join(host, "dist", path)).href);
	const { loadMcpConfig, getMcpToolExposure } = await load(
		"extensions/mcp/config.js",
	);
	const { validateMcpServerConfig } = await load("core/mcp-servers.js");
	const {
		createDefaultTransport,
		McpServerConnection,
		McpOAuthCredentialStore,
	} = await load("extensions/mcp/runtime.js");
	const { createMcpToolDefinition, createMcpToolName } = await load(
		"extensions/mcp/tools.js",
	);
	const { executeCodemode } = await load("extensions/codemode/execute.js");

	function config(profile) {
		const path = join(repo, "dotfiles", profile, "pi/agent/mcp.json");
		writeFileSync(join(process.env.HOME, "mcp.json"), readFileSync(path));
		const loaded = loadMcpConfig({
			agentDir: process.env.HOME,
			cwd: process.cwd(),
			projectTrusted: false,
		});
		assert.deepEqual(loaded.errors, []);
		assert.ok(loaded.servers.length > 0);
		for (const entry of loaded.servers) {
			assert.equal(
				typeof validateMcpServerConfig(entry.name, entry.config),
				"object",
			);
		}
		return Object.fromEntries(
			loaded.servers.map(({ name, config }) => [name, config]),
		);
	}

	const personal = config("personal");
	const work = config("work");
	// Exercise the actual host resolver: a schema-valid OAuth config can still
	// send an unresolved placeholder or silently ignore a misspelled scope key.
	for (const [name, server] of Object.entries(work)) {
		if (!name.startsWith("gws-")) continue;
		const connection = new McpServerConnection({
			entry: { name, config: server, source: "fixture", scope: "global" },
			cwd: process.cwd(),
			createTransport: createDefaultTransport,
			credentials: new McpOAuthCredentialStore(),
			onTools: () => {},
		});
		try {
			const oauth = connection.oauthSettings();
			assert.match(
				oauth.clientId,
				/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/,
			);
			assert.equal(oauth.clientSecret, process.env.GWS_MCP_CLIENT_SECRET);
			assert.equal(oauth.callbackPort, 8080);
			if (name === "gws-gmail")
				assert.equal(
					oauth.scope,
					"https://www.googleapis.com/auth/gmail.readonly",
				);
		} finally {
			await connection.close();
		}
	}
	for (const [server, allowed, forbidden] of [
		["gws-gmail", "get_message", "trash_message"],
		["gws-gmail", "search_threads", "create_draft"],
		["gws-gmail", "list_labels", "update_message_labels"],
		["mixpanel", "Run-Query", "Delete-Dashboard"],
		["mixpanel", "Get-Events", "Update-Business-Context"],
		["azure", "kusto", "cosmos"],
		["azure-test", "monitor", "redis"],
		["azure-devops", "pipelines_build_log", "core_get_identity_ids"],
		["heimdall", "heimdall-query", "heimdall-1ds-docs"],
	]) {
		assert.notEqual(getMcpToolExposure(work[server], allowed), "hidden");
		assert.equal(getMcpToolExposure(work[server], forbidden), "hidden");
	}

	async function connect(name, original) {
		const config = { ...original };
		if (config.command === "/usr/bin/env") {
			const commandIndex = config.args.indexOf("azmcp");
			assert.ok(commandIndex > 0);
			config.args = [
				...config.args.slice(0, commandIndex),
				process.execPath,
				fixture,
				...config.args.slice(commandIndex + 1),
			];
		} else {
			config.command = process.execPath;
			config.args = [fixture];
		}
		const connection = new McpServerConnection({
			entry: { name, config, source: "fixture", scope: "global" },
			cwd: process.cwd(),
			createTransport: createDefaultTransport,
			onTools: () => {},
		});
		await connection.getClient();
		return connection;
	}

	for (const [profile, servers] of [
		["personal", personal],
		["work", work],
	]) {
		for (const [name, server] of Object.entries(servers)) {
			if (!server.command) continue;
			const connection = await connect(name, server);
			try {
				const result = await connection.callTool("env", {});
				const env = result.structuredContent;
				assert.equal("sampling" in env.clientCapabilities, false);
				assert.equal(env.INHERITED_SENTINEL, "fixture-inherited");
				assert.equal(env.HTTPS_PROXY, process.env.HTTPS_PROXY);
				if (name === "azure-test") {
					assert.equal(env.AZURE_SUBSCRIPTION_ID, null);
					assert.equal(env.HOME, join(process.env.HOME, ".azure/dev"));
					assert.equal(env.AZURE_CONFIG_DIR, process.env.AZURE_CONFIG_DIR);
				}
				if (name === "azure" || name === "grafana-prod") {
					assert.equal(env.HOME, join(process.env.HOME, ".azure/prod"));
					assert.equal(env.AZURE_CONFIG_DIR, join(env.HOME, ".azure"));
				}
				if (name === "azure") {
					assert.equal(
						env.AZURE_SUBSCRIPTION_ID,
						"fixture-production-subscription",
					);
				}
				if (name.startsWith("azure") && name !== "azure-devops") {
					assert.equal(env.AZURE_TOKEN_CREDENTIALS, "AzureCliCredential");
				}
				if (name === "azure-devops")
					assert.equal(env.PERSONAL_ACCESS_TOKEN, "fixture-pat");
			} finally {
				await connection.close();
			}
			console.log(`${profile}/${name}: fixture environment verified`);
		}
	}

	const connection = await connect("azure-devops", work["azure-devops"]);
	try {
		const definitions = connection.tools
			.map((tool) =>
				createMcpToolDefinition({
					server: "azure-devops",
					tool,
					name: createMcpToolName("azure-devops", tool.name),
					exposure: getMcpToolExposure(work["azure-devops"], tool.name),
					getClient: async () => connection,
				}),
			)
			.filter((tool) => tool.exposure !== "hidden");
		const ctx = {
			hasUI: false,
			tools: definitions,
			sessionManager: { getBranch: () => [] },
			async executeTool(name, args) {
				const toolCall = {
					type: "toolCall",
					id: `fixture/${name}`,
					name,
					arguments: args,
				};
				const tool = ctx.tools.find((candidate) => candidate.name === name);
				const result = await tool.execute(toolCall.id, args);
				return { toolCall, result, isError: result.isError === true };
			},
		};
		const large = await definitions
			.find((tool) => tool.name.endsWith("pipelines_build_log"))
			.execute("preview", {});
		assert.equal(large.structuredContent.structuredContent.lines.length, 100);
		assert.match(large.content[0].text, /truncated/i);
		const result = await executeCodemode(
			"fixture",
			{
				code: `const [build, log] = await Promise.all([
				tools.mcp__azure_devops__pipelines_build({}),
				tools.mcp__azure_devops__pipelines_build_log({})
			]);
			if (build.isError || log.isError) throw new Error("unexpected tool error");
			return { status: build.structuredContent.status, logs: log.structuredContent.lines.length,
				lastFailure: log.structuredContent.lines.filter(line => line.status === "failed")[0].index };`,
			},
			undefined,
			undefined,
			ctx,
		);
		assert.notEqual(result.isError, true);
		const output = result.content.map((block) => block.text ?? "").join("\n");
		assert.match(output, /"logs":\s*100/);
		assert.match(output, /"lastFailure":\s*99/);
		const refused = await executeCodemode(
			"error",
			{
				code: "const result = await tools.mcp__azure_devops__pipelines_write({}); return result.isError;",
			},
			undefined,
			undefined,
			ctx,
		);
		assert.match(
			refused.content.map((block) => block.text ?? "").join("\n"),
			/true/,
		);
	} finally {
		await connection.close();
	}
}
