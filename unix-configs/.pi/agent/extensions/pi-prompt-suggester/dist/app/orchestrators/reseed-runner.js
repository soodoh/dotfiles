import { promises as fs } from "node:fs";
import path from "node:path";
import { toInvocationThinkingLevel } from "../../config/inference.js";
import { CURRENT_GENERATOR_VERSION, CURRENT_SEED_VERSION, SEEDER_PROMPT_VERSION, SUGGESTION_PROMPT_VERSION, } from "../../domain/seed.js";
import { computeConfigFingerprint } from "../services/seed-metadata.js";
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
function createRunId() {
    return `seed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
export class ReseedRunner {
    deps;
    running = false;
    pendingTrigger = null;
    consecutiveFailureCount = 0;
    cwd;
    configFingerprint;
    constructor(deps) {
        this.deps = deps;
        this.cwd = deps.cwd ?? process.cwd();
        this.configFingerprint = computeConfigFingerprint(deps.config);
    }
    async trigger(trigger) {
        if (!this.deps.config.reseed.enabled)
            return;
        if (this.running) {
            this.pendingTrigger = this.mergeTriggers(this.pendingTrigger, trigger);
            this.deps.logger.info("reseed.pending", { reason: trigger.reason, changedFiles: trigger.changedFiles });
            return;
        }
        this.running = true;
        void this.deps.taskQueue
            .enqueue("suggester:reseed", async () => {
            await this.processTriggerLoop(trigger);
        })
            .catch((error) => {
            this.deps.logger.error("reseed.queue.failed", {
                error: error.message,
            });
        })
            .finally(() => {
            this.running = false;
        });
    }
    async processTriggerLoop(initialTrigger) {
        let nextTrigger = initialTrigger;
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
                        modelRef: this.deps.config.inference.seederModel === "session-default"
                            ? undefined
                            : this.deps.config.inference.seederModel,
                        thinkingLevel: toInvocationThinkingLevel(this.deps.config.inference.seederThinking),
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
            }
            catch (error) {
                const usage = this.extractUsageFromError(error);
                if (usage) {
                    await this.recordSeederUsage(usage);
                }
                this.consecutiveFailureCount += 1;
                const meta = {
                    runId,
                    reason: current.reason,
                    error: error.message,
                    tokens: usage?.totalTokens,
                    cost: usage?.costTotal,
                    consecutiveFailures: this.consecutiveFailureCount,
                };
                if (this.consecutiveFailureCount >= 3) {
                    this.deps.logger.error("reseed.failed", meta);
                }
                else {
                    this.deps.logger.debug("reseed.failed", meta);
                }
            }
            if (this.pendingTrigger) {
                nextTrigger = this.pendingTrigger;
                this.pendingTrigger = null;
            }
        }
    }
    async recordSeederUsage(usage) {
        if (!usage)
            return;
        await this.deps.stateStore.recordUsage("seeder", usage);
    }
    extractUsageFromError(error) {
        if (!error || typeof error !== "object")
            return undefined;
        const usage = error.usage;
        if (!usage)
            return undefined;
        if (typeof usage.inputTokens !== "number" ||
            typeof usage.outputTokens !== "number" ||
            typeof usage.cacheReadTokens !== "number" ||
            typeof usage.cacheWriteTokens !== "number" ||
            typeof usage.totalTokens !== "number" ||
            typeof usage.costTotal !== "number") {
            return undefined;
        }
        return usage;
    }
    isRunning() {
        return this.running;
    }
    async finalizeSeed(seedDraft, trigger) {
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
    async resolveKeyFiles(candidateKeyFiles) {
        const normalizeToRepoRelative = (inputPath) => {
            const trimmed = inputPath.trim();
            if (!trimmed)
                return undefined;
            const absolute = path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(this.cwd, trimmed);
            if (absolute !== this.cwd && !absolute.startsWith(`${this.cwd}${path.sep}`))
                return undefined;
            const relative = path.relative(this.cwd, absolute);
            if (!relative || relative === ".")
                return undefined;
            if (relative.startsWith(`..${path.sep}`) || relative === "..")
                return undefined;
            return path.normalize(relative);
        };
        const uniqueCandidates = Array.from(new Map(candidateKeyFiles
            .map((file) => {
            const normalizedPath = normalizeToRepoRelative(file.path);
            if (!normalizedPath)
                return undefined;
            return {
                path: normalizedPath,
                whyImportant: file.whyImportant.trim() || "High-signal repository file",
                category: file.category,
            };
        })
            .filter((file) => Boolean(file))
            .map((file) => [file.path, file])).values());
        const chosen = uniqueCandidates.slice(0, 32);
        if (chosen.length === 0) {
            throw new Error("Seeder returned no keyFiles. Agentic seeding requires explicit key file selection.");
        }
        const hashed = [];
        for (const file of chosen) {
            const absolute = path.resolve(this.cwd, file.path);
            if (!(await fileExists(absolute)))
                continue;
            hashed.push({
                path: file.path,
                hash: await this.deps.fileHash.hashFile(absolute),
                whyImportant: file.whyImportant,
                category: file.category,
            });
        }
        if (hashed.length === 0) {
            throw new Error("Seeder returned keyFiles, but none could be resolved on disk.");
        }
        return hashed;
    }
    mergeTriggers(left, right) {
        if (!left)
            return right;
        return {
            reason: right.reason,
            changedFiles: Array.from(new Set([...left.changedFiles, ...right.changedFiles])),
            gitDiffSummary: [left.gitDiffSummary, right.gitDiffSummary].filter(Boolean).join("\n\n") || undefined,
        };
    }
}
