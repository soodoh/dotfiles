import { atomicWriteJson } from "../storage/atomic-write";
import { readJsonIfExists } from "../storage/json-file";
import { ensurePrivateDirectory } from "../storage/private-fs";
import {
	extractLegacyInteractionSnapshots,
	extractUsageTotals,
} from "./session-state-data";
import {
	type PersistedSessionMetadata,
	type PersistedUsageState,
	type SessionReadableManager,
	type SessionStorageContext,
	STORE_SCHEMA_VERSION,
} from "./session-state-types";
import { stateFilePath } from "./session-storage-context";

export async function ensureSessionMigration(params: {
	context: SessionStorageContext;
	cwd: string;
	getSessionManager: () => SessionReadableManager | undefined;
	migrationTasks: Map<string, Promise<void>>;
}): Promise<void> {
	if (!params.context.persistent) return;
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

async function performMigration(params: {
	context: SessionStorageContext;
	cwd: string;
	getSessionManager: () => SessionReadableManager | undefined;
}): Promise<void> {
	const { context, cwd, getSessionManager } = params;
	if (!context.persistent) return;
	await ensurePrivateDirectory(context.storageDir);
	const existingMeta = await readRecoverableSessionJson(context.metaFile);
	if (hasCurrentStoreSchemaVersion(existingMeta)) return;

	const sessionManager = getSessionManager();
	const allEntries = sessionManager?.getEntries() ?? [];
	const usageTotals = extractUsageTotals(allEntries);
	const legacySnapshots = extractLegacyInteractionSnapshots(allEntries);
	const importedLegacyEntries =
		legacySnapshots.size > 0 || usageTotals.hasLedger;

	await ensurePrivateDirectory(context.interactionDir);
	for (const [entryId, interaction] of legacySnapshots.entries()) {
		await atomicWriteJson(
			stateFilePath(context.interactionDir, entryId),
			interaction,
		);
	}

	if (!(await readRecoverableSessionJson(context.usageFile))) {
		await atomicWriteJson(context.usageFile, {
			schemaVersion: STORE_SCHEMA_VERSION,
			suggestionUsage: usageTotals.suggester,
			seederUsage: usageTotals.seeder,
			updatedAt: new Date().toISOString(),
		} satisfies PersistedUsageState);
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
	} satisfies PersistedSessionMetadata);
}

function hasCurrentStoreSchemaVersion(value: unknown): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		Reflect.get(value, "schemaVersion") === STORE_SCHEMA_VERSION
	);
}

async function readRecoverableSessionJson(
	filePath: string,
): Promise<unknown | undefined> {
	try {
		return await readJsonIfExists(filePath);
	} catch (error) {
		if (error instanceof SyntaxError) return undefined;
		throw error;
	}
}
