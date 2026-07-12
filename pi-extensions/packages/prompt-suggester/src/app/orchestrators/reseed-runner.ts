import { toInvocationThinkingLevel } from "../../config/inference";
import type { PromptSuggesterConfig } from "../../config/types";
import {
	CURRENT_GENERATOR_VERSION,
	CURRENT_SEED_VERSION,
	type ReseedTrigger,
	SEEDER_PROMPT_VERSION,
	type SeedArtifact,
	type SeedDraft,
	SUGGESTION_PROMPT_VERSION,
} from "../../domain/seed";
import type { SuggestionUsage } from "../../domain/suggestion";
import { normalizeSuggestionUsage } from "../../domain/usage";
import type { FileHash } from "../ports/file-hash";
import type { Logger } from "../ports/logger";
import type { ModelClient } from "../ports/model-client";
import type { SeedStore } from "../ports/seed-store";
import type { StateStore } from "../ports/state-store";
import type { TaskQueue } from "../ports/task-queue";
import type { VcsClient } from "../ports/vcs-client";
import { resolveProjectFile } from "../services/project-file";
import { computeConfigFingerprint } from "../services/seed-metadata";

function createRunId(): string {
	return `seed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === "object" && value !== null;
}

function isSuggestionUsage(value: unknown): value is SuggestionUsage {
	return (
		isRecord(value) &&
		typeof value.inputTokens === "number" &&
		typeof value.outputTokens === "number" &&
		typeof value.cacheReadTokens === "number" &&
		typeof value.cacheWriteTokens === "number" &&
		typeof value.totalTokens === "number" &&
		typeof value.costTotal === "number"
	);
}

function usageFromError(error: unknown): SuggestionUsage | undefined {
	if (!isRecord(error) || !isSuggestionUsage(error.usage)) return undefined;
	return normalizeSuggestionUsage(error.usage);
}

interface ReseedRunnerDeps {
	config: PromptSuggesterConfig;
	seedStore: SeedStore;
	stateStore: StateStore;
	modelClient: ModelClient;
	taskQueue: TaskQueue;
	logger: Logger;
	fileHash: FileHash;
	vcs: VcsClient;
	cwd?: string;
}

export class ReseedRunner {
	private running = false;
	private pendingTrigger: ReseedTrigger | null = null;
	private consecutiveFailureCount = 0;
	private readonly cwd: string;
	private readonly configFingerprint: string;

	public constructor(private readonly deps: ReseedRunnerDeps) {
		this.cwd = deps.cwd ?? process.cwd();
		this.configFingerprint = computeConfigFingerprint(deps.config);
	}

	public async trigger(trigger: ReseedTrigger): Promise<void> {
		if (!this.deps.config.reseed.enabled) return;
		if (this.running) {
			this.pendingTrigger = this.mergeTriggers(this.pendingTrigger, trigger);
			this.deps.logger.info("reseed.pending", {
				reason: trigger.reason,
				changedFiles: trigger.changedFiles,
			});
			return;
		}

		this.running = true;
		void this.deps.taskQueue
			.enqueue("suggester:reseed", async () => {
				await this.processTriggerLoop(trigger);
			})
			.catch((error) => {
				this.deps.logger.error("reseed.queue.failed", {
					error: errorMessage(error),
				});
			})
			.finally(() => {
				this.running = false;
			});
	}

	private async processTriggerLoop(
		initialTrigger: ReseedTrigger,
	): Promise<void> {
		let nextTrigger: ReseedTrigger | null = initialTrigger;
		while (nextTrigger) {
			const current = nextTrigger;
			nextTrigger = null;
			const runId = createRunId();
			this.deps.logger.info("reseed.started", {
				runId,
				reason: current.reason,
				changedFiles: current.changedFiles,
			});

			try {
				const previousSeed = await this.deps.seedStore.load();
				const seedResult = await this.deps.modelClient.generateSeed({
					reseedTrigger: current,
					previousSeed,
					settings: {
						modelRef:
							this.deps.config.inference.seederModel === "session-default"
								? undefined
								: this.deps.config.inference.seederModel,
						thinkingLevel: toInvocationThinkingLevel(
							this.deps.config.inference.seederThinking,
						),
					},
					runId,
				});
				await this.recordSeederUsage(seedResult.usage);
				const seed = await this.finalizeSeed(seedResult.seed, current);
				await this.deps.seedStore.save(seed);
				this.consecutiveFailureCount = 0;
				this.deps.logger.info("reseed.completed", {
					runId,
					reason: current.reason,
					keyFiles: seed.keyFiles.map((file) => file.path),
					categoryFindings: seed.categoryFindings,
					tokens: seedResult.usage?.totalTokens,
					cost: seedResult.usage?.costTotal,
				});
			} catch (error) {
				const usage = this.extractUsageFromError(error);
				if (usage) {
					await this.recordSeederUsage(usage);
				}
				this.consecutiveFailureCount += 1;
				const meta = {
					runId,
					reason: current.reason,
					error: errorMessage(error),
					tokens: usage?.totalTokens,
					cost: usage?.costTotal,
					consecutiveFailures: this.consecutiveFailureCount,
				};
				if (this.consecutiveFailureCount >= 3) {
					this.deps.logger.error("reseed.failed", meta);
				} else {
					this.deps.logger.debug("reseed.failed", meta);
				}
			}

			if (this.pendingTrigger) {
				nextTrigger = this.pendingTrigger;
				this.pendingTrigger = null;
			}
		}
	}

	private async recordSeederUsage(
		usage: SuggestionUsage | undefined,
	): Promise<void> {
		if (!usage) return;
		await this.deps.stateStore.recordUsage("seeder", usage);
	}

	private extractUsageFromError(error: unknown): SuggestionUsage | undefined {
		return usageFromError(error);
	}

	public isRunning(): boolean {
		return this.running;
	}

	private async finalizeSeed(
		seedDraft: SeedDraft,
		trigger: ReseedTrigger,
	): Promise<SeedArtifact> {
		const headCommit = await this.deps.vcs.getHeadCommit();
		const keyFiles = await this.resolveKeyFiles(seedDraft.keyFiles);
		return {
			seedVersion: CURRENT_SEED_VERSION,
			generatedAt: new Date().toISOString(),
			sourceCommit: headCommit ?? undefined,
			generatorVersion: CURRENT_GENERATOR_VERSION,
			seederPromptVersion: SEEDER_PROMPT_VERSION,
			suggestionPromptVersion: SUGGESTION_PROMPT_VERSION,
			configFingerprint: this.configFingerprint,
			modelId: undefined,
			projectIntentSummary: seedDraft.projectIntentSummary,
			objectivesSummary: seedDraft.objectivesSummary,
			constraintsSummary: seedDraft.constraintsSummary,
			principlesGuidelinesSummary: seedDraft.principlesGuidelinesSummary,
			implementationStatusSummary: seedDraft.implementationStatusSummary,
			topObjectives: seedDraft.topObjectives,
			constraints: seedDraft.constraints,
			keyFiles,
			categoryFindings: seedDraft.categoryFindings,
			openQuestions: seedDraft.openQuestions,
			reseedNotes: seedDraft.reseedNotes,
			lastReseedReason: trigger.reason,
			lastChangedFiles: trigger.changedFiles,
		};
	}

	private async resolveKeyFiles(
		candidateKeyFiles: Array<{
			path: string;
			whyImportant: string;
			category: SeedArtifact["keyFiles"][number]["category"];
		}>,
	): Promise<SeedArtifact["keyFiles"]> {
		const uniqueCandidates = new Map<
			string,
			{
				absolutePath: string;
				path: string;
				whyImportant: string;
				category: SeedArtifact["keyFiles"][number]["category"];
			}
		>();

		for (const file of candidateKeyFiles) {
			const resolved = await resolveProjectFile(this.cwd, file.path);
			if (!resolved || uniqueCandidates.has(resolved.relativePath)) continue;
			uniqueCandidates.set(resolved.relativePath, {
				absolutePath: resolved.absolutePath,
				path: resolved.relativePath,
				whyImportant: file.whyImportant.trim() || "High-signal repository file",
				category: file.category,
			});
			if (uniqueCandidates.size >= 32) break;
		}

		if (uniqueCandidates.size === 0) {
			throw new Error(
				"Seeder returned no keyFiles. Agentic seeding requires explicit key file selection.",
			);
		}

		const hashed: SeedArtifact["keyFiles"] = [];
		for (const file of uniqueCandidates.values()) {
			hashed.push({
				path: file.path,
				hash: await this.deps.fileHash.hashFile(file.absolutePath),
				whyImportant: file.whyImportant,
				category: file.category,
			});
		}
		if (hashed.length === 0) {
			throw new Error(
				"Seeder returned keyFiles, but none could be resolved on disk.",
			);
		}
		return hashed;
	}

	private mergeTriggers(
		left: ReseedTrigger | null,
		right: ReseedTrigger,
	): ReseedTrigger {
		if (!left) return right;
		return {
			reason: right.reason,
			changedFiles: Array.from(
				new Set([...left.changedFiles, ...right.changedFiles]),
			),
			gitDiffSummary:
				[left.gitDiffSummary, right.gitDiffSummary]
					.filter(Boolean)
					.join("\n\n") || undefined,
		};
	}
}
