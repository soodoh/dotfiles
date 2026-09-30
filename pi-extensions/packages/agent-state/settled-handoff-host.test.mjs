// Actual session lifecycle: a deferred wake and a slow settled sibling. The
// producer retains authoritative activity until the wake starts; no child spawn.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	createSessionFixture,
	runSessionWorker,
} from "../../test-support/session-host.mjs";

if (process.argv[2] !== "worker") {
	runSessionWorker(process.argv[2], new URL(import.meta.url));
} else {
	process.env.HERDR_ENV = "1";
	process.env.HERDR_SOCKET_PATH = join(process.env.HOME, "herdr.sock");
	process.env.HERDR_PANE_ID = "w1:p1";
	process.env.MOSHI_SOCKET_PATH = join(process.env.HOME, "moshi.sock");
	const reports = [];
	net.createConnection = (path) => {
		const socket = new EventEmitter();
		socket.destroy = () => {};
		socket.end = () => {};
		socket.write = (line) => {
			reports.push({ path, data: JSON.parse(line) });
			queueMicrotask(() => socket.emit("data", Buffer.from('{"ok":true}\n')));
		};
		queueMicrotask(() => socket.emit("connect"));
		return socket;
	};
	syncBuiltinESMExports();
	const requireSubagents = createRequire(
		fileURLToPath(
			new URL("../../node_modules/pi-subagents/package.json", import.meta.url),
		),
	);
	const { createJiti } = await import(
		pathToFileURL(requireSubagents.resolve("jiti")).href
	);
	const jiti = createJiti(import.meta.url, { fsCache: false });
	const { registerPiWebSessionLiveness } = await jiti.import(
		fileURLToPath(
			new URL(
				"../../node_modules/pi-subagents/src/integrations/pi-web-session-liveness.js",
				import.meta.url,
			),
		),
	);
	const states = () =>
		reports
			.filter((r) => r.data.method === "pane.report_agent")
			.map((r) => r.data.params.state);
	const completions = () =>
		reports.filter((r) => r.data.category === "task_complete");
	const entered = Promise.withResolvers();
	const releaseSibling = Promise.withResolvers();
	const firstResponse = Promise.withResolvers();
	let wakePending = false;
	let wakeRequested = false;
	let starts = 0;
	let requests = 0;
	let releaseActivity = () => {};
	let settleObservation;
	const fixture = await createSessionFixture(process.argv[3], {
		paths: [fileURLToPath(new URL("./index.ts", import.meta.url))],
		mode: "tui",
		factories: [
			(pi) => {
				pi.on("session_start", (_event, ctx) => {
					const activity = registerPiWebSessionLiveness({
						sessionId: ctx.sessionManager.getSessionId(),
						isActive: () => wakePending,
					});
					assert.equal(activity.registered, true);
					releaseActivity = activity.release;
				});
				pi.on("agent_start", () => {
					if (++starts > 1) wakePending = false;
				});
				pi.on("agent_settled", (_event, ctx) => {
					if (wakeRequested) return;
					wakeRequested = true;
					wakePending = true;
					pi.sendMessage(
						{
							customType: "handoff-fixture",
							content: "Consume the completion",
							display: false,
						},
						{ triggerTurn: true },
					);
					settleObservation = {
						idle: ctx.isIdle(),
						pending: ctx.hasPendingMessages(),
					};
				});
			},
			(pi) => {
				pi.on("agent_settled", async () => {
					if (requests !== 1) return;
					entered.resolve();
					await releaseSibling.promise;
				});
			},
		],
		respond: async () => {
			if (++requests === 1) await firstResponse.promise;
			return { content: [{ type: "text", text: "Done" }] };
		},
	});
	try {
		const running = fixture.session.prompt("Initial work");
		while (!requests) await new Promise((resolve) => setImmediate(resolve));
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(states().at(-1), "working");
		const before = states().length;
		firstResponse.resolve();
		await entered.promise;
		// Longer than the observer's polling interval; this is a deterministic
		// test barrier, not a production notification cooldown.
		await new Promise((resolve) => setTimeout(resolve, 350));
		assert.equal(requests, 1, "Pi did not defer the settled wake");
		assert.deepEqual(
			settleObservation,
			{ idle: true, pending: false },
			"Native deferred actions changed visibility; revisit the liveness requirement",
		);
		assert.ok(!states().slice(before).includes("idle"));
		assert.deepEqual(completions(), []);
		releaseSibling.resolve();
		await running;
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(requests, 2);
		assert.equal(starts, 2);
		assert.deepEqual(states().slice(before), ["idle"]);
		assert.equal(completions().length, 1);
		assert.deepEqual(fixture.errors, []);
		await fixture.session.extensionRunner.emit({
			type: "session_shutdown",
			reason: "quit",
		});
	} finally {
		releaseActivity();
		fixture.session.dispose();
	}
	console.log(
		"PASS agent state: native deferred settled wake, slow sibling and authoritative handoff liveness",
	);
}
