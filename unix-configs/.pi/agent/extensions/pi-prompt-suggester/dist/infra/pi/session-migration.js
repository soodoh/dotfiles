import { promises as fs } from "node:fs";
import { atomicWriteJson } from "../storage/atomic-write.js";
import { readJsonIfExists } from "../storage/json-file.js";
import { extractLegacyInteractionSnapshots, extractUsageTotals } from "./session-state-data.js";
import { stateFilePath } from "./session-storage-context.js";
import { STORE_SCHEMA_VERSION, } from "./session-state-types.js";
export async function ensureSessionMigration(params) {
    const migrationKey = params.context.storageDir;
    const existingTask = params.migrationTasks.get(migrationKey);
    if (existingTask) {
        await existingTask;
        return;
    }
    const task = performMigration(params).finally(() => {
        params.migrationTasks.delete(migrationKey);
    });
    params.migrationTasks.set(migrationKey, task);
    await task;
}
async function performMigration(params) {
    const { context, cwd, getSessionManager } = params;
    await fs.mkdir(context.storageDir, { recursive: true });
    const existingMeta = await readJsonIfExists(context.metaFile);
    if (existingMeta?.schemaVersion === STORE_SCHEMA_VERSION)
        return;
    const sessionManager = getSessionManager();
    const allEntries = sessionManager?.getEntries() ?? [];
    const usageTotals = extractUsageTotals(allEntries);
    const legacySnapshots = extractLegacyInteractionSnapshots(allEntries);
    const importedLegacyEntries = legacySnapshots.size > 0 || usageTotals.hasLedger;
    await fs.mkdir(context.interactionDir, { recursive: true });
    for (const [entryId, interaction] of legacySnapshots.entries()) {
        await atomicWriteJson(stateFilePath(context.interactionDir, entryId), interaction);
    }
    if (!(await readJsonIfExists(context.usageFile))) {
        await atomicWriteJson(context.usageFile, {
            schemaVersion: STORE_SCHEMA_VERSION,
            suggestionUsage: usageTotals.suggester,
            seederUsage: usageTotals.seeder,
            updatedAt: new Date().toISOString(),
        });
    }
    await atomicWriteJson(context.metaFile, {
        schemaVersion: STORE_SCHEMA_VERSION,
        sessionId: context.sessionId,
        sessionFile: context.sessionFile,
        cwd: sessionManager?.getCwd() ?? cwd,
        ignoreLegacyPiSessionEntries: true,
        legacyMigration: {
            performedAt: new Date().toISOString(),
            importedLegacyEntries,
            legacyStateEntryCount: legacySnapshots.size,
            legacyUsageEntryCount: usageTotals.legacyUsageEntryCount,
            note: "Legacy suggester-state/suggester-usage pi session entries were imported once into extension-owned storage and are ignored afterwards.",
        },
    });
}
