import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { ReseedRunner } from "../app/orchestrators/reseed-runner.js";
import { SessionStartOrchestrator } from "../app/orchestrators/session-start.js";
import { TurnEndOrchestrator } from "../app/orchestrators/turn-end.js";
import { UserSubmitOrchestrator } from "../app/orchestrators/user-submit.js";
import { PromptContextBuilder } from "../app/services/prompt-context-builder.js";
import { StalenessChecker } from "../app/services/staleness-checker.js";
import { SteeringClassifier } from "../app/services/steering-classifier.js";
import { SuggestionEngine } from "../app/services/suggestion-engine.js";
import { TranscriptPromptContextBuilder } from "../app/services/transcript-prompt-context-builder.js";
import { FileConfigLoader } from "../config/loader.js";
import type { PromptSuggesterConfig } from "../config/types.js";
import { SystemClock } from "../infra/clock/system-clock.js";
import { Sha256FileHash } from "../infra/hashing/sha256-file-hash.js";
import { ConsoleLogger } from "../infra/logging/console-logger.js";
import { NdjsonEventLog } from "../infra/logging/ndjson-event-log.js";
import { PiModelClient } from "../infra/model/pi-model-client.js";
import { RuntimeRef } from "../infra/pi/runtime-ref.js";
import { SessionStateStore } from "../infra/pi/session-state-store.js";
import { PiSessionTranscriptProvider } from "../infra/pi/session-transcript-provider.js";
import { projectStateDir } from "../infra/pi/state-root.js";
import {
	PiSuggestionSink,
	refreshSuggesterUi,
} from "../infra/pi/ui-adapter.js";
import { createUiContext } from "../infra/pi/ui-context.js";
import { InMemoryTaskQueue } from "../infra/queue/in-memory-task-queue.js";
import { JsonSeedStore } from "../infra/storage/json-seed-store.js";
import { GitClient } from "../infra/vcs/git-client.js";

export interface AppComposition {
	config: PromptSuggesterConfig;
	runtimeRef: RuntimeRef;
	stores: {
		seedStore: JsonSeedStore;
		stateStore: SessionStateStore;
	};
	eventLog: NdjsonEventLog;
	orchestrators: {
		sessionStart: SessionStartOrchestrator;
		agentEnd: TurnEndOrchestrator;
		userSubmit: UserSubmitOrchestrator;
		reseedRunner: ReseedRunner;
	};
}

export async function createAppComposition(
	pi: ExtensionAPI,
	cwd: string = process.cwd(),
): Promise<AppComposition> {
	const config = await new FileConfigLoader(cwd).load();
	const runtimeRef = new RuntimeRef();
	const stateDir = projectStateDir(cwd);
	const uiContext = createUiContext({
		runtimeRef,
		config,
		getSessionThinkingLevel: () => pi.getThinkingLevel(),
	});
	const eventLog = new NdjsonEventLog(
		path.join(stateDir, "logs", "events.ndjson"),
	);
	const logger = new ConsoleLogger(config.logging.level, {
		getContext: () => runtimeRef.getContext(),
		statusKey: "suggester-events",
		mirrorToConsoleWhenNoUi: false,
		eventLog,
		setWidgetLogStatus: (status) => {
			runtimeRef.setPanelLogStatus(status);
			refreshSuggesterUi(uiContext);
		},
	});
	const taskQueue = new InMemoryTaskQueue();
	const vcs = new GitClient(cwd);
	const fileHash = new Sha256FileHash();
	const seedStore = new JsonSeedStore(path.join(stateDir, "seed.json"));
	const stateStore = new SessionStateStore(stateDir, () => {
		const ctx = runtimeRef.getContext();
		try {
			return ctx?.sessionManager;
		} catch {
			return undefined;
		}
	});
	const modelClient = new PiModelClient(runtimeRef, logger, cwd);
	const clock = new SystemClock();
	const suggestionSink = new PiSuggestionSink(uiContext);

	const stalenessChecker = new StalenessChecker({
		config,
		fileHash,
		vcs,
		cwd,
	});

	const promptContextBuilder = new PromptContextBuilder(config);
	const transcriptPromptContextBuilder = new TranscriptPromptContextBuilder(
		config,
		new PiSessionTranscriptProvider(runtimeRef),
	);
	const suggestionEngine = new SuggestionEngine({
		config,
		modelClient,
		promptContextBuilder,
		transcriptPromptContextBuilder,
	});
	const steeringClassifier = new SteeringClassifier(config);

	const reseedRunner = new ReseedRunner({
		config,
		seedStore,
		stateStore,
		modelClient,
		taskQueue,
		logger,
		fileHash,
		vcs,
		cwd,
	});

	const sessionStart = new SessionStartOrchestrator({
		seedStore,
		stateStore,
		stalenessChecker,
		reseedRunner,
		suggestionSink,
		logger,
		checkForStaleness: config.reseed.checkOnSessionStart,
	});

	const agentEnd = new TurnEndOrchestrator({
		config,
		seedStore,
		stateStore,
		stalenessChecker,
		reseedRunner,
		suggestionEngine,
		suggestionSink,
		logger,
		checkForStaleness: config.reseed.checkAfterEveryTurn,
	});

	const userSubmit = new UserSubmitOrchestrator({
		stateStore,
		steeringClassifier,
		clock,
		logger,
		suggestionSink,
		historyWindow: config.steering.historyWindow,
	});

	return {
		config,
		runtimeRef,
		stores: {
			seedStore,
			stateStore,
		},
		eventLog,
		orchestrators: {
			sessionStart,
			agentEnd,
			userSubmit,
			reseedRunner,
		},
	};
}
