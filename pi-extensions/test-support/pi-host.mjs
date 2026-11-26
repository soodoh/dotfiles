// Consolidated Pi host test module: host discovery, disposable sandbox workers,
// jiti loading, and deterministic in-process session fixtures.
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
import { createRequire } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// In this disposable probe, inaccessible paths appear absent to existence checks.
// Real reads/writes remain subject to Node permissions; other errors must surface.
export function hideDeniedExistenceChecks(existsSyncFn) {
	return (path) => {
		try {
			return existsSyncFn(path);
		} catch (error) {
			if (error?.code === "ERR_ACCESS_DENIED") return false;
			throw error;
		}
	};
}

export function resolvePiHost(launcher) {
	assert.ok(launcher, 'Pass the actual launcher: "$(mise which pi)"');
	let entry = realpathSync(launcher);
	const target = readFileSync(entry, "utf8").match(
		/^# aube-bin-shim v2 target=(.+)$/m,
	)?.[1];
	if (target) entry = realpathSync(resolve(dirname(entry), target));
	let root = dirname(entry);
	for (;;) {
		let manifest;
		try {
			manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
		} catch {
			/* Not a package root. */
		}
		if (manifest?.name === "@earendil-works/pi-coding-agent") {
			// Permit the isolated installation's dependency store, not the user's home.
			const index = root.indexOf(`${sep}node_modules${sep}`);
			assert.ok(index >= 0, "Expected an npm-installed Pi host");
			return {
				root,
				entry,
				version: manifest.version,
				modules: root.slice(0, index + "/node_modules".length),
			};
		}
		assert.notEqual(
			root,
			dirname(root),
			"Unrecognized Pi launcher; no development-package fallback",
		);
		root = dirname(root);
	}
}

export async function createHostJiti(
	packageJsonPath,
	{ fsCache = false, callerUrl = import.meta.url } = {},
) {
	const requireFromPackage = createRequire(packageJsonPath);
	const { createJiti } = await import(
		pathToFileURL(requireFromPackage.resolve("jiti")).href
	);
	return createJiti(callerUrl, { fsCache });
}

export async function startUnixJsonServer(
	socketPath,
	{ ack = '{"ok":true}\n' } = {},
) {
	const messages = [];
	let activeConnections = 0;
	const server = net.createServer({ allowHalfOpen: true }, (socket) => {
		activeConnections += 1;
		let buffer = "";
		let replied = false;
		const flushLine = () => {
			if (replied) return;
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			const line = buffer.slice(0, newline).trim();
			if (line) messages.push(JSON.parse(line));
			replied = true;
			if (!socket.destroyed && !socket.writableEnded) socket.end(ack);
		};
		socket.on("error", () => {});
		socket.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			flushLine();
		});
		socket.on("end", () => {
			if (!replied) {
				const line = buffer.trim();
				if (line) messages.push(JSON.parse(line));
				replied = true;
				if (!socket.destroyed && !socket.writableEnded) socket.end(ack);
			}
		});
		socket.on("close", () => {
			activeConnections -= 1;
		});
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, () => {
			server.off("error", reject);
			resolve();
		});
	});
	return {
		messages,
		async waitIdle(settleMs = 20) {
			const deadline = Date.now() + 2000;
			// Let setImmediate + kernel connect/write/ack complete.
			await new Promise((resolve) => setTimeout(resolve, settleMs));
			while (activeConnections > 0 && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
		},
		close() {
			return new Promise((resolve) => server.close(() => resolve()));
		},
	};
}

export function runIsolatedWorker(
	args,
	{
		prefix = "pi-host-worker-",
		timeout = 60000,
		maxBuffer,
		env: extraEnv,
		cwd,
		agentDir,
		setup,
		verify,
		checkResult,
	} = {},
) {
	const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	try {
		const dirs = {
			root,
			home: join(root, "home"),
			work: join(root, "work"),
			agent: join(root, "agent"),
			cache: join(root, "cache"),
		};
		for (const directory of [dirs.home, dirs.work, dirs.agent, dirs.cache]) {
			mkdirSync(directory, { recursive: true });
		}
		// Bound Pi's ancestor discovery without invoking git or reading outside the fixture.
		mkdirSync(join(dirs.work, ".git"), { recursive: true });
		const resolvedAgentDir =
			typeof agentDir === "function"
				? agentDir(dirs)
				: (agentDir ?? dirs.agent);
		mkdirSync(resolvedAgentDir, { recursive: true });
		const resolvedCwd =
			typeof cwd === "function" ? cwd(dirs) : (cwd ?? dirs.work);
		setup?.({ ...dirs, agent: resolvedAgentDir, cwd: resolvedCwd });
		const resolvedArgs = typeof args === "function" ? args(dirs) : args;
		const resolvedExtraEnv =
			typeof extraEnv === "function"
				? extraEnv({ ...dirs, agent: resolvedAgentDir, cwd: resolvedCwd })
				: extraEnv;
		const started = performance.now();
		const result = spawnSync(process.execPath, resolvedArgs, {
			cwd: resolvedCwd,
			// Intentionally no inherited credentials, NODE_OPTIONS/NODE_PATH, proxy,
			// multiplexer, provider, or extension configuration.
			env: {
				HOME: dirs.home,
				TMPDIR: root,
				XDG_CONFIG_HOME: join(dirs.home, ".config"),
				XDG_CACHE_HOME: dirs.cache,
				PI_CODING_AGENT_DIR: resolvedAgentDir,
				PI_OFFLINE: "1",
				PI_SKIP_VERSION_CHECK: "1",
				PI_TELEMETRY: "0",
				JITI_FS_CACHE: "false",
				NO_COLOR: "1",
				TERM: "dumb",
				...resolvedExtraEnv,
			},
			timeout,
			killSignal: "SIGKILL",
			...(maxBuffer !== undefined ? { maxBuffer } : {}),
			encoding: "utf8",
		});
		const elapsed = Math.round(performance.now() - started);
		if (checkResult) {
			checkResult(result, { elapsed, dirs });
		} else {
			assert.ifError(result.error);
			assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
		}
		verify?.({ ...dirs, agent: resolvedAgentDir, cwd: resolvedCwd }, result);
		return result;
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

export function runExtensionProbe(
	host,
	packageRoot,
	paths,
	{
		timeout = 60000,
		extraReadPaths = [],
		asPackage = false,
		packageFilters = {},
	} = {},
) {
	const worker = fileURLToPath(
		new URL("./load-extensions.mjs", import.meta.url),
	);
	const result = runIsolatedWorker(
		({ root }) => [
			"--permission",
			...new Set(
				[
					packageRoot,
					...extraReadPaths,
					host.modules,
					dirname(worker),
					root,
					process.execPath,
				].map((path) => `--allow-fs-read=${realpathSync(path)}`),
			),
			`--allow-fs-write=${root}`,
			worker,
			host.root,
			JSON.stringify(paths),
			...(asPackage ? ["package", JSON.stringify(packageFilters)] : []),
		],
		{
			prefix: "pi-extension-smoke-",
			timeout,
			maxBuffer: 1024 * 1024,
			checkResult(res, { elapsed }) {
				if (res.error) {
					throw new Error(
						[
							`Extension probe failed: ${res.error.message} after ${elapsed}ms (timeout ${timeout}ms)`,
							`Node ${process.version}: ${process.execPath}; Pi ${host.version}: ${host.root}`,
							`Extensions: ${JSON.stringify(paths)}`,
							`stdout:\n${res.stdout ?? ""}`,
							`stderr:\n${res.stderr ?? ""}`,
						].join("\n"),
						{ cause: res.error },
					);
				}
				assert.equal(
					res.status,
					0,
					`Extension probe failed (${res.signal ?? "exit"}):\n${res.stderr}\n${res.stdout}`,
				);
			},
		},
	);
	const line = result.stdout
		.split("\n")
		.find((entry) => entry.startsWith("PI_EXTENSION_SMOKE="));
	assert.ok(line, `Missing smoke report:\n${result.stdout}\n${result.stderr}`);
	return JSON.parse(line.slice("PI_EXTENSION_SMOKE=".length));
}

export function runSessionWorker(launcher, worker) {
	const host = resolvePiHost(launcher);
	const result = runIsolatedWorker(
		[fileURLToPath(worker), "worker", host.root],
		{
			prefix: "pi-session-host-",
			timeout: 30000,
		},
	);
	console.log(result.stdout.trim());
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
