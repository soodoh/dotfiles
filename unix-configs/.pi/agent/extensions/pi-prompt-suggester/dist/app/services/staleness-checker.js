import path from "node:path";
import { CURRENT_GENERATOR_VERSION, SEEDER_PROMPT_VERSION, SUGGESTION_PROMPT_VERSION, } from "../../domain/seed.js";
import { computeConfigFingerprint } from "./seed-metadata.js";
export class StalenessChecker {
    deps;
    configFingerprint;
    cwd;
    constructor(deps) {
        this.deps = deps;
        this.configFingerprint = computeConfigFingerprint(deps.config);
        this.cwd = deps.cwd ?? process.cwd();
    }
    async check(seed) {
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
                    gitDiffSummary: await this.deps.vcs.getDiffSummary(changedFiles, this.deps.config.seed.maxDiffChars),
                },
            };
        }
        if (seed.generatorVersion !== CURRENT_GENERATOR_VERSION ||
            seed.seederPromptVersion !== SEEDER_PROMPT_VERSION ||
            seed.suggestionPromptVersion !== SUGGESTION_PROMPT_VERSION) {
            const changedFiles = await this.collectChangedFiles(seed);
            return {
                stale: true,
                trigger: {
                    reason: "generator_changed",
                    changedFiles,
                    gitDiffSummary: await this.deps.vcs.getDiffSummary(changedFiles, this.deps.config.seed.maxDiffChars),
                },
            };
        }
        const changedKeyFiles = [];
        for (const keyFile of seed.keyFiles) {
            const absolute = path.join(this.cwd, keyFile.path);
            try {
                const currentHash = await this.deps.fileHash.hashFile(absolute);
                if (currentHash !== keyFile.hash)
                    changedKeyFiles.push(keyFile.path);
            }
            catch {
                changedKeyFiles.push(keyFile.path);
            }
        }
        if (changedKeyFiles.length > 0) {
            return {
                stale: true,
                trigger: {
                    reason: "key_file_changed",
                    changedFiles: changedKeyFiles,
                    gitDiffSummary: await this.deps.vcs.getDiffSummary(changedKeyFiles, this.deps.config.seed.maxDiffChars),
                },
            };
        }
        return { stale: false };
    }
    async collectChangedFiles(seed) {
        const files = new Set();
        for (const file of await this.deps.vcs.getWorkingTreeStatus())
            files.add(file);
        if (seed.sourceCommit) {
            for (const file of await this.deps.vcs.getChangedFilesSinceCommit(seed.sourceCommit))
                files.add(file);
        }
        return Array.from(files);
    }
}
