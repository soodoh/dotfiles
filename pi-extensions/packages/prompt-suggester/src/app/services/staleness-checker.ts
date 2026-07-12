import type { PromptSuggesterConfig } from "../../config/types";
import {
	CURRENT_GENERATOR_VERSION,
	CURRENT_SEED_VERSION,
	SEEDER_PROMPT_VERSION,
	type SeedArtifact,
	type StalenessCheckResult,
	SUGGESTION_PROMPT_VERSION,
} from "../../domain/seed";
import type { FileHash } from "../ports/file-hash";
import type { VcsClient } from "../ports/vcs-client";
import { resolveProjectFile } from "./project-file";
import { computeConfigFingerprint } from "./seed-metadata";

interface StalenessCheckerDeps {
	config: PromptSuggesterConfig;
	fileHash: FileHash;
	vcs: VcsClient;
	cwd?: string;
}

export class StalenessChecker {
	private readonly configFingerprint: string;
	private readonly cwd: string;

	public constructor(private readonly deps: StalenessCheckerDeps) {
		this.configFingerprint = computeConfigFingerprint(deps.config);
		this.cwd = deps.cwd ?? process.cwd();
	}

	public async check(seed: SeedArtifact | null): Promise<StalenessCheckResult> {
		if (!seed) {
			return {
				stale: true,
				trigger: {
					reason: "initial_missing",
					changedFiles: [],
				},
			};
		}

		if (seed.configFingerprint !== this.configFingerprint) {
			const changedFiles = await this.collectChangedFiles(seed);
			return {
				stale: true,
				trigger: {
					reason: "config_changed",
					changedFiles,
					gitDiffSummary: await this.deps.vcs.getDiffSummary(
						changedFiles,
						this.deps.config.seed.maxDiffChars,
					),
				},
			};
		}

		if (
			seed.seedVersion !== CURRENT_SEED_VERSION ||
			seed.generatorVersion !== CURRENT_GENERATOR_VERSION ||
			seed.seederPromptVersion !== SEEDER_PROMPT_VERSION ||
			seed.suggestionPromptVersion !== SUGGESTION_PROMPT_VERSION
		) {
			const changedFiles = await this.collectChangedFiles(seed);
			return {
				stale: true,
				trigger: {
					reason: "generator_changed",
					changedFiles,
					gitDiffSummary: await this.deps.vcs.getDiffSummary(
						changedFiles,
						this.deps.config.seed.maxDiffChars,
					),
				},
			};
		}

		const changedKeyFiles: string[] = [];
		for (const keyFile of seed.keyFiles) {
			const resolved = await resolveProjectFile(this.cwd, keyFile.path);
			if (!resolved) {
				changedKeyFiles.push(keyFile.path);
				continue;
			}
			try {
				const currentHash = await this.deps.fileHash.hashFile(
					resolved.absolutePath,
				);
				if (currentHash !== keyFile.hash) changedKeyFiles.push(keyFile.path);
			} catch {
				changedKeyFiles.push(keyFile.path);
			}
		}

		if (changedKeyFiles.length > 0) {
			return {
				stale: true,
				trigger: {
					reason: "key_file_changed",
					changedFiles: changedKeyFiles,
					gitDiffSummary: await this.deps.vcs.getDiffSummary(
						changedKeyFiles,
						this.deps.config.seed.maxDiffChars,
					),
				},
			};
		}

		return { stale: false };
	}

	private async collectChangedFiles(seed: SeedArtifact): Promise<string[]> {
		const files = new Set<string>();
		for (const file of await this.deps.vcs.getWorkingTreeStatus())
			files.add(file);
		if (seed.sourceCommit) {
			for (const file of await this.deps.vcs.getChangedFilesSinceCommit(
				seed.sourceCommit,
			))
				files.add(file);
		}
		return Array.from(files);
	}
}
