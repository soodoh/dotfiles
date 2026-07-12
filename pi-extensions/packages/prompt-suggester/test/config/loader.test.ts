import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { FileConfigLoader } from "../../src/config/loader";

test("FileConfigLoader reads suggesterModel list from Pi agent settings", async () => {
	const cwd = await mkdtemp(path.join(os.tmpdir(), "suggester-cwd-"));
	const home = await mkdtemp(path.join(os.tmpdir(), "suggester-home-"));
	const settingsDir = path.join(home, ".pi", "agent");
	await mkdir(settingsDir, { recursive: true });
	await writeFile(
		path.join(settingsDir, "settings.json"),
		JSON.stringify({
			promptSuggester: {
				suggesterModel: ["openai/gpt-5.5", "anthropic/claude"],
			},
		}),
		"utf8",
	);

	const config = await new FileConfigLoader(cwd, home).load();

	expect(config.inference.suggesterModel).toEqual([
		"openai/gpt-5.5",
		"anthropic/claude",
	]);
});
