// Credential-free actual-host sessions with deterministic provider responses.
// Only the worker inherits the disposable HOME; no model/network/desktop work.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolvePiHost } from "./host-runtime.mjs";

export function runSessionWorker(launcher, worker) {
	const host = resolvePiHost(launcher);
	const directory = realpathSync(
		mkdtempSync(join(tmpdir(), "pi-session-host-")),
	);
	try {
		for (const name of ["home", "agent", "work", "cache"])
			mkdirSync(join(directory, name));
		mkdirSync(join(directory, "work/.git"));
		const result = spawnSync(
			process.execPath,
			[fileURLToPath(worker), "worker", host.root],
			{
				cwd: join(directory, "work"),
				env: {
					HOME: join(directory, "home"),
					PI_CODING_AGENT_DIR: join(directory, "agent"),
					XDG_CACHE_HOME: join(directory, "cache"),
					XDG_CONFIG_HOME: join(directory, "home/.config"),
					TMPDIR: directory,
					PI_OFFLINE: "1",
					PI_SKIP_VERSION_CHECK: "1",
					PI_TELEMETRY: "0",
					JITI_FS_CACHE: "false",
					TERM: "dumb",
					NO_COLOR: "1",
				},
				timeout: 30000,
				killSignal: "SIGKILL",
				encoding: "utf8",
			},
		);
		assert.ifError(result.error);
		assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
		console.log(result.stdout.trim());
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

// require.resolve cannot resolve packages with import-only exports.
export function hostImportPath(hostRoot, name) {
	for (let directory = hostRoot; ; directory = dirname(directory)) {
		const root = join(directory, "node_modules", name);
		if (existsSync(join(root, "package.json"))) {
			const manifest = JSON.parse(
				readFileSync(join(root, "package.json"), "utf8"),
			);
			return join(root, manifest.exports["."].import);
		}
		assert.notEqual(
			directory,
			dirname(directory),
			`Host dependency ${name} not found`,
		);
	}
}

export async function createSessionFixture(
	hostRoot,
	{
		paths = [],
		factories = [],
		settings = {},
		respond,
		tools = [],
		uiContext,
		mode,
	} = {},
) {
	const pi = await import(pathToFileURL(join(hostRoot, "dist/index.js")).href);
	const ai = await import(
		pathToFileURL(hostImportPath(hostRoot, "@earendil-works/pi-ai")).href
	);
	const model = {
		id: "fixture",
		name: "Fixture",
		provider: "fixture",
		api: "fixture-api",
		baseUrl: "https://unused.invalid",
		reasoning: false,
		input: ["text"],
		contextWindow: 128000,
		maxTokens: 1024,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
	const stream = (selectedModel, context, options) => {
		const events = ai.createAssistantMessageEventStream();
		Promise.resolve()
			.then(async () => {
				const response = await respond(selectedModel, context, options);
				const message = {
					role: "assistant",
					api: selectedModel.api,
					provider: selectedModel.provider,
					model: selectedModel.id,
					content: response.content,
					stopReason: response.stopReason ?? "stop",
					timestamp: Date.now(),
					usage: {
						input: 1,
						output: 1,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 2,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					},
				};
				events.push({ type: "start", partial: message });
				events.push({ type: "done", reason: message.stopReason, message });
				events.end();
			})
			.catch((error) =>
				events.end({
					role: "assistant",
					content: [],
					stopReason: "error",
					errorMessage: String(error),
					api: model.api,
					provider: model.provider,
					model: model.id,
					timestamp: Date.now(),
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					},
				}),
			);
		return events;
	};
	const modelRuntime = await pi.ModelRuntime.create({
		modelsPath: null,
		authPath: join(process.env.PI_CODING_AGENT_DIR, "auth.json"),
		modelsStorePath: join(process.env.XDG_CACHE_HOME, "models.json"),
		refreshOnCreate: false,
	});
	modelRuntime.registerProvider("fixture", {
		apiKey: "fixture-key",
		api: model.api,
		models: [model],
		streamSimple: stream,
	});
	const settingsManager = pi.SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: false },
		...settings,
	});
	const resourceLoader = new pi.DefaultResourceLoader({
		cwd: process.cwd(),
		agentDir: process.env.PI_CODING_AGENT_DIR,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		additionalExtensionPaths: paths,
		extensionFactories: factories,
	});
	await resourceLoader.reload();
	assert.deepEqual(resourceLoader.getExtensions().errors, []);
	const { session } = await pi.createAgentSession({
		cwd: process.cwd(),
		agentDir: process.env.PI_CODING_AGENT_DIR,
		modelRuntime,
		model: modelRuntime.getModel("fixture", "fixture"),
		thinkingLevel: "off",
		settingsManager,
		resourceLoader,
		sessionManager: pi.SessionManager.inMemory(process.cwd()),
		tools,
	});
	const errors = [];
	await session.bindExtensions({
		uiContext,
		mode,
		onError: (error) => errors.push(error),
	});
	return { pi, ai, session, modelRuntime, errors };
}
