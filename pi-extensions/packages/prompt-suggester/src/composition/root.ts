import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { ReseedRunner } from "../app/orchestrators/reseed-runner";
import { SessionStartOrchestrator } from "../app/orchestrators/session-start";
import { TurnEndOrchestrator } from "../app/orchestrators/turn-end";
import { UserSubmitOrchestrator } from "../app/orchestrators/user-submit";
import { PromptContextBuilder } from "../app/services/prompt-context-builder";
import { StalenessChecker } from "../app/services/staleness-checker";
import { SteeringClassifier } from "../app/services/steering-classifier";
import { SuggestionEngine } from "../app/services/suggestion-engine";
import { TranscriptPromptContextBuilder } from "../app/services/transcript-prompt-context-builder";
import { FileConfigLoader } from "../config/loader";
import type { PromptSuggesterConfig } from "../config/types";
import { SystemClock } from "../infra/clock/system-clock";
import { Sha256FileHash } from "../infra/hashing/sha256-file-hash";
import { ConsoleLogger } from "../infra/logging/console-logger";
import { NdjsonEventLog } from "../infra/logging/ndjson-event-log";
import { PiModelClient } from "../infra/model/pi-model-client";
import { RuntimeRef } from "../infra/pi/runtime-ref";
import { SessionStateStore } from "../infra/pi/session-state-store";
import { PiSessionTranscriptProvider } from "../infra/pi/session-transcript-provider";
import { projectStateDir } from "../infra/pi/state-root";
import { PiSuggestionSink, refreshSuggesterUi } from "../infra/pi/ui-adapter";
import { createUiContext } from "../infra/pi/ui-context";
import { InMemoryTaskQueue } from "../infra/queue/in-memory-task-queue";
import { JsonSeedStore } from "../infra/storage/json-seed-store";
import { GitClient } from "../infra/vcs/git-client";

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

export type AppCompositionApi = Pick<ExtensionAPI, "getThinkingLevel">;

export async function createAppComposition(
	pi: AppCompositionApi,
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
