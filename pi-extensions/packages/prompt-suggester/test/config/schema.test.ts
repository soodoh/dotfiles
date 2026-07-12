import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { normalizeConfig, validateConfig } from "../../src/config/schema";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const defaultConfig = JSON.parse(
	await readFile(path.join(repoRoot, "prompt-suggester.config.json"), "utf8"),
);

test("validateConfig accepts shipped defaults", () => {
	expect(validateConfig(defaultConfig)).toBe(true);
});

test("validateConfig rejects non-objects, unknown keys, and invalid values", () => {
	expect(validateConfig(undefined)).toBe(false);
	expect(validateConfig({ ...defaultConfig, schemaVersion: -1 })).toBe(false);
	expect(validateConfig({ ...defaultConfig, extra: true })).toBe(false);
	expect(
		validateConfig({
			...defaultConfig,
			suggestion: { ...defaultConfig.suggestion, maxSuggestionChars: 0 },
		}),
	).toBe(false);
	expect(
		validateConfig({
			...defaultConfig,
			suggestion: { ...defaultConfig.suggestion, ghostAcceptKeys: [] },
		}),
	).toBe(false);
	expect(
		validateConfig({
			...defaultConfig,
			suggestion: {
				...defaultConfig.suggestion,
				ghostAcceptKeys: ["space", "tab"],
			},
		}),
	).toBe(false);
	expect(
		validateConfig({
			...defaultConfig,
			inference: {
				...defaultConfig.inference,
				suggesterModel: "session-default",
			},
		}),
	).toBe(false);
	expect(validateConfig({ ...defaultConfig, seed: null })).toBe(false);
	expect(
		validateConfig({
			...defaultConfig,
			seed: { ...defaultConfig.seed, extra: true },
		}),
	).toBe(false);
});

test("normalizeConfig returns unchanged defaults when no config exists", () => {
	expect(normalizeConfig(undefined, defaultConfig)).toEqual({
		config: defaultConfig,
		changed: false,
	});
});

test("normalizeConfig fills defaults and reports unsupported or invalid values", () => {
	const normalized = normalizeConfig(
		{
			schemaVersion: defaultConfig.schemaVersion,
			seed: { ...defaultConfig.seed, maxDiffChars: 1500, extra: true },
			suggestion: {
				...defaultConfig.suggestion,
				maxSuggestionChars: 0,
			},
		},
		defaultConfig,
	);

	expect(normalized.changed).toBe(true);
	expect(normalized.config.seed.maxDiffChars).toBe(1500);
	expect(normalized.config.suggestion.maxSuggestionChars).toBe(
		defaultConfig.suggestion.maxSuggestionChars,
	);
	expect(normalized.config.reseed).toEqual(defaultConfig.reseed);
});

test("validateConfig accepts supported ghost accept key combinations", () => {
	expect(defaultConfig.suggestion.ghostAcceptKeys).toEqual(["right"]);
	expect(defaultConfig.suggestion.ghostAcceptAndSendKeys).toEqual(["enter"]);
	expect(
		validateConfig({
			...defaultConfig,
			suggestion: { ...defaultConfig.suggestion, ghostAcceptKeys: ["space"] },
		}),
	).toBe(true);
	expect(
		validateConfig({
			...defaultConfig,
			suggestion: { ...defaultConfig.suggestion, ghostAcceptKeys: ["right"] },
		}),
	).toBe(true);
	expect(
		validateConfig({
			...defaultConfig,
			suggestion: {
				...defaultConfig.suggestion,
				ghostAcceptKeys: ["space", "right"],
			},
		}),
	).toBe(true);
	expect(
		validateConfig({
			...defaultConfig,
			suggestion: { ...defaultConfig.suggestion, ghostAcceptKeys: ["enter"] },
		}),
	).toBe(true);
	expect(
		validateConfig({
			...defaultConfig,
			suggestion: {
				...defaultConfig.suggestion,
				ghostAcceptKeys: ["space", "right", "enter"],
			},
		}),
	).toBe(true);
	expect(
		validateConfig({
			...defaultConfig,
			suggestion: {
				...defaultConfig.suggestion,
				ghostAcceptAndSendKeys: ["enter"],
			},
		}),
	).toBe(true);
});
