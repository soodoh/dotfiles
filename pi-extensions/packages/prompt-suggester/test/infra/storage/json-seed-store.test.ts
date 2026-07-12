import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	CURRENT_GENERATOR_VERSION,
	CURRENT_SEED_VERSION,
	SEEDER_PROMPT_VERSION,
	type SeedArtifact,
	SUGGESTION_PROMPT_VERSION,
} from "../../../src/domain/seed";
import { JsonSeedStore } from "../../../src/infra/storage/json-seed-store";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pi-seed-store-test-"));
	tempDirs.push(dir);
	return dir;
}

function validSeed(): SeedArtifact {
	return {
		seedVersion: CURRENT_SEED_VERSION,
		generatedAt: "2026-05-01T00:00:00.000Z",
		generatorVersion: CURRENT_GENERATOR_VERSION,
		seederPromptVersion: SEEDER_PROMPT_VERSION,
		suggestionPromptVersion: SUGGESTION_PROMPT_VERSION,
		configFingerprint: "fingerprint",
		projectIntentSummary: "intent",
		objectivesSummary: "objectives",
		constraintsSummary: "constraints",
		principlesGuidelinesSummary: "principles",
		implementationStatusSummary: "status",
		topObjectives: ["ship"],
		constraints: ["safe"],
		keyFiles: [
			{
				path: "README.md",
				hash: "hash",
				whyImportant: "entry point",
				category: "vision",
			},
		],
		categoryFindings: {
			vision: { found: true, rationale: "has readme", files: ["README.md"] },
			architecture: { found: false, rationale: "not present", files: [] },
			principles_guidelines: {
				found: false,
				rationale: "not present",
				files: [],
			},
		},
		openQuestions: [],
	};
}

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

describe("JsonSeedStore", () => {
	test("returns null for a missing seed file", async () => {
		const store = new JsonSeedStore(join(await tempDir(), "seed.json"));

		await expect(store.load()).resolves.toBeNull();
	});

	test("loads a valid persisted seed", async () => {
		const filePath = join(await tempDir(), "seed.json");
		const seed = validSeed();
		await writeFile(filePath, JSON.stringify(seed), "utf8");

		await expect(new JsonSeedStore(filePath).load()).resolves.toEqual(seed);
	});

	test("returns null for malformed seed JSON", async () => {
		const filePath = join(await tempDir(), "seed.json");
		await writeFile(filePath, "{not json", "utf8");

		await expect(new JsonSeedStore(filePath).load()).resolves.toBeNull();
	});

	test("returns null when persisted seed is missing keyFiles", async () => {
		const filePath = join(await tempDir(), "seed.json");
		const { keyFiles: _keyFiles, ...seedWithoutKeyFiles } = validSeed();
		await writeFile(filePath, JSON.stringify(seedWithoutKeyFiles), "utf8");

		await expect(new JsonSeedStore(filePath).load()).resolves.toBeNull();
	});
});
