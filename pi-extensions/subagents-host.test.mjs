import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const extensionRoot = fileURLToPath(
	new URL("./node_modules/pi-subagents/", import.meta.url),
);
const manifest = JSON.parse(
	readFileSync(join(extensionRoot, "package.json"), "utf8"),
);
const declared = JSON.parse(
	readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
const requireExtension = createRequire(join(extensionRoot, "package.json"));
const { createJiti } = await import(
	pathToFileURL(requireExtension.resolve("jiti")).href
);
const jiti = createJiti(import.meta.url);
const { HOST_PEER_ALIASES, resolveHostPeerAliases } = await jiti.import(
	join(extensionRoot, "src/runs/background/runner-aliases.ts"),
);
const piName = "@earendil-works/pi-coding-agent";

// Deliberately pins the reviewed rollback contract. Requalify when upgrading.
test("the installed package matches the temporary native-session rollback", () => {
	assert.equal(declared.dependencies["pi-subagents"], "0.65.0");
	assert.equal(manifest.version, "0.65.0");
	assert.equal(HOST_PEER_ALIASES.length, 10);
	const factory = readFileSync(
		join(extensionRoot, "src/runs/shared/child-session.ts"),
		"utf8",
	);
	assert.match(factory, /pi\.createAgentSession\(/);
});

test("isolated Pi 0.85.1 needs no supplemental server/client; missing targets fail closed", async (t) => {
	const temporary = mkdtempSync(join(tmpdir(), "pi-subagents-aliases-"));
	t.after(() => rmSync(temporary, { recursive: true, force: true }));
	const modules = join(temporary, "node_modules/.mise/pi@0.85.1/node_modules");
	const host = join(modules, piName);
	for (const pkg of new Set(HOST_PEER_ALIASES.map((entry) => entry.pkg))) {
		const directory = join(modules, pkg);
		mkdirSync(directory, { recursive: true });
		const exports = {};
		for (const { subpath } of HOST_PEER_ALIASES.filter(
			(entry) => entry.pkg === pkg,
		)) {
			const target = `./${subpath.replaceAll(/[./]/g, "_")}.mjs`;
			exports[subpath] = { types: "./absent.d.ts", import: target };
			writeFileSync(join(directory, target), "export const marker = true;\n");
		}
		writeFileSync(
			join(directory, "package.json"),
			JSON.stringify({ name: pkg, version: "0.85.1", exports }),
		);
	}
	const result = resolveHostPeerAliases(host);
	assert.deepEqual(result.missing, []);
	assert.equal(Object.keys(result.aliases).length, 10);
	for (const target of Object.values(result.aliases)) {
		assert.ok(
			target.startsWith(`${modules}/`),
			"must not use extension/global peers",
		);
		assert.equal((await import(pathToFileURL(target).href)).marker, true);
	}
	// CommonJS resolution rejects this valid import-only export; use the real helper.
	assert.throws(
		() => createRequire(join(host, "package.json")).resolve(piName),
		{ code: "ERR_PACKAGE_PATH_NOT_EXPORTED" },
	);
	rmSync(result.aliases[piName]);
	assert.deepEqual(resolveHostPeerAliases(host).missing, [piName]);
});

// Optional actual-host integration: node subagents-host.test.mjs "$(mise which pi)"
// Do not execute the launcher or fall back to the development copy of Pi.
const launcher = process.argv[2];
test("actual mise launcher: all required host aliases import as native ESM", {
	skip: !launcher,
	timeout: 30000,
}, async (t) => {
	let entry = realpathSync(launcher);
	const wrapperTarget = readFileSync(entry, "utf8").match(
		/^# aube-bin-shim v2 target=(.+)$/m,
	)?.[1];
	if (wrapperTarget)
		entry = realpathSync(resolve(dirname(entry), wrapperTarget));
	let root = dirname(entry);
	for (;;) {
		let pkg;
		try {
			pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
		} catch {
			/* Not a package root. */
		}
		if (pkg?.name === piName) break;
		assert.notEqual(
			dirname(root),
			root,
			"unrecognized Pi launcher; refusing development-package fallback",
		);
		root = dirname(root);
	}
	assert.equal(
		JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
		"0.85.1",
	);
	const result = resolveHostPeerAliases(root);
	assert.deepEqual(result.missing, []);
	assert.equal(Object.keys(result.aliases).length, 10);
	assert.equal(
		realpathSync(result.aliases[piName]),
		realpathSync(join(root, "dist/index.js")),
	);
	const developmentRoot = realpathSync(
		fileURLToPath(new URL("./node_modules/", import.meta.url)),
	);
	for (const [specifier, target] of Object.entries(result.aliases)) {
		assert.ok(
			!realpathSync(target).startsWith(`${developmentRoot}/`),
			"must use the actual host, not development dependencies",
		);
		await import(pathToFileURL(target).href);
		t.diagnostic(`${specifier}: ${realpathSync(target)}`);
	}
	const pi = await import(pathToFileURL(result.aliases[piName]).href);
	assert.equal(typeof pi.createAgentSession, "function");
	assert.equal(typeof pi.ModelRuntime.create, "function");
	t.diagnostic(`Node ${process.version}: ${process.execPath}; host: ${root}`);
});
