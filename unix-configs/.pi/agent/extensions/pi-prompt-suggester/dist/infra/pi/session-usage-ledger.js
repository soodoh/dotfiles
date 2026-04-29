import { promises as fs } from "node:fs";
import path from "node:path";
import { addUsageStats } from "../../domain/usage.js";
import { atomicWriteJson } from "../storage/atomic-write.js";
import { readJsonIfExists } from "../storage/json-file.js";
import { emptyUsagePair, normalizePersistedUsagePair } from "./session-state-data.js";
import { STORE_SCHEMA_VERSION } from "./session-state-types.js";
export class SessionUsageLedger {
    usageTasks = new Map();
    async load(context) {
        const persisted = await readJsonIfExists(context.usageFile);
        if (!persisted)
            return emptyUsagePair();
        return normalizePersistedUsagePair(persisted);
    }
    async record(context, kind, usage) {
        const usageKey = context.usageFile;
        const existingTask = this.usageTasks.get(usageKey) ?? Promise.resolve();
        const task = existingTask.then(async () => {
            const current = await this.load(context);
            const next = {
                suggester: kind === "suggester" ? addUsageStats(current.suggester, usage) : current.suggester,
                seeder: kind === "seeder" ? addUsageStats(current.seeder, usage) : current.seeder,
            };
            await fs.mkdir(path.dirname(usageKey), { recursive: true });
            await atomicWriteJson(usageKey, {
                schemaVersion: STORE_SCHEMA_VERSION,
                suggestionUsage: next.suggester,
                seederUsage: next.seeder,
                updatedAt: new Date().toISOString(),
            });
        });
        this.usageTasks.set(usageKey, task.finally(() => {
            if (this.usageTasks.get(usageKey) === task)
                this.usageTasks.delete(usageKey);
        }));
        await task;
    }
}
