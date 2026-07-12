import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { ReseedRunner } from "../../src/app/orchestrators/reseed-runner";
import { computeConfigFingerprint } from "../../src/app/services/seed-metadata";
import { StalenessChecker } from "../../src/app/services/staleness-checker";
import type { PromptSuggesterConfig } from "../../src/config/types";
import {
	CURRENT_GENERATOR_VERSION,
	CURRENT_SEED_VERSION,
	SEEDER_PROMPT_VERSION,
	type SeedArtifact,
	SUGGESTION_PROMPT_VERSION,
} from "../../src/domain/seed";
import type { SuggestionUsage } from "../../src/domain/suggestion";

function createConfig(): PromptSuggesterConfig {
	return {
		schemaVersion: 8,
		seed: { maxDiffChars: 3000 },
		reseed: {
			enabled: true,
			checkOnSessionStart: true,
			checkAfterEveryTurn: true,
			turnCheckInterval: 10,
		},
		suggestion: {
			noSuggestionToken: "[no suggestion]",
			customInstruction: "",
			fastPathContinueOnError: true,
			ghostAcceptKeys: ["right"],
			ghostAcceptAndSendKeys: ["enter"],
			maxAssistantTurnChars: 100000,
			maxRecentUserPrompts: 20,
			maxRecentUserPromptChars: 500,
			maxToolSignals: 8,
			maxToolSignalChars: 240,
			maxTouchedFiles: 8,
			maxUnresolvedQuestions: 6,
			maxAbortContextChars: 280,
			maxSuggestionChars: 200,
			prefillOnlyWhenEditorEmpty: true,
			showUsageInPanel: true,
			showPanelStatus: true,
			strategy: "compact",
			transcriptMaxContextPercent: 70,
			transcriptMaxMessages: 120,
			transcriptMaxChars: 120000,
			transcriptRolloutPercent: 100,
		},
		steering: {
			historyWindow: 20,
			acceptedThreshold: 0.82,
			maxChangedExamples: 3,
		},
		logging: { level: "info" },
		inference: {
			seederModel: "session-default",
			suggesterModel: ["session-default"],
			seederThinking: "session-default",
			suggesterThinking: "session-default",
		},
	};
}

function createSeed(
	config: PromptSuggesterConfig,
	keyFiles: SeedArtifact["keyFiles"],
): SeedArtifact {
	return {
		seedVersion: CURRENT_SEED_VERSION,
		generatedAt: "2026-03-15T00:00:00.000Z",
		sourceCommit: "abc123",
		generatorVersion: CURRENT_GENERATOR_VERSION,
		seederPromptVersion: SEEDER_PROMPT_VERSION,
		suggestionPromptVersion: SUGGESTION_PROMPT_VERSION,
		configFingerprint: computeConfigFingerprint(config),
		projectIntentSummary: "intent",
		objectivesSummary: "objectives",
		constraintsSummary: "constraints",
		principlesGuidelinesSummary: "principles",
		implementationStatusSummary: "status",
		topObjectives: [],
		constraints: [],
		keyFiles,
		openQuestions: [],
	};
}

const usage: SuggestionUsage = {
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	totalTokens: 0,
	costTotal: 0,
};

test("ReseedRunner refuses to hash model-selected key files that symlink outside cwd", async () => {
	const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-suggester-cwd-"));
	const outside = await mkdtemp(
		path.join(os.tmpdir(), "pi-suggester-outside-"),
	);
	await mkdir(path.join(cwd, "src"));
	await writeFile(
		path.join(cwd, "src", "inside.ts"),
		"export const ok = true;\n",
	);
	await writeFile(path.join(outside, "secret.ts"), "secret\n");
	await symlink(path.join(outside, "secret.ts"), path.join(cwd, "leak.ts"));

	const config = createConfig();
	const hashedPaths: string[] = [];
	let savedSeed: SeedArtifact | undefined;
	let queued: Promise<void> | undefined;
	const runner = new ReseedRunner({
		config,
		seedStore: {
			async load() {
				return null;
			},
			async save(seed) {
				savedSeed = seed;
			},
		},
		stateStore: {
			async load() {
				throw new Error("state load is not used by reseed runner");
			},
			async save() {},
			async recordUsage() {},
		},
		modelClient: {
			async generateSeed() {
				return {
					seed: {
						projectIntentSummary: "intent",
						objectivesSummary: "objectives",
						constraintsSummary: "constraints",
						principlesGuidelinesSummary: "principles",
						implementationStatusSummary: "status",
						topObjectives: [],
						constraints: [],
						keyFiles: [
							{
								path: "leak.ts",
								whyImportant: "outside symlink",
								category: "other",
							},
							{
								path: "src/inside.ts",
								whyImportant: "inside file",
								category: "code_entrypoint",
							},
						],
						openQuestions: [],
					},
					usage,
				};
			},
			async generateSuggestion() {
				throw new Error("suggestion generation is not used by reseed runner");
			},
		},
		taskQueue: {
			enqueue(_name, task) {
				queued = task();
				return queued;
			},
			isRunning() {
				return false;
			},
		},
		logger: {
			debug() {},
			info() {},
			warn() {},
			error() {},
		},
		fileHash: {
			async hashFile(filePath) {
				hashedPaths.push(filePath);
				return filePath.endsWith("inside.ts") ? "inside-hash" : "outside-hash";
			},
		},
		vcs: {
			async getHeadCommit() {
				return null;
			},
			async getChangedFilesSinceCommit() {
				return [];
			},
			async getDiffSummary() {
				return undefined;
			},
			async getWorkingTreeStatus() {
				return [];
			},
		},
		cwd,
	});

	await runner.trigger({ reason: "manual", changedFiles: [] });
	await queued;

	expect(savedSeed?.keyFiles).toEqual([
		{
			path: path.join("src", "inside.ts"),
			hash: "inside-hash",
			whyImportant: "inside file",
			category: "code_entrypoint",
		},
	]);
	expect(hashedPaths).toEqual([
		path.join(await realpath(cwd), "src", "inside.ts"),
	]);
});

test("StalenessChecker treats seed schema version mismatch as stale", async () => {
	const config = createConfig();
	let diffPaths: string[] = [];
	const checker = new StalenessChecker({
		config,
		fileHash: {
			async hashFile() {
				throw new Error("hashFile should not be called for version staleness");
			},
		},
		vcs: {
			async getHeadCommit() {
				return null;
			},
			async getChangedFilesSinceCommit() {
				return ["src/versioned.ts"];
			},
			async getDiffSummary(paths) {
				diffPaths = paths;
				return `diff:${paths.join(",")}`;
			},
			async getWorkingTreeStatus() {
				return ["README.md"];
			},
		},
	});

	const result = await checker.check({
		...createSeed(config, []),
		seedVersion: CURRENT_SEED_VERSION - 1,
	});

	expect(result).toEqual({
		stale: true,
		trigger: {
			reason: "generator_changed",
			changedFiles: ["README.md", "src/versioned.ts"],
			gitDiffSummary: "diff:README.md,src/versioned.ts",
		},
	});
	expect(diffPaths).toEqual(["README.md", "src/versioned.ts"]);
});

test("StalenessChecker treats persisted symlink traversal key files as changed without hashing them", async () => {
	const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-suggester-cwd-"));
	const outside = await mkdtemp(
		path.join(os.tmpdir(), "pi-suggester-outside-"),
	);
	await writeFile(path.join(outside, "secret.ts"), "secret\n");
	await symlink(path.join(outside, "secret.ts"), path.join(cwd, "leak.ts"));

	const config = createConfig();
	const hashedPaths: string[] = [];
	const checker = new StalenessChecker({
		config,
		fileHash: {
			async hashFile(filePath) {
				hashedPaths.push(filePath);
				return "same-hash";
			},
		},
		vcs: {
			async getHeadCommit() {
				return null;
			},
			async getChangedFilesSinceCommit() {
				return [];
			},
			async getDiffSummary(paths) {
				return `diff:${paths.join(",")}`;
			},
			async getWorkingTreeStatus() {
				return [];
			},
		},
		cwd,
	});

	const result = await checker.check(
		createSeed(config, [
			{
				path: "leak.ts",
				hash: "same-hash",
				whyImportant: "outside symlink",
				category: "other",
			},
		]),
	);

	expect(result).toEqual({
		stale: true,
		trigger: {
			reason: "key_file_changed",
			changedFiles: ["leak.ts"],
			gitDiffSummary: "diff:leak.ts",
		},
	});
	expect(hashedPaths).toEqual([]);
});
