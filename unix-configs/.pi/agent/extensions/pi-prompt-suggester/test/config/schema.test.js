import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateConfig } from "../../dist/config/schema.js";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const defaultConfig = JSON.parse(
	await readFile(path.join(repoRoot, "prompt-suggester.config.json"), "utf8"),
);

test("validateConfig accepts shipped defaults", () => {
	assert.equal(validateConfig(defaultConfig), true);
});

test("validateConfig rejects unknown keys and invalid values", () => {
	assert.equal(validateConfig({ ...defaultConfig, extra: true }), false);
	assert.equal(
		validateConfig({
			...defaultConfig,
			suggestion: { ...defaultConfig.suggestion, maxSuggestionChars: 0 },
		}),
		false,
	);
	assert.equal(
		validateConfig({
			...defaultConfig,
			suggestion: { ...defaultConfig.suggestion, ghostAcceptKeys: [] },
		}),
		false,
	);
	assert.equal(
		validateConfig({
			...defaultConfig,
			suggestion: {
				...defaultConfig.suggestion,
				ghostAcceptKeys: ["space", "tab"],
			},
		}),
		false,
	);
});

test("validateConfig accepts supported ghost accept key combinations", () => {
	assert.deepEqual(defaultConfig.suggestion.ghostAcceptKeys, ["right"]);
	assert.deepEqual(defaultConfig.suggestion.ghostAcceptAndSendKeys, ["enter"]);
	assert.equal(
		validateConfig({
			...defaultConfig,
			suggestion: { ...defaultConfig.suggestion, ghostAcceptKeys: ["space"] },
		}),
		true,
	);
	assert.equal(
		validateConfig({
			...defaultConfig,
			suggestion: { ...defaultConfig.suggestion, ghostAcceptKeys: ["right"] },
		}),
		true,
	);
	assert.equal(
		validateConfig({
			...defaultConfig,
			suggestion: {
				...defaultConfig.suggestion,
				ghostAcceptKeys: ["space", "right"],
			},
		}),
		true,
	);
	assert.equal(
		validateConfig({
			...defaultConfig,
			suggestion: { ...defaultConfig.suggestion, ghostAcceptKeys: ["enter"] },
		}),
		true,
	);
	assert.equal(
		validateConfig({
			...defaultConfig,
			suggestion: {
				...defaultConfig.suggestion,
				ghostAcceptKeys: ["space", "right", "enter"],
			},
		}),
		true,
	);
	assert.equal(
		validateConfig({
			...defaultConfig,
			suggestion: {
				...defaultConfig.suggestion,
				ghostAcceptAndSendKeys: ["enter"],
			},
		}),
		true,
	);
});
