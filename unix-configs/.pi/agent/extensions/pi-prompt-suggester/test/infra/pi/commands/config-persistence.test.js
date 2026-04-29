import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { projectOverridePath } from "../../../../dist/infra/pi/commands/config-persistence.js";
import { projectStateDir } from "../../../../dist/infra/pi/state-root.js";

test("projectOverridePath stores project config in global project state", () => {
	const cwd = "/tmp/repos/dotfiles";
	const home = "/Users/example";

	assert.equal(projectOverridePath(cwd, home), path.join(projectStateDir(cwd, { home }), "config.json"));
});
