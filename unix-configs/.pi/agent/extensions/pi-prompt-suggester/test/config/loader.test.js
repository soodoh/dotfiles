import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileConfigLoader } from "../../dist/config/loader.js";
import { projectStateDir } from "../../dist/infra/pi/state-root.js";

test("FileConfigLoader reads project override config from global project state", async () => {
	const cwd = await mkdtemp(path.join(os.tmpdir(), "suggester-cwd-"));
	const home = await mkdtemp(path.join(os.tmpdir(), "suggester-home-"));
	const stateDir = projectStateDir(cwd, { home });
	await mkdir(stateDir, { recursive: true });
	await writeFile(
		path.join(stateDir, "config.json"),
		JSON.stringify({ suggestion: { maxSuggestionChars: 321 } }),
		"utf8",
	);

	const config = await new FileConfigLoader(cwd, home).load();

	assert.equal(config.suggestion.maxSuggestionChars, 321);
});
