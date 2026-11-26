// Verify custom reporter loading and lifecycle behavior in disposable homes.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import {
	resolvePiHost,
	runIsolatedWorker,
} from "../../test-support/pi-host.mjs";

const packageDir = import.meta.dirname;
const repoRoot = resolve(packageDir, "../../..");
const launcher = process.argv[2];
assert.ok(launcher, 'Pass "$(mise which pi)" for actual-host tests');
resolvePiHost(launcher);

function runHost(mode, profile = "personal", { legacy = false } = {}) {
	const program =
		mode === "handoff"
			? "settled-handoff-host.test.mjs"
			: mode.startsWith("producer-")
				? "subagents-liveness-host.test.mjs"
				: "integration-host.test.mjs";
	const sentinel =
		'throw new Error("legacy notification hook must not load");\n';
	const legacyNames = ["herdr-agent-state", "moshi-hooks"];

	runIsolatedWorker([join(packageDir, program), launcher, mode, profile], {
		prefix: "agent-state-pi-test-",
		cwd: ({ home }) => home,
		agentDir: ({ home }) => join(home, ".pi/agent"),
		env: { PATH: "/usr/bin:/bin" },
		setup({ agent }) {
			symlinkSync(
				join(repoRoot, "pi-extensions"),
				join(agent, "pi-extensions"),
			);
			const extensionsDir = join(agent, "extensions");
			mkdirSync(extensionsDir, { recursive: true });
			writeFileSync(
				join(extensionsDir, "unrelated.ts"),
				"export default function () {}\n",
			);
			if (legacy) {
				for (const name of legacyNames) {
					writeFileSync(join(extensionsDir, `${name}.ts`), sentinel);
				}
			}
		},
		verify({ agent }) {
			if (legacy) {
				for (const name of legacyNames) {
					assert.equal(
						readFileSync(join(agent, "extensions", `${name}.ts`), "utf8"),
						sentinel,
					);
				}
			}
		},
	});
}

await test("profiles load package once with or without legacy copy", async (t) => {
	for (const legacy of [false, true]) {
		for (const profile of ["personal", "work"]) {
			await t.test(`legacy=${legacy} profile=${profile}`, () => {
				runHost("load", profile, { legacy });
			});
		}
	}
});

await test("lifecycle and prompt behavior", async (t) => {
	for (const mode of [
		"outside",
		"popup",
		"rpc",
		"json",
		"print",
		"child",
		"tui",
	]) {
		await t.test(`mode=${mode}`, () => {
			runHost(mode);
		});
	}
});

await test("native deferred wake waits for slow sibling without false completion", () => {
	runHost("handoff");
});

await test("full upstream registers and disposes in either extension order", async (t) => {
	for (const mode of ["producer-first", "producer-last"]) {
		await t.test(`mode=${mode}`, () => {
			runHost(mode);
		});
	}
});
