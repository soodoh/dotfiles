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
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolvePiHost } from "./test-support/host-runtime.mjs";

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

// Versions belong in declarations/locks, not compatibility assertions. This
// covers imports and required APIs, not successful native background execution.
const requiredSpecifiers = HOST_PEER_ALIASES.map(({ specifier }) => specifier);

function assertAliasResolution(
	result,
	missing = [],
	specifiers = requiredSpecifiers,
) {
	assert.deepEqual([...result.missing].sort(), [...missing].sort());
	for (const specifier of specifiers) {
		assert.equal(
			Object.hasOwn(result.aliases, specifier),
			!missing.includes(specifier),
			`${specifier}: required aliases must resolve, missing ones must not have fallback targets`,
		);
	}
}

function inferPeerAlias(specifier) {
	const segments = specifier.split("/");
	const packageSegmentCount = specifier.startsWith("@") ? 2 : 1;
	return {
		specifier,
		pkg: segments.slice(0, packageSegmentCount).join("/"),
		subpath:
			segments.length === packageSegmentCount
				? "."
				: `./${segments.slice(packageSegmentCount).join("/")}`,
	};
}

function writeImportOnlyPeerPackages(modules, aliases, expectedAliases) {
	for (const pkg of new Set(aliases.map((entry) => entry.pkg))) {
		const directory = join(modules, pkg);
		mkdirSync(directory, { recursive: true });
		const exports = {};
		for (const { specifier, subpath } of aliases.filter(
			(entry) => entry.pkg === pkg,
		)) {
			const target = `./${subpath.replaceAll(/[./]/g, "_")}.mjs`;
			exports[subpath] = { types: "./absent.d.ts", import: target };
			writeFileSync(join(directory, target), "export const marker = true;\n");
			expectedAliases[specifier] = join(directory, target);
		}
		writeFileSync(
			join(directory, "package.json"),
			JSON.stringify({ name: pkg, version: "0.85.1", exports }),
		);
	}
}

test("installed subagents matches its declared pin and requires the native Pi host", () => {
	assert.equal(manifest.version, declared.dependencies["pi-subagents"]);
	assert.ok(
		requiredSpecifiers.includes(piName),
		"Native Pi host alias is required",
	);
	assert.equal(
		new Set(requiredSpecifiers).size,
		requiredSpecifiers.length,
		"Required aliases must be unique",
	);
});

test("historical isolated Pi layout: import-only exports resolve and missing dependencies fail closed", async (t) => {
	const temporary = mkdtempSync(join(tmpdir(), "pi-subagents-aliases-"));
	t.after(() => rmSync(temporary, { recursive: true, force: true }));
	// Historical fixture metadata, not a restriction on the actual host version.
	const modules = join(temporary, "node_modules/.mise/pi@0.85.1/node_modules");
	const host = join(modules, piName);
	const expectedAliases = {};
	const fixtureAliases = [...HOST_PEER_ALIASES];
	writeImportOnlyPeerPackages(modules, fixtureAliases, expectedAliases);
	// The resolver can add aliases conditionally for the pinned host version.
	// Build those packages too instead of assuming its exported base list is exhaustive.
	for (const specifier of resolveHostPeerAliases(host).missing) {
		fixtureAliases.push(inferPeerAlias(specifier));
	}
	writeImportOnlyPeerPackages(modules, fixtureAliases, expectedAliases);
	const fixtureSpecifiers = fixtureAliases.map(({ specifier }) => specifier);
	const result = resolveHostPeerAliases(host);
	assertAliasResolution(result, [], fixtureSpecifiers);
	assert.deepEqual(result.aliases, expectedAliases);
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
	// Several specifiers can share one target (e.g. pi-ai and pi-ai/compat).
	for (const target of new Set(Object.values(expectedAliases))) {
		const missing = Object.keys(expectedAliases).filter(
			(key) => expectedAliases[key] === target,
		);
		await t.test(`missing file: ${missing.join(", ")}`, () => {
			const source = readFileSync(target);
			rmSync(target);
			try {
				assertAliasResolution(
					resolveHostPeerAliases(host),
					missing,
					fixtureSpecifiers,
				);
			} finally {
				writeFileSync(target, source);
			}
		});
	}
	for (const pkg of new Set(fixtureAliases.map((entry) => entry.pkg))) {
		const packagePath = join(modules, pkg, "package.json");
		const source = readFileSync(packagePath, "utf8");
		const pkgManifest = JSON.parse(source);
		for (const subpath of Object.keys(pkgManifest.exports)) {
			const missing = fixtureAliases
				.filter((entry) => entry.pkg === pkg && entry.subpath === subpath)
				.map((entry) => entry.specifier);
			await t.test(`missing export: ${missing.join(", ")}`, () => {
				const modified = JSON.parse(source);
				delete modified.exports[subpath];
				writeFileSync(packagePath, JSON.stringify(modified));
				try {
					assertAliasResolution(
						resolveHostPeerAliases(host),
						missing,
						fixtureSpecifiers,
					);
				} finally {
					writeFileSync(packagePath, source);
				}
			});
		}
	}
	assertAliasResolution(resolveHostPeerAliases(host), [], fixtureSpecifiers);
});

// Optional actual-host integration: node subagents-host.test.mjs "$(mise which pi)"
// Do not execute the launcher or fall back to the development copy of Pi.
const launcher = process.argv[2];
test("actual mise launcher: all required host aliases import as native ESM", {
	skip: !launcher,
	timeout: 30000,
}, async (t) => {
	const { root, version, modules } = resolvePiHost(launcher);
	const hostModules = realpathSync(modules);
	t.diagnostic(`Pi ${version}; pi-subagents ${manifest.version}`);
	const result = resolveHostPeerAliases(root);
	assertAliasResolution(result);
	assert.equal(
		realpathSync(result.aliases[piName]),
		realpathSync(join(root, "dist/index.js")),
	);
	const developmentRoot = realpathSync(
		fileURLToPath(new URL("./node_modules/", import.meta.url)),
	);
	for (const [specifier, target] of Object.entries(result.aliases)) {
		assert.ok(
			realpathSync(target).startsWith(`${hostModules}/`),
			`${specifier}: must resolve inside the actual host installation`,
		);
		assert.ok(
			!realpathSync(target).startsWith(`${developmentRoot}/`),
			"must use the actual host, not development dependencies",
		);
		await import(pathToFileURL(target).href);
		t.diagnostic(`${specifier}: ${realpathSync(target)}`);
	}
	const pi = await import(pathToFileURL(result.aliases[piName]).href);
	assert.equal(typeof pi.createAgentSession, "function");
	assert.equal(typeof pi.ModelRuntime?.create, "function");
	t.diagnostic(`Node ${process.version}: ${process.execPath}; host: ${root}`);
});
