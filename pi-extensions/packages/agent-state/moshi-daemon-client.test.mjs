// Optional smoke-test client: real local adapter/transport against an unpaired daemon.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(new URL("../../package.json", import.meta.url));
const { createJiti } = await import(
	pathToFileURL(require.resolve("jiti")).href
);
const acknowledgments = [];
const sent = [];
const connect = net.createConnection;
net.createConnection = (...args) => {
	assert.equal(args[0], process.env.MOSHI_SOCKET_PATH);
	const socket = connect(...args);
	const write = socket.write.bind(socket);
	socket.write = (line) => {
		sent.push(JSON.parse(line));
		return write(line);
	};
	socket.on("data", (data) =>
		acknowledgments.push(JSON.parse(data.toString())),
	);
	return socket;
};
syncBuiltinESMExports();
const { createMoshi } = await createJiti(import.meta.url, {
	fsCache: false,
}).import(join(import.meta.dirname, "moshi.ts"));
const moshi = createMoshi();
const ctx = {
	cwd: process.env.HOME,
	sessionManager: {
		getSessionId: () => "fixture",
		getSessionFile: () => undefined,
	},
};
async function ack(action) {
	const count = acknowledgments.length;
	action();
	const deadline = Date.now() + 2000;
	while (acknowledgments.length === count && Date.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(acknowledgments.length, count + 1);
	assert.equal(acknowledgments.at(-1).type, "ack");
}
const state = () => {
	const matches = readdirSync(process.env.HOME, { recursive: true }).filter(
		(path) => path.endsWith("pi-sessions/fixture.json"),
	);
	assert.equal(matches.length, 1);
	return JSON.parse(readFileSync(join(process.env.HOME, matches[0]), "utf8"));
};
try {
	await ack(() => moshi.associate(ctx));
	await ack(() => moshi.update({ state: "working", previous: "idle" }, ctx));
	await ack(() => moshi.update({ state: "blocked", previous: "working" }, ctx));
	const requested = state().pendingPermissionAt;
	assert.ok(requested > 0);
	assert.equal(sent.at(-1).actionId, undefined);
	await ack(() => moshi.update({ state: "working", previous: "blocked" }, ctx));
	assert.ok(state().permissionResolvedAt >= requested);
	await ack(() =>
		moshi.update({ state: "idle", previous: "working", outcome: "stop" }, ctx),
	);
	assert.equal(state().completedPromptSequence, state().promptSequence);
	await ack(() => moshi.update({ state: "blocked", previous: "idle" }, ctx));
	await ack(() => moshi.update({ state: "idle", previous: "blocked" }, ctx));
	assert.ok(state().permissionResolvedAt >= state().pendingPermissionAt);
	assert.equal(sent.at(-1).phase, "idle");
	await ack(() => moshi.update({ state: "idle", outcome: "error" }, ctx));
	assert.equal(sent.at(-1).category, "error");
	assert.equal(
		sent.filter((message) => message.category === "task_complete").length,
		1,
	);
} finally {
	await moshi.close();
}
console.log(
	"PASS: real adapter/transport acknowledgments, input resolution and completion bookkeeping; no cloud delivery",
);
