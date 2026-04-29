import { promises as fs } from "node:fs";
import { INITIAL_RUNTIME_STATE } from "../../domain/state.js";
import { addUsageStats } from "../../domain/usage.js";
import { atomicWriteJson } from "../storage/atomic-write.js";
import { readJsonIfExists } from "../storage/json-file.js";
import { emptyUsagePair, normalizeInteractionState, toPersistedInteractionState, toRuntimeState, } from "./session-state-data.js";
import { ensureSessionMigration } from "./session-migration.js";
import { SessionUsageLedger } from "./session-usage-ledger.js";
import { createSessionStorageContext, stateFilePath } from "./session-storage-context.js";
export class SessionStateStore {
    projectStateDir;
    getSessionManager;
    inMemory = new Map();
    migrationTasks = new Map();
    usageLedger = new SessionUsageLedger();
    constructor(projectStateDir, getSessionManager) {
        this.projectStateDir = projectStateDir;
        this.getSessionManager = getSessionManager;
    }
    async load() {
        const context = this.getStorageContext();
        if (!context)
            return INITIAL_RUNTIME_STATE;
        if (!context.persistent) {
            const current = this.inMemory.get(context.sessionId);
            return current ? toRuntimeState(current.interaction, current.usage) : INITIAL_RUNTIME_STATE;
        }
        await this.ensureMigrated(context);
        const interaction = await this.loadInteractionState(context);
        const usage = await this.usageLedger.load(context);
        return toRuntimeState(interaction, usage);
    }
    async save(state) {
        const context = this.getStorageContext();
        if (!context)
            return;
        const interaction = toPersistedInteractionState(state);
        if (!context.persistent) {
            const current = this.inMemory.get(context.sessionId) ?? { interaction, usage: emptyUsagePair() };
            current.interaction = interaction;
            this.inMemory.set(context.sessionId, current);
            return;
        }
        await this.ensureMigrated(context);
        await fs.mkdir(context.interactionDir, { recursive: true });
        await atomicWriteJson(stateFilePath(context.interactionDir, context.currentKey), interaction);
    }
    async recordUsage(kind, usage) {
        const context = this.getStorageContext();
        if (!context)
            return;
        if (!context.persistent) {
            const current = this.inMemory.get(context.sessionId) ?? {
                interaction: normalizeInteractionState(INITIAL_RUNTIME_STATE),
                usage: emptyUsagePair(),
            };
            current.usage = {
                ...current.usage,
                [kind]: addUsageStats(current.usage[kind], usage),
            };
            this.inMemory.set(context.sessionId, current);
            return;
        }
        await this.ensureMigrated(context);
        await this.usageLedger.record(context, kind, usage);
    }
    getStorageContext() {
        const sessionManager = this.getSessionManager();
        return sessionManager ? createSessionStorageContext(this.projectStateDir, sessionManager) : undefined;
    }
    async loadInteractionState(context) {
        for (const key of context.lookupKeys) {
            const state = await readJsonIfExists(stateFilePath(context.interactionDir, key));
            if (state)
                return normalizeInteractionState(state);
        }
        return normalizeInteractionState(INITIAL_RUNTIME_STATE);
    }
    async ensureMigrated(context) {
        await ensureSessionMigration({
            context,
            cwd: this.projectStateDir,
            getSessionManager: this.getSessionManager,
            migrationTasks: this.migrationTasks,
        });
    }
}
