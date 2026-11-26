// Real Pi loader + full unmodified pi-subagents entrypoint in a disposable HOME.
// No model calls, child launches, workstation services or live notifications.
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	createHostJiti,
	resolvePiHost,
	startUnixJsonServer,
} from "../../test-support/pi-host.mjs";

const [launcher, order] = process.argv.slice(2);
const root = resolve(import.meta.dirname, "../../..");
const host = resolvePiHost(launcher);
assert.ok(process.env.PI_CODING_AGENT_DIR.startsWith(process.env.HOME));
const moshiEndpoint = join(process.env.TMPDIR, "m.sock");
const moshiServer = await startUnixJsonServer(moshiEndpoint, { ack: "{}\n" });
process.env.MOSHI_SOCKET_PATH = moshiEndpoint;
const pi = await import(pathToFileURL(join(host.root, "dist/index.js")).href);
const bus = pi.createEventBus();
const paths = [
	join(root, "pi-extensions/node_modules/pi-subagents/index.js"),
	join(root, "pi-extensions/packages/agent-state/index.ts"),
];
if (order === "producer-last") paths.reverse();
const loader = new pi.DefaultResourceLoader({
	cwd: process.cwd(),
	agentDir: process.env.PI_CODING_AGENT_DIR,
	eventBus: bus,
	settingsManager: pi.SettingsManager.inMemory({ packages: [] }),
	noExtensions: true,
	additionalExtensionPaths: paths,
	noSkills: true,
	noPromptTemplates: true,
	noThemes: true,
	noContextFiles: true,
});
const jiti = await createHostJiti(
	join(root, "pi-extensions/node_modules/pi-subagents/package.json"),
	{ callerUrl: import.meta.url },
);
const { createLiveness } = await jiti.import(
	join(root, "pi-extensions/packages/agent-state/liveness.ts"),
);
const session = pi.SessionManager.inMemory(process.cwd());
const sessionId = session.getSessionId();
const errors = [];
const notifications = [];
let observer;
try {
	for (const reason of ["startup", "reload"]) {
		await loader.reload();
		const loaded = loader.getExtensions();
		assert.deepEqual(loaded.errors, []);
		assert.deepEqual(
			loaded.extensions.map((extension) => extension.resolvedPath),
			paths,
		);
		// Do not let this observer create the registry and mask a broken factory.
		assert.equal(
			globalThis[Symbol.for("@agegr/pi-web/session-liveness/v1")]?.version,
			1,
		);
		observer ??= createLiveness();
		assert.equal(observer.read(sessionId), undefined);
		const runner = new pi.ExtensionRunner(
			loaded.extensions,
			loaded.runtime,
			process.cwd(),
			session,
			{},
		);
		// Upstream selects tools on session_start; bind the loaded registry rather
		// than returning an empty list that would skip its activation behavior.
		const tools = loaded.extensions.flatMap((extension) =>
			[...extension.tools.values()].map(({ definition }) => definition),
		);
		let activeTools = tools
			.filter((tool) =>
				["direct", "model-only"].includes(tool.exposure ?? "direct"),
			)
			.map((tool) => tool.name);
		runner.bindCore(
			{
				getThinkingLevel: () => "off",
				refreshTools() {},
				getAllTools: () => tools,
				getActiveTools: () => [...activeTools],
				setActiveTools: (names) => {
					activeTools = [...new Set(names)].filter((name) =>
						tools.some(
							(tool) => tool.name === name && tool.exposure !== "hidden",
						),
					);
				},
			},
			{
				getModel: () => undefined,
				getScopedModels: () => [],
				isIdle: () => true,
				hasPendingMessages: () => false,
				isProjectTrusted: () => false,
				getSignal: () => new AbortController().signal,
			},
		);
		runner.onError((error) => errors.push(error));
		runner.setUIContext(
			{
				notify: (message) => notifications.push(message),
				setStatus() {},
				setWidget() {},
			},
			"tui",
		);
		try {
			await runner.emit({ type: "session_start", reason });
			await runner.emit({
				type: "resources_discover",
				cwd: process.cwd(),
				reason,
			});
			await new Promise((resolve) => setImmediate(resolve));
			assert.deepEqual(errors, []);
			assert.equal(
				observer.read(sessionId),
				false,
				"full upstream entrypoint must register its provider",
			);
			assert.ok(
				!notifications.some((message) =>
					message.includes("liveness unavailable"),
				),
			);
		} finally {
			await runner.emit({ type: "session_shutdown", reason: "reload" });
			loaded.runtime.invalidate();
		}
		assert.equal(
			observer.read(sessionId),
			undefined,
			"upstream must dispose the provider on shutdown",
		);
	}
} finally {
	observer?.close();
	await moshiServer.close();
}
assert.deepEqual(errors, []);
assert.equal(
	globalThis[Symbol.for("@agegr/pi-web/session-liveness/v1")],
	undefined,
);
console.log(
	`PASS upstream liveness registration/restoration/disposal (${order})`,
);
