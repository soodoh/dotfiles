// Called by integration.test.py in a fresh, credential-free temporary HOME.
// Real installed Pi loader, event runner and UI-prompt wrappers; injected dialogs
// and socket transport. No model, rendered TUI, or live Herdr server.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
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
const entries = [
	"packages/herdr-agent-state/index.ts",
	"packages/herdr-ui-prompts/index.ts",
];
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
net.createConnection = (path) => {
	assert.equal(path, endpoint); // Fail closed on any unexpected network path.
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
const blocks = [];
bus.on("herdr:blocked", (data) => blocks.push(data.active));
const loader = new pi.DefaultResourceLoader({
	cwd: process.cwd(),
	agentDir,
	eventBus: bus,
	// Exercise the actual package manifest and both profile filters, isolating
	// Herdr from unrelated packages covered by extensions-host.test.mjs.
	settingsManager: pi.SettingsManager.inMemory({
		packages: [
			{
				...configuredPackage,
				extensions: configuredPackage.extensions.filter((p) =>
					entries.includes(p),
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
await loader.reload();
const { extensions, errors, runtime } = loader.getExtensions();
assert.deepEqual(errors, []);
assert.deepEqual(
	extensions.map((e) => realpathSync(e.resolvedPath)).sort(),
	[
		...entries.map((entry) =>
			realpathSync(join(agentDir, "pi-extensions", entry)),
		),
		realpathSync(join(agentDir, "extensions/unrelated.ts")),
	].sort(),
);

if (mode === "load") {
	runtime.invalidate();
	console.log(`PASS ${mode} (${profile})`);
	process.exit(0);
}
let idle = true;
let file = join(agentDir, "sessions/example.jsonl");
const runner = new pi.ExtensionRunner(
	extensions,
	runtime,
	process.cwd(),
	{
		getSessionFile: () => file,
		getSessionId: () => "session-uuid",
	},
	{},
);
runner.bindCore({}, { isIdle: () => idle });
const eventErrors = [];
runner.onError((error) => eventErrors.push(error));
const pending = [];
const waitForAnswer = () => {
	const prompt = Promise.withResolvers();
	pending.push(prompt);
	return prompt.promise;
};
runner.setUIContext(
	{
		select: waitForAnswer,
		confirm: waitForAnswer,
		input: waitForAnswer,
		editor: waitForAnswer,
		custom: waitForAnswer,
	},
	mode === "outside" || mode === "popup" ? "tui" : mode,
);
const ui = runner.getUIContext();
const tick = () => new Promise((resolve) => setImmediate(resolve));
const dispatch = async (type, extra = {}) => {
	await runner.emit({ type, ...extra });
	await tick();
	assert.deepEqual(eventErrors, []);
};
const lastState = () =>
	requests.filter((r) => r.method === "pane.report_agent").at(-1)?.params.state;

try {
	await dispatch("session_start", { reason: "startup" });
	idle = false;
	await dispatch("agent_start");
	if (mode === "tui") {
		assert.equal(lastState(), "working");
		const registration = requests.find(
			(r) => r.method === "pane.report_agent_session",
		);
		assert.equal(registration.params.agent_session_path, file);
		assert.equal(registration.params.session_start_source, "startup");
		await dispatch("agent_end");
		await dispatch("agent_settled");
		assert.equal(lastState(), "working"); // A busy low-level run is not settled.
	}

	// Drive actual ctx.ui wrappers and native event dispatch, not synthetic
	// ui_prompt_start/end calls. Each waiter resolves normally, cancels, or fails.
	for (const kind of ["select", "confirm", "input", "editor", "custom"]) {
		for (const result of ["answer", "cancel", "error"]) {
			const before = blocks.length;
			const promise = ui[kind]("sensitive fixture title", []);
			const completion = promise.catch((error) => error.message);
			const prompt = pending.pop();
			await tick();
			if (mode === "tui") assert.equal(lastState(), "blocked");
			if (result === "error") prompt.reject(new Error("fixture failure"));
			else prompt.resolve(result === "cancel" ? undefined : "answer");
			await completion;
			await tick();
			assert.deepEqual(
				blocks.slice(before),
				mode === "tui" ? [true, false] : [],
			);
			if (mode === "tui") assert.equal(lastState(), "working");
		}
	}

	if (mode === "tui") {
		const before = blocks.length;
		const first = ui.confirm("First", "fixture");
		const one = pending.pop();
		const second = ui.custom(() => {});
		const two = pending.pop();
		await tick();
		assert.deepEqual(blocks.slice(before), [true]); // Native overlapping-span coalescing.
		one.resolve(false);
		await first;
		await tick();
		assert.equal(lastState(), "blocked");
		assert.deepEqual(blocks.slice(before), [true]);
		// Independent producer, matching pi-subagents' counted attention contract.
		bus.emit("herdr:blocked", {
			active: true,
			label: "subagent needs attention",
		});
		two.resolve(undefined);
		await second;
		await tick();
		assert.equal(lastState(), "blocked"); // Closing UI must not clear subagent attention.
		idle = true;
		await dispatch("agent_settled");
		assert.equal(lastState(), "blocked");
		bus.emit("herdr:blocked", { active: false });
		await tick();
		assert.equal(lastState(), "idle");
		const count = requests.length;
		await dispatch("agent_settled");
		assert.equal(requests.length, count);

		// Shutdown/reload cleanup with an unresolved dialog and independent block.
		const dialog = ui.input("Leaving", "fixture");
		const leaving = pending.pop();
		await tick();
		bus.emit("herdr:blocked", { active: true });
		await dispatch("session_shutdown", { reason: "reload" });
		assert.equal(lastState(), "blocked");
		bus.emit("herdr:blocked", { active: false });
		await tick();
		assert.equal(lastState(), "idle");
		const released = blocks.length;
		leaving.resolve(undefined);
		await dialog;
		await tick();
		assert.equal(blocks.length, released); // Late end must not release again.
		file = undefined;
		idle = false;
		await dispatch("session_start", { reason: "reload" });
		assert.equal(lastState(), "working");
		assert.equal(requests.at(-1).params.agent_session_id, "session-uuid");
		assert.equal(requests.at(-1).params.agent_session_path, undefined);
		const resumed = ui.select("After reload", []);
		const answer = pending.pop();
		await tick();
		assert.equal(lastState(), "blocked");
		answer.resolve("ok");
		await resumed;
		await tick();
		assert.equal(lastState(), "working");
		for (const request of requests) {
			assert.equal(request.params.pane_id, "w1:p1");
			assert.equal(request.params.source, "herdr:pi");
			assert.equal(request.params.agent, "pi");
		}
		assert.ok(!JSON.stringify(requests).includes("sensitive fixture title"));
	} else {
		assert.deepEqual(requests, []); // Even fake RPC dialogs have hasUI=true.
	}
	assert.deepEqual(eventErrors, []);
} finally {
	await dispatch("session_shutdown", { reason: "quit" });
	runtime.invalidate();
}
process.stdout.write(
	`PASS ${mode}: native-loaded reporter and prompt bridge; ${requests.length} captured reports\n`,
);
