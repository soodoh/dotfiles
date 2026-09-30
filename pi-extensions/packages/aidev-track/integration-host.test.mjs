// Native tool pipeline and continuations; fixture model and attribution CLI.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	createSessionFixture,
	runSessionWorker,
} from "../../test-support/session-host.mjs";

if (process.argv[2] !== "worker") {
	runSessionWorker(process.argv[2], new URL(import.meta.url));
} else {
	const hostRoot = process.argv[3];
	const requireHost = createRequire(join(hostRoot, "package.json"));
	const { createJiti } = await import(
		pathToFileURL(requireHost.resolve("jiti")).href
	);
	const jiti = createJiti(import.meta.url, { fsCache: false });
	const { createAidevTrackExtension, runAidevTrack } = await jiti.import(
		fileURLToPath(new URL("./aidev-track.ts", import.meta.url)),
	);
	// Real streams/processes reproduce the asynchronous EPIPE that a mock write
	// throwing cannot cover. The fixture never launches the workstation CLI.
	const subprocess = (code) => (_command, _args, options) =>
		spawn(process.execPath, ["-e", code], options);
	assert.equal(
		await runAidevTrack(
			{
				spawn: subprocess(
					"process.stdin.destroy(); setTimeout(() => process.exit(1), 100)",
				),
				timeoutMs: 2000,
			},
			"turn-start",
			{ prompt: "x".repeat(1000000) },
			process.cwd(),
		),
		"error",
	);
	assert.equal(
		await runAidevTrack(
			{ spawn: subprocess("process.exit(7)"), timeoutMs: 2000 },
			"turn-end",
			{},
			process.cwd(),
		),
		"error",
	);
	assert.equal(
		await runAidevTrack(
			{
				spawn: subprocess(
					"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
				),
				timeoutMs: 100,
			},
			"checkpoint",
			{},
			process.cwd(),
		),
		"timeout",
	);
	const calls = [];
	let active = 0;
	const tracking = createAidevTrackExtension({
		timeoutMs: 1000,
		spawn: (_command, args) => {
			assert.equal(active++, 0, "Attribution processes overlapped");
			const child = new EventEmitter();
			child.kill = () => {
				child.emit("close", null);
			};
			child.stdin = new EventEmitter();
			child.stdin.end = (payload) => {
				const input = JSON.parse(payload);
				let file;
				try {
					file = readFileSync(input.tool_input?.file_path, "utf8");
				} catch {
					/* pristine new file */
				}
				calls.push({ command: args[0], input, file });
				setImmediate(() => {
					active--;
					child.emit("close", 0);
				});
			};
			return child;
		},
	});
	let response = 0;
	// SDK sessions do not load codemode implicitly. Use the host's builtin.
	const { createCodemodeExtension } = await import(
		pathToFileURL(join(hostRoot, "dist/index.js")).href
	);
	const fixture = await createSessionFixture(hostRoot, {
		factories: [tracking, createCodemodeExtension()],
		tools: ["write", "edit", "codemode"],
		respond: (_model, _context, options) => {
			assert.ok(options.apiKey);
			response++;
			if (response === 1)
				return {
					stopReason: "toolUse",
					content: [
						{
							type: "toolCall",
							id: "outer",
							name: "codemode",
							arguments: {
								code: 'await Promise.all([tools.write({path:"a.txt",content:"first"}),tools.write({path:"a.txt",content:"second"})]);',
							},
						},
					],
				};
			if (response === 3)
				return {
					stopReason: "toolUse",
					content: [
						{
							type: "toolCall",
							id: "edit",
							name: "edit",
							arguments: {
								path: "a.txt",
								edits: [{ oldText: "second", newText: "continued" }],
							},
						},
					],
				};
			return { content: [{ type: "text", text: "Done" }] };
		},
	});
	try {
		await fixture.session.prompt("Write the file");
		assert.equal(readFileSync("a.txt", "utf8"), "second");
		assert.equal(calls[0].command, "turn-start");
		assert.equal(calls[1].input.hook_event_name, "PreToolUse");
		assert.equal(calls[1].file, undefined);
		assert.equal(calls.at(-1).command, "turn-end");
		assert.equal(
			calls.filter((call) => call.command === "checkpoint").length,
			4,
		);
		const boundary = calls.length;
		await fixture.session.sendCustomMessage(
			{
				customType: "completion",
				content: "Background work finished",
				display: false,
			},
			{ triggerTurn: true },
		);
		assert.equal(readFileSync("a.txt", "utf8"), "continued");
		assert.deepEqual(
			calls.slice(boundary).map((call) => call.command),
			["turn-start", "checkpoint", "checkpoint", "turn-end"],
		);
		assert.deepEqual(fixture.errors, []);
	} finally {
		fixture.session.dispose();
	}
	console.log(
		"PASS aidev-track: native codemode concurrency, continuation baselines and subprocess failures",
	);
}
