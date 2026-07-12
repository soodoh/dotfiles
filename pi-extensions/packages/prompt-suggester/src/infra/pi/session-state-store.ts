import type { StateStore } from "../../app/ports/state-store";
import { INITIAL_RUNTIME_STATE, type RuntimeState } from "../../domain/state";
import type { SuggestionUsage } from "../../domain/suggestion";
import { addUsageStats } from "../../domain/usage";
import { atomicWriteJson } from "../storage/atomic-write";
import { readJsonIfExists } from "../storage/json-file";
import { ensurePrivateDirectory } from "../storage/private-fs";
import { ensureSessionMigration } from "./session-migration";
import {
	emptyUsagePair,
	normalizeInteractionState,
	toPersistedInteractionState,
	toRuntimeState,
} from "./session-state-data";
import type {
	InMemorySessionState,
	PersistedInteractionState,
	SessionReadableManager,
	SessionStorageContext,
} from "./session-state-types";
import {
	createSessionStorageContext,
	stateFilePath,
} from "./session-storage-context";
import { SessionUsageLedger } from "./session-usage-ledger";

export class SessionStateStore implements StateStore {
	private readonly inMemory = new Map<string, InMemorySessionState>();
	private readonly migrationTasks = new Map<string, Promise<void>>();
	private readonly usageLedger = new SessionUsageLedger();

	public constructor(
		private readonly projectStateDir: string,
		private readonly getSessionManager: () =>
			| SessionReadableManager
			| undefined,
	) {}

	public async load(): Promise<RuntimeState> {
		const context = this.getStorageContext();
		if (!context) return INITIAL_RUNTIME_STATE;

		if (!context.persistent) {
			const current = this.inMemory.get(context.sessionId);
			return current
				? toRuntimeState(current.interaction, current.usage)
				: INITIAL_RUNTIME_STATE;
		}

		await this.ensureMigrated(context);
		const interaction = await this.loadInteractionState(context);
		const usage = await this.usageLedger.load(context);
		return toRuntimeState(interaction, usage);
	}

	public async save(state: RuntimeState): Promise<void> {
		const context = this.getStorageContext();
		if (!context) return;

		const interaction = toPersistedInteractionState(state);
		if (!context.persistent) {
			const current = this.inMemory.get(context.sessionId) ?? {
				interaction,
				usage: emptyUsagePair(),
			};
			current.interaction = interaction;
			this.inMemory.set(context.sessionId, current);
			return;
		}

		await this.ensureMigrated(context);
		await ensurePrivateDirectory(context.interactionDir);
		await atomicWriteJson(
			stateFilePath(context.interactionDir, context.currentKey),
			interaction,
		);
	}

	public async recordUsage(
		kind: "suggester" | "seeder",
		usage: SuggestionUsage,
	): Promise<void> {
		const context = this.getStorageContext();
		if (!context) return;

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

	private getStorageContext(): SessionStorageContext | undefined {
		const sessionManager = this.getSessionManager();
		return sessionManager
			? createSessionStorageContext(this.projectStateDir, sessionManager)
			: undefined;
	}

	private async loadInteractionState(
		context: Extract<SessionStorageContext, { persistent: true }>,
	): Promise<PersistedInteractionState> {
		for (const key of context.lookupKeys) {
			try {
				const state = await readJsonIfExists(
					stateFilePath(context.interactionDir, key),
				);
				if (state) return normalizeInteractionState(state);
			} catch (error) {
				if (!(error instanceof SyntaxError)) throw error;
			}
		}
		return normalizeInteractionState(INITIAL_RUNTIME_STATE);
	}

	private async ensureMigrated(context: SessionStorageContext): Promise<void> {
		await ensureSessionMigration({
			context,
			cwd: this.projectStateDir,
			getSessionManager: this.getSessionManager,
			migrationTasks: this.migrationTasks,
		});
	}
}
