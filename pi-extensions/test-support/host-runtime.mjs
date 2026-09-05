import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

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

export function runExtensionProbe(
	host,
	packageRoot,
	paths,
	{ timeout = 30000 } = {},
) {
	const temporary = realpathSync(
		mkdtempSync(join(tmpdir(), "pi-extension-smoke-")),
	);
	const worker = fileURLToPath(
		new URL("./load-extensions.mjs", import.meta.url),
	);
	try {
		for (const directory of ["home", "work", "agent", "cache"])
			mkdirSync(join(temporary, directory));
		// Bound Pi's ancestor discovery without invoking git or reading outside the fixture.
		mkdirSync(join(temporary, "work/.git"));
		const result = spawnSync(
			process.execPath,
			[
				"--permission",
				...new Set(
					[
						packageRoot,
						host.modules,
						dirname(worker),
						temporary,
						process.execPath,
					].map((path) => `--allow-fs-read=${realpathSync(path)}`),
				),
				`--allow-fs-write=${temporary}`,
				worker,
				host.root,
				JSON.stringify(paths),
			],
			{
				cwd: join(temporary, "work"),
				// Intentionally no inherited credentials, NODE_OPTIONS/NODE_PATH, proxy,
				// tmux, provider, or extension configuration. Network is not blocked on LTS.
				env: {
					HOME: join(temporary, "home"),
					TMPDIR: temporary,
					XDG_CONFIG_HOME: join(temporary, "home/.config"),
					XDG_CACHE_HOME: join(temporary, "cache"),
					PI_CODING_AGENT_DIR: join(temporary, "agent"),
					PI_OFFLINE: "1",
					PI_SKIP_VERSION_CHECK: "1",
					PI_TELEMETRY: "0",
					JITI_FS_CACHE: "false",
					NO_COLOR: "1",
					TERM: "dumb",
				},
				timeout,
				killSignal: "SIGKILL",
				maxBuffer: 1024 * 1024,
				encoding: "utf8",
			},
		);
		assert.ifError(result.error);
		assert.equal(
			result.status,
			0,
			`Extension probe failed (${result.signal ?? "exit"}):\n${result.stderr}\n${result.stdout}`,
		);
		const line = result.stdout
			.split("\n")
			.find((line) => line.startsWith("PI_EXTENSION_SMOKE="));
		assert.ok(
			line,
			`Missing smoke report:\n${result.stdout}\n${result.stderr}`,
		);
		return JSON.parse(line.slice("PI_EXTENSION_SMOKE=".length));
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}
