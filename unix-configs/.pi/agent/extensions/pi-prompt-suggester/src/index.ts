import type {
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
} from "@mariozechner/pi-coding-agent";
import { buildLatestHistoricalTurnContext } from "./app/services/conversation-signals.js";
import {
	type AppComposition,
	createAppComposition,
} from "./composition/root.js";
import { PiExtensionAdapter } from "./infra/pi/extension-adapter.js";
import {
	type GhostEditorInstallState,
	syncGhostEditorDecorator,
} from "./infra/pi/ghost-editor-installation.js";
import { refreshSuggesterUi } from "./infra/pi/ui-adapter.js";
import { createUiContext, type UiContextLike } from "./infra/pi/ui-context.js";

export default function suggester(pi: ExtensionAPI) {
	let compositionPromise: Promise<AppComposition> | undefined;
	let ghostEditorInstallState: GhostEditorInstallState | undefined;

	function syncGhostEditorInstallation(
		ctx: ExtensionContext,
		composition: AppComposition,
	): void {
		if (!ctx.hasUI) return;
		const sessionFile = ctx.sessionManager.getSessionFile() ?? null;
		ghostEditorInstallState = syncGhostEditorDecorator({
			state: ghostEditorInstallState,
			context: ctx,
			sessionFile,
			options: {
				getSuggestion: () => composition.runtimeRef.getSuggestion(),
				getSuggestionRevision: () =>
					composition.runtimeRef.getSuggestionRevision(),
				ghostAcceptKeys: composition.config.suggestion.ghostAcceptKeys,
				ghostAcceptAndSendKeys:
					composition.config.suggestion.ghostAcceptAndSendKeys,
			},
		});
	}

	async function getComposition(): Promise<AppComposition> {
		if (!compositionPromise) {
			compositionPromise = createAppComposition(pi).catch((error) => {
				compositionPromise = undefined;
				throw error;
			});
		}
		return await compositionPromise;
	}

	async function setRuntimeContext(
		ctx: ExtensionContext,
	): Promise<AppComposition> {
		const composition = await getComposition();
		composition.runtimeRef.setContext(ctx);
		return composition;
	}

	async function clearRuntimeContext(ctx: ExtensionContext): Promise<void> {
		if (!compositionPromise) return;
		try {
			const composition = await compositionPromise;
			composition.runtimeRef.clearContext(ctx);
		} catch {
			// If composition failed during startup, there is no runtime context to clear.
		}
	}

	function getUiContext(composition: AppComposition): UiContextLike {
		return createUiContext({
			runtimeRef: composition.runtimeRef,
			config: composition.config,
			getSessionThinkingLevel: () => pi.getThinkingLevel(),
		});
	}

	function syncSuggestionUi(
		ctx: ExtensionContext,
		composition: AppComposition,
	): void {
		if (!ctx.hasUI) return;
		syncGhostEditorInstallation(ctx, composition);
		refreshSuggesterUi(getUiContext(composition));
	}

	pi.on("session_shutdown", async (_event, ctx) => {
		await clearRuntimeContext(ctx);
	});

	const adapter = new PiExtensionAdapter(pi, {
		onSessionStart: async (ctx) => {
			const composition = await setRuntimeContext(ctx);
			const generationId = composition.runtimeRef.bumpEpoch();
			syncSuggestionUi(ctx, composition);
			await composition.orchestrators.sessionStart.handle();

			const sourceLeafId =
				ctx.sessionManager.getLeafId() ?? `turn-${Date.now()}`;
			if (composition.runtimeRef.getLastBootstrappedLeafId() === sourceLeafId)
				return;

			const state = await composition.stores.stateStore.load();
			if (state.lastSuggestion?.turnId === sourceLeafId) {
				composition.runtimeRef.markBootstrappedLeafId(sourceLeafId);
				return;
			}

			const branchEntries = ctx.sessionManager
				.getBranch()
				.filter(
					(
						entry,
					): entry is ReturnType<
						typeof ctx.sessionManager.getBranch
					>[number] & { type: "message" } => entry.type === "message",
				);
			const historicalTurn = buildLatestHistoricalTurnContext({
				branchEntries,
			});
			if (!historicalTurn) return;

			composition.runtimeRef.markBootstrappedLeafId(sourceLeafId);
			composition.runtimeRef.setLastTurnContext(historicalTurn);
			await composition.orchestrators.agentEnd.handle(
				historicalTurn,
				generationId,
			);
		},
		onAgentEnd: async (turn, ctx) => {
			if (!turn) return;
			const composition = await setRuntimeContext(ctx);
			syncSuggestionUi(ctx, composition);
			composition.runtimeRef.setLastTurnContext(turn);
			const generationId = composition.runtimeRef.bumpEpoch();
			await composition.orchestrators.agentEnd.handle(turn, generationId);
		},
		onUserSubmit: async (event: InputEvent, ctx) => {
			const composition = await setRuntimeContext(ctx);
			syncSuggestionUi(ctx, composition);
			composition.runtimeRef.bumpEpoch();
			await composition.orchestrators.userSubmit.handle({
				turnId: ctx.sessionManager.getLeafId() ?? `input-${Date.now()}`,
				userPrompt: event.text,
				source: event.source,
			});
		},
	});

	adapter.register();
}
