// Run with: mise exec -- node pi-extensions/extensions-host.test.mjs "$(mise which pi)"
// Registration/import coverage, not session_start, tools, services, UI, or native
// background execution. Keep subagents-host.test.mjs and manual native completion.
// Node permissions guard accidental startup effects, not malicious dependencies.
import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hideDeniedExistenceChecks } from "./test-support/exists-sync.mjs";
import {
	resolvePiHost,
	runExtensionProbe,
} from "./test-support/host-runtime.mjs";
import {
	assertLoaded,
	manifestResources,
	resourceLabel,
} from "./test-support/manifest-resources.mjs";

const packageRoot = realpathSync(fileURLToPath(new URL(".", import.meta.url)));
const host = resolvePiHost(process.argv[2]);
assert.ok(
	!host.root.startsWith(`${join(packageRoot, "node_modules")}/`),
	"Must use the mise host, not development Pi",
);

function fixture(t) {
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "pi-extension-fixture-")),
	);
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
}

function manifest(root, pi) {
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({ name: "smoke-fixture", type: "module", pi }),
	);
}

await test("host discovery handles npm symlinks and mise wrappers without fallback", (t) => {
	const root = fixture(t);
	const modules = join(root, "node_modules");
	const packageDir = join(modules, "@earendil-works/pi-coding-agent");
	mkdirSync(join(packageDir, "dist"), { recursive: true });
	mkdirSync(join(modules, ".bin"));
	writeFileSync(
		join(packageDir, "package.json"),
		JSON.stringify({
			name: "@earendil-works/pi-coding-agent",
			version: "fixture",
		}),
	);
	const entry = join(packageDir, "dist/cli.js");
	writeFileSync(entry, "// fixture: must never execute\n");
	const launcher = join(modules, ".bin/pi");
	symlinkSync(entry, launcher);
	assert.deepEqual(resolvePiHost(launcher), {
		root: packageDir,
		entry,
		version: "fixture",
		modules,
	});
	rmSync(launcher);
	writeFileSync(
		launcher,
		"#!/bin/sh\n# aube-bin-shim v2 target=../@earendil-works/pi-coding-agent/dist/cli.js\nexit 99\n",
	);
	assert.equal(resolvePiHost(launcher).root, packageDir);
	const unrelated = join(root, "unrelated");
	writeFileSync(unrelated, "not Pi");
	assert.throws(
		() => resolvePiHost(unrelated),
		/no development-package fallback/,
	);
	assert.throws(() => resolvePiHost(), /actual launcher/);
});

await test("resource discovery follows manifest edits and rejects missing resources", (t) => {
	const root = fixture(t);
	for (const name of ["a.ts", "b.ts"])
		writeFileSync(join(root, name), "export default () => {};\n");
	manifest(root, { extensions: ["./a.ts"] });
	assert.deepEqual(manifestResources(root).extensions, [join(root, "a.ts")]);
	manifest(root, { extensions: ["./b.ts"] });
	assert.deepEqual(manifestResources(root).extensions, [join(root, "b.ts")]);
	manifest(root, { extensions: ["*.ts", "!a.ts"] });
	assert.deepEqual(manifestResources(root).extensions, [join(root, "b.ts")]);
	manifest(root, { extensions: ["absent.ts"] });
	assert.throws(() => manifestResources(root), /missing or unmatched/);
	manifest(root, { skills: ["absent-skills"] });
	assert.throws(() => manifestResources(root), /missing or unmatched/);
	mkdirSync(join(root, "empty-skills"));
	manifest(root, { skills: ["empty-skills"] });
	assert.throws(() => manifestResources(root), /no usable resources/);
});

await test("existence checks hide only permission denials", () => {
	for (const error of [new Error("unexpected"), { code: "EIO" }]) {
		const existsSync = hideDeniedExistenceChecks(() => {
			throw error;
		});
		assert.throws(
			() => existsSync("fixture"),
			(caught) => caught === error,
		);
	}
});

await test("actual host: alias identity and permission/credential isolation", (t) => {
	const root = fixture(t);
	const extensions = join(root, "extensions");
	mkdirSync(extensions);
	const privateFile = join(root, "private");
	writeFileSync(privateFile, "unchanged");
	const path = join(extensions, "isolation.ts");
	writeFileSync(
		path,
		`
		import assert from "node:assert/strict";
		import fs, { existsSync, readFileSync, writeFileSync } from "node:fs";
		import { spawnSync } from "node:child_process";
		import { Worker } from "node:worker_threads";
		import { getPackageDir } from "@earendil-works/pi-coding-agent";
		export default function () {
			assert.equal(getPackageDir(), ${JSON.stringify(host.root)});
			assert.equal(process.env.PI_SMOKE_TEST_SECRET, undefined);
			for (const exists of [existsSync, fs.existsSync]) {
				assert.equal(exists(${JSON.stringify(path)}), true);
				assert.equal(exists(${JSON.stringify(join(extensions, "absent"))}), false);
				assert.equal(exists(${JSON.stringify(privateFile)}), false);
			}
			assert.throws(() => process.dlopen({}, ${JSON.stringify(privateFile)}), { code: "ERR_DLOPEN_DISABLED" });
			assert.throws(() => readFileSync(${JSON.stringify(privateFile)}), { code: "ERR_ACCESS_DENIED" });
			assert.throws(() => writeFileSync(${JSON.stringify(privateFile)}, "changed"), { code: "ERR_ACCESS_DENIED" });
			assert.throws(() => spawnSync(process.execPath, ["-e", "process.exit(0)"]), { code: "ERR_ACCESS_DENIED" });
			assert.throws(() => new Worker("", { eval: true }), { code: "ERR_ACCESS_DENIED" });
		}
	`,
	);
	const previous = process.env.PI_SMOKE_TEST_SECRET;
	process.env.PI_SMOKE_TEST_SECRET = "must-not-reach-child";
	try {
		assertLoaded(
			runExtensionProbe(host, extensions, [path]),
			"isolation fixture",
		);
	} finally {
		if (previous === undefined) delete process.env.PI_SMOKE_TEST_SECRET;
		else process.env.PI_SMOKE_TEST_SECRET = previous;
	}
	assert.equal(readFileSync(privateFile, "utf8"), "unchanged");
});

await test("actual host: invalid exports, unresolved imports, and factory errors fail", (t) => {
	const root = fixture(t);
	const paths = [
		["invalid.ts", "export default 42;"],
		["unresolved.ts", 'import "./absent.ts"; export default () => {};'],
		[
			"throwing.ts",
			'export default () => { throw new Error("factory fixture"); };',
		],
	].map(([name, source]) => {
		const path = join(root, name);
		writeFileSync(path, source);
		return path;
	});
	const report = runExtensionProbe(host, root, paths);
	assert.equal(report.extensions.length, 0);
	assert.deepEqual(
		report.errors.map((error) => error.path).sort(),
		paths.sort(),
	);
	assert.throws(() => assertLoaded(report, "bad fixtures"), /load diagnostics/);
	assert.throws(
		() =>
			assertLoaded(
				{ errors: [], resourceDiagnostics: [], extensions: [] },
				"empty",
			),
		/silently loaded no extensions/,
	);
});

await test("actual host: combined loader detects conflicting registrations", (t) => {
	const root = fixture(t);
	const paths = ["a.ts", "b.ts"].map((name) => {
		const path = join(root, name);
		writeFileSync(
			path,
			'export default (pi) => pi.registerFlag("smoke-conflict", { type: "boolean" });',
		);
		return path;
	});
	const report = runExtensionProbe(host, root, paths);
	assert.equal(report.extensions.length, 2);
	assert.ok(
		report.errors.some((error) =>
			/smoke-conflict.*conflicts/.test(error.error),
		),
	);
});

await test("actual host reports malformed declared resources", (t) => {
	const root = fixture(t);
	writeFileSync(join(root, "index.ts"), "export default () => {};\n");
	writeFileSync(join(root, "broken.json"), "not JSON");
	manifest(root, { extensions: ["./index.ts"], themes: ["./broken.json"] });
	const report = runExtensionProbe(host, root, [root]);
	assert.equal(report.extensions.length, 1);
	assert.equal(report.resourceDiagnostics.length, 1);
	assert.throws(
		() => assertLoaded(report, "broken theme"),
		/resource diagnostics/,
	);
});

await test("unexpected persistent startup work is terminated, not reported as a pass", (t) => {
	const root = fixture(t);
	const path = join(root, "persistent.ts");
	writeFileSync(
		path,
		"export default () => { setInterval(() => {}, 1000); };\n",
	);
	assert.throws(
		() => runExtensionProbe(host, root, [path], { timeout: 3000 }),
		/ETIMEDOUT/,
	);
});

await test("manifest resources load with the actual mise Pi", async (t) => {
	t.diagnostic(`Node ${process.version}; Pi ${host.version}: ${host.root}`);
	const resources = manifestResources(packageRoot);
	const expected = new Set();
	for (const path of resources.extensions) {
		await t.test(resourceLabel(packageRoot, path), () => {
			const report = runExtensionProbe(host, packageRoot, [path]);
			assertLoaded(report, path);
			for (const extension of report.extensions)
				expected.add(realpathSync(extension.path));
		});
	}
	await t.test(
		"combined manifest: no missing extensions or registration conflicts",
		() => {
			const report = runExtensionProbe(host, packageRoot, [packageRoot]);
			assert.deepEqual(
				report.errors,
				[],
				"combined manifest: Pi extension-load diagnostics",
			);
			assert.deepEqual(
				report.resourceDiagnostics,
				[],
				"combined manifest: Pi resource diagnostics",
			);
			assert.deepEqual(
				new Set(
					report.extensions.map((extension) => realpathSync(extension.path)),
				),
				expected,
			);
		},
	);
	t.diagnostic(
		`Resources: ${Object.entries(resources)
			.map(([kind, paths]) => `${paths.length} ${kind}`)
			.join(", ")}`,
	);
});
