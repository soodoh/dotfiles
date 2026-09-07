// Called in a disposable, credential-free HOME. Real Pi loader, event runner,
// native UI wrappers, and pi-subagents Herdr bridge; captured socket/CLI transport.
// No model, child process, rendered TUI, or live Herdr server.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolvePiHost } from "../../test-support/host-runtime.mjs";

const [launcher, mode, profile] = process.argv.slice(2);
assert.ok(["personal", "work"].includes(profile));
const root = resolve(import.meta.dirname, "../../..");
const settings = JSON.parse(
	readFileSync(
		join(root, `dotfiles/${profile}/pi/agent/settings.json`),
		"utf8",
	),
);
const entry = "packages/herdr-agent-state/index.ts";
const configuredPackage = settings.packages.find(
	(p) => p.source === "./pi-extensions",
);
const host = resolvePiHost(launcher);
const agentDir = process.env.PI_CODING_AGENT_DIR;
assert.ok(agentDir.startsWith(process.env.HOME));
mkdirSync(join(process.cwd(), ".git"), { recursive: true });
const requests = [];
const endpoint = join(process.env.HOME, "fake.sock");
if (mode !== "outside") {
	process.env.HERDR_ENV = "1";
	process.env.HERDR_SOCKET_PATH = endpoint;
	if (mode !== "popup") process.env.HERDR_PANE_ID = "w1:p1";
}
if (mode === "child") process.env.PI_SUBAGENT_CHILD = "1";
net.createConnection = (path) => {
	assert.equal(path, endpoint);
	const socket = new EventEmitter();
	socket.destroy = () => {};
	socket.write = (line) => {
		requests.push(JSON.parse(line));
		queueMicrotask(() => socket.emit("data", Buffer.from('{"ok":true}\n')));
	};
	queueMicrotask(() => socket.emit("connect"));
	return socket;
};
syncBuiltinESMExports();
const pi = await import(pathToFileURL(join(host.root, "dist/index.js")).href);
const bus = pi.createEventBus();
const requireSubagents = createRequire(
	join(root, "pi-extensions/node_modules/pi-subagents/package.json"),
);
const { createJiti } = await import(
	pathToFileURL(requireSubagents.resolve("jiti")).href
);
const jiti = createJiti(import.meta.url, { fsCache: false });
const { registerHerdrStatusBridge } = await jiti.import(
	join(
		root,
		"pi-extensions/node_modules/pi-subagents/src/integrations/herdr-status.ts",
	),
);
const { SUBAGENT_ASYNC_STARTED_EVENT, SUBAGENT_ASYNC_COMPLETE_EVENT } =
	await jiti.import(
		join(root, "pi-extensions/node_modules/pi-subagents/src/shared/types.ts"),
	);
const loader = new pi.DefaultResourceLoader({
	cwd: process.cwd(),
	agentDir,
	eventBus: bus,
	settingsManager: pi.SettingsManager.inMemory({
		packages: [
			{
				...configuredPackage,
				// Select all Herdr entries so an accidental second reporter is detected.
				extensions: configuredPackage.extensions.filter((p) =>
					p.startsWith("packages/herdr-"),
				),
				skills: [],
				prompts: [],
				themes: [],
			},
		],
		extensions: settings.extensions,
	}),
	noSkills: true,
	noPromptTemplates: true,
	noThemes: true,
	noContextFiles: true,
});
let idle = true;
let pendingMessages = false;
let file = join(agentDir, "sessions/example.jsonl");
let runner;
let runtime;
let bridge;
const activeRuns = new Map();
const eventErrors = [];
const pending = [];
const waitForAnswer = () => {
	const waiter = Promise.withResolvers();
	pending.push(waiter);
	return waiter.promise;
};
const tick = async () => {
	for (let n = 0; n < 3; n++)
		await new Promise((resolve) => setImmediate(resolve));
};
const states = () =>
	requests
		.filter((r) => r.method === "pane.report_agent")
		.map((r) => r.params.state);
const lastState = () => states().at(-1);
const dispatch = async (type, extra = {}) => {
	await runner.emit({ type, ...extra });
	await tick();
	assert.deepEqual(eventErrors, []);
};
async function load() {
	await loader.reload();
	const loaded = loader.getExtensions();
	assert.deepEqual(loaded.errors, []);
	assert.deepEqual(
		loaded.extensions.map((e) => realpathSync(e.resolvedPath)).sort(),
		[
			realpathSync(join(agentDir, "pi-extensions", entry)),
			realpathSync(join(agentDir, "extensions/unrelated.ts")),
		].sort(),
	);
	runtime = loaded.runtime;
	runner = new pi.ExtensionRunner(
		loaded.extensions,
		runtime,
		process.cwd(),
		{
			getSessionFile: () => file,
			getSessionId: () => "session-uuid",
		},
		{},
	);
	runner.bindCore(
		{},
		{ isIdle: () => idle, hasPendingMessages: () => pendingMessages },
	);
	runner.onError((error) => eventErrors.push(error));
	runner.setUIContext(
		{
			select: waitForAnswer,
			confirm: waitForAnswer,
			input: waitForAnswer,
			editor: waitForAnswer,
			custom: waitForAnswer,
		},
		["outside", "popup", "child"].includes(mode) ? "tui" : mode,
	);
	bridge = registerHerdrStatusBridge({
		events: bus,
		getRuns: () => activeRuns.values(),
		runHerdr() {},
		refreshMs: 0,
	});
}
async function shutdown() {
	await dispatch("session_shutdown", { reason: "reload" });
	bridge.dispose();
	await bridge.flush();
	runtime.invalidate();
}
function startRun(id) {
	const run = { id, agent: "fixture" };
	activeRuns.set(id, run);
	bus.emit(SUBAGENT_ASYNC_STARTED_EVENT, run);
}
function completeRun(id) {
	activeRuns.delete(id);
	bus.emit(SUBAGENT_ASYNC_COMPLETE_EVENT, { runId: id });
}

await load();
try {
	if (mode !== "load") {
		await dispatch("session_start", { reason: "startup" });
		bridge.sessionStarted({ hasUI: mode === "tui", runs: [] });
		await dispatch("resources_discover", { reason: "startup" });
		idle = false;
		await dispatch("agent_start");
		if (mode === "tui") {
			assert.equal(lastState(), "working");
			assert.equal(requests[0].params.agent_session_path, file);
			assert.equal(requests[0].params.session_start_source, "startup");
			await dispatch("agent_end");
			await dispatch("agent_settled");
			assert.equal(lastState(), "working");
			const before = states().length;
			startRun("one");
			startRun("two"); // Actual bridge lowers/re-raises its counted label.
			idle = true;
			await dispatch("agent_settled");
			completeRun("one");
			await tick();
			assert.deepEqual(states().slice(before), []);
			// pi-subagents' result watcher delivers before emitting completion.
			pendingMessages = true;
			completeRun("two");
			await tick();
			assert.deepEqual(states().slice(before), []);
			pendingMessages = false;
			idle = false;
			await dispatch("agent_start");
		}

		// Exercise Pi's actual coalescing wrappers, not fabricated prompt events.
		const ui = runner.getUIContext();
		for (const kind of ["select", "confirm", "input", "editor", "custom"]) {
			for (const outcome of ["answer", "cancel", "error"]) {
				const result = ui[kind]("sensitive fixture title", []);
				const completion = result.catch((error) => error.message);
				const waiter = pending.pop();
				await tick();
				if (mode === "tui") assert.equal(lastState(), "blocked");
				if (outcome === "error") waiter.reject(new Error("fixture failure"));
				else waiter.resolve(outcome === "cancel" ? undefined : "answer");
				await completion;
				await tick();
				if (mode === "tui") assert.equal(lastState(), "working");
			}
		}
		if (mode === "tui") {
			const first = ui.confirm("First", "fixture");
			const one = pending.pop();
			const second = ui.custom(() => {});
			const two = pending.pop();
			await tick();
			assert.equal(lastState(), "blocked");
			one.resolve(false);
			await first;
			await tick();
			assert.equal(lastState(), "blocked");
			bus.emit("herdr:blocked", { active: true });
			two.resolve(undefined);
			await second;
			await tick();
			assert.equal(lastState(), "blocked");
			idle = true;
			await dispatch("agent_settled");
			bus.emit("herdr:blocked", { active: false });
			await tick();
			assert.equal(lastState(), "idle");
			const count = requests.length;
			await dispatch("agent_settled");
			assert.equal(requests.length, count);

			// Fresh extension runtimes, with restored runs on either side of the
			// reporter's session_start handler. Idle must never escape during reload.
			startRun("survives-reload");
			await tick();
			const leavingDialog = ui.input("Leaving", "fixture");
			const leaving = pending.pop();
			await tick();
			for (const order of ["before", "after"]) {
				const before = states().length;
				await shutdown();
				leaving.resolve(undefined);
				await leavingDialog;
				await tick();
				assert.deepEqual(states().slice(before), []);
				file = undefined;
				await load();
				if (order === "before")
					bridge.sessionStarted({ hasUI: true, runs: activeRuns.values() });
				await dispatch("session_start", { reason: "reload" });
				if (order === "after")
					bridge.sessionStarted({ hasUI: true, runs: activeRuns.values() });
				await dispatch("resources_discover", { reason: "reload" });
				assert.deepEqual(states().slice(before), ["working"]);
				assert.equal(requests.at(-1).params.agent_session_id, "session-uuid");
				assert.equal(requests.at(-1).params.agent_session_path, undefined);
			}
			completeRun("survives-reload"); // No wake: genuinely finished.
			await tick();
			assert.equal(lastState(), "idle");
			assert.ok(!JSON.stringify(requests).includes("sensitive fixture title"));
			for (const request of requests) {
				assert.equal(request.params.pane_id, "w1:p1");
				assert.equal(request.params.source, "herdr:pi");
				assert.equal(request.params.agent, "pi");
			}
		} else {
			assert.deepEqual(requests, []);
		}
	}
} finally {
	await shutdown();
}
console.log(
	`PASS ${mode} (${profile}): single reporter; ${requests.length} captured reports`,
);
