// Opt-in, real inference; operational calls are intercepted before execution.
// Tests first-route selection, not service behavior or end-to-end completion.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolvePiHost } from "../../test-support/host-runtime.mjs";

const [launcher, modelName] = process.argv.slice(2);
assert.ok(
	modelName?.includes("/"),
	"Pass the mise Pi launcher and provider/model",
);
const host = resolvePiHost(launcher);
const pi = await import(pathToFileURL(join(host.root, "dist/index.js")).href);
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const cases = JSON.parse(
	readFileSync(new URL("routing.evals.json", import.meta.url)),
);
const slash = modelName.indexOf("/");
const provider = modelName.slice(0, slash);
const model = modelName.slice(slash + 1);
const directory = mkdtempSync(join(tmpdir(), "pi-routing-eval-"));
const skillPath = join(
	packageRoot,
	"packages/browser/skills/playwright-browser/SKILL.md",
);
const modelRuntime = await pi.ModelRuntime.create({ refreshOnCreate: false });

function tool(name, description, properties, required = []) {
	return {
		name,
		label: name,
		description,
		parameters: { type: "object", properties, required },
		execute() {
			throw new Error("Evaluation gate failed: operational tool executed");
		},
	};
}
const string = { type: "string" };
// Representative search and service schemas; no real MCP servers are loaded.
const tools = [
	tool("web_search", "Search the public web for sources or answers.", {
		query: string,
		queries: { type: "array", items: string },
	}),
	tool(
		"fetch_content",
		"Fetch web pages and extract readable content.",
		{ url: string },
		["url"],
	),
	tool(
		"tool_search",
		"Discover configured MCP tools by service or capability.",
		{ query: string },
		["query"],
	),
	...[
		["azure", "Stage, Demo, and Prod"],
		["azure_test", "Integration/Test"],
	].map(([server, environment]) =>
		tool(
			`mcp__${server}__kusto`,
			`Read-only ${environment} Azure Data Explorer (Kusto): discover tables and execute KQL queries for logs and telemetry. Use learn=true to discover commands.`,
			{
				intent: string,
				command: string,
				parameters: { type: "object", additionalProperties: true },
				learn: { type: "boolean" },
			},
			["intent"],
		),
	),
	{
		...tool("read", "Read a local skill's instructions.", { path: string }, [
			"path",
		]),
		execute(_id, { path }) {
			assert.equal(
				resolve(path),
				skillPath,
				"Only the local browser skill can be read",
			);
			return {
				content: [{ type: "text", text: readFileSync(skillPath, "utf8") }],
				details: {},
			};
		},
	},
];
const results = [];
try {
	for (const item of cases) {
		const calls = [];
		const settingsManager = pi.SettingsManager.inMemory({
			defaultProvider: provider,
			defaultModel: model,
			compaction: { enabled: false },
			retry: { enabled: false },
		});
		const workInstructions = join(
			packageRoot,
			"../dotfiles/work/pi/agent/AGENTS.md",
		);
		const loader = new pi.DefaultResourceLoader({
			cwd: directory,
			agentDir: directory,
			settingsManager,
			noExtensions: true,
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			additionalExtensionPaths: [
				...(provider === "cliproxyapi"
					? [join(packageRoot, "packages/cliproxyapi/index.ts")]
					: []),
				join(packageRoot, "packages/browser/index.ts"),
			],
			additionalSkillPaths: [skillPath],
			agentsFilesOverride: () => ({
				agentsFiles:
					item.profile === "work"
						? [
								{
									path: workInstructions,
									content: readFileSync(workInstructions, "utf8"),
								},
							]
						: [],
			}),
			extensionFactories: [
				(api) => {
					api.on("tool_call", (event) => {
						if (event.toolName === "read" && calls.length < 3) {
							calls.push({ name: event.toolName });
							return;
						}
						calls.push({ name: event.toolName, input: event.input });
						return {
							block: true,
							terminate: true,
							reason:
								"Routing evaluation: recorded selection; no operation executed.",
						};
					});
				},
			],
		});
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const { session } = await pi.createAgentSession({
			cwd: directory,
			agentDir: directory,
			modelRuntime,
			thinkingLevel: process.env.PI_REASONING_LEVEL ?? "high",
			settingsManager,
			resourceLoader: loader,
			sessionManager: pi.SessionManager.inMemory(directory),
			noTools: "builtin",
			customTools: tools.filter(
				(entry) => item.profile === "work" || !entry.name.startsWith("mcp__"),
			),
		});
		const errors = [];
		const timer = setTimeout(() => void session.abort(), 90000);
		const started = performance.now();
		try {
			await session.bindExtensions({ onError: (error) => errors.push(error) });
			const selected = modelRuntime.getModel(provider, model);
			assert.ok(selected, `Requested model is not configured: ${modelName}`);
			await session.setModel(selected);
			session.setThinkingLevel(process.env.PI_REASONING_LEVEL ?? "high");
			assert.equal(
				`${session.model.provider}/${session.model.id}`,
				modelName,
				"Unexpected model fallback",
			);
			const active = session.getActiveToolNames();
			for (const required of ["web_search", "fetch_content", "tool_search"])
				assert.ok(
					active.includes(required),
					`Missing evaluation tool: ${required}`,
				);
			await session.prompt(item.prompt);
			assert.deepEqual(errors, []);
			const messages = session.messages.filter(
				(message) => message.role === "assistant",
			);
			assert.ok(
				messages.length > 0 &&
					messages.every(
						(message) => !["error", "aborted"].includes(message.stopReason),
					),
				`Inference failed or timed out: ${messages.map((message) => message.errorMessage ?? message.stopReason).join("; ")}`,
			);
			const operational = calls.filter((call) => call.name !== "read");
			const passed =
				item.accept.length === 0
					? operational.length === 0
					: operational.length > 0 &&
						operational.every((call) => item.accept.includes(call.name));
			const targetMentioned = item.target
				? JSON.stringify(operational).includes(item.target)
				: undefined;
			const result = {
				id: item.id,
				profile: item.profile,
				model: modelName,
				passed,
				targetMentioned,
				calls,
				elapsedMs: Math.round(performance.now() - started),
				tokens: messages.reduce(
					(sum, message) => sum + message.usage.totalTokens,
					0,
				),
				answer: session.getLastAssistantText(),
			};
			results.push(result);
			console.log(JSON.stringify(result));
		} finally {
			clearTimeout(timer);
			await session.abort();
			await session.extensionRunner.emit({ type: "session_shutdown" });
			session.dispose();
		}
	}
	console.log(
		JSON.stringify({
			passed: results.filter((result) => result.passed).length,
			total: results.length,
		}),
	);
	if (results.some((result) => !result.passed)) process.exitCode = 1;
} finally {
	rmSync(directory, { recursive: true, force: true });
}
