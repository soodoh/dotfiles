// Factory-load smoke only: never create a session, dispatch lifecycle events,
// invoke tools, resolve credentials, or prompt a model. This process runs with
// Node permissions (no subprocesses, workers, addons, or external writes).
// Network is not blocked on LTS; PI_OFFLINE is best-effort, not network isolation.
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { hideDeniedExistenceChecks } from "./exists-sync.mjs";

const [hostRoot, pathsJSON] = process.argv.slice(2);
assert.ok(
	process.permission,
	"Run through the permission-restricted test harness",
);
for (const scope of ["child", "worker", "addons"]) {
	assert.equal(
		process.permission.has(scope),
		false,
		`Unexpected permission: ${scope}`,
	);
}
// Node throws for denied existsSync probes, including Linux platform detection.
// Hide inaccessible paths without granting access or bypassing real I/O denials.
fs.existsSync = hideDeniedExistenceChecks(fs.existsSync);
syncBuiltinESMExports();
const pi = await import(pathToFileURL(join(hostRoot, "dist/index.js")).href);
const loader = new pi.DefaultResourceLoader({
	cwd: process.cwd(),
	agentDir: process.env.PI_CODING_AGENT_DIR,
	settingsManager: pi.SettingsManager.inMemory({ packages: [] }),
	noExtensions: true,
	noSkills: true,
	noPromptTemplates: true,
	noThemes: true,
	noContextFiles: true,
	additionalExtensionPaths: JSON.parse(pathsJSON),
});
await loader.reload();
const { extensions, errors } = loader.getExtensions();
const report = {
	errors,
	resourceDiagnostics: [
		...loader.getSkills().diagnostics,
		...loader.getPrompts().diagnostics,
		...loader.getThemes().diagnostics,
	],
	extensions: extensions.map((extension) => ({
		path: extension.resolvedPath,
		tools: [...extension.tools.keys()],
		commands: [...extension.commands.keys()],
		flags: [...extension.flags.keys()],
	})),
};
process.stdout.write(`PI_EXTENSION_SMOKE=${JSON.stringify(report)}\n`);
// Do not force exit: unexpected persistent startup resources must hit the parent
// timeout, rather than producing a false pass. With no session, no shutdown event
// is due. The parent removes the disposable directory after process termination.
