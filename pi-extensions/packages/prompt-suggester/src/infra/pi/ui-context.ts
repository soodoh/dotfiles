import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { PromptSuggesterConfig } from "../../config/types";
import { getConfiguredModelDisplay } from "./display";
import type { RuntimeRef } from "./runtime-ref";

interface WidgetLogStatus {
	level: "debug" | "info" | "warn" | "error";
	text: string;
}

export interface UiContextLike {
	getContext(): ExtensionContext | undefined;
	getEpoch(): number;
	getSuggestion(): string | undefined;
	setSuggestion(text: string | undefined): void;
	getPanelSuggestionStatus(): string | undefined;
	setPanelSuggestionStatus(text: string | undefined): void;
	getPanelUsageStatus(): string | undefined;
	setPanelUsageStatus(text: string | undefined): void;
	getPanelLogStatus(): WidgetLogStatus | undefined;
	setPanelLogStatus(status: WidgetLogStatus | undefined): void;
	getSuggesterModelDisplay(): string | undefined;
	ghostAcceptKeys: PromptSuggesterConfig["suggestion"]["ghostAcceptKeys"];
	ghostAcceptAndSendKeys: PromptSuggesterConfig["suggestion"]["ghostAcceptAndSendKeys"];
	prefillOnlyWhenEditorEmpty: boolean;
	showUsageInPanel: boolean;
	showPanelStatus: boolean;
}

export function createUiContext(params: {
	runtimeRef: RuntimeRef;
	config: PromptSuggesterConfig;
	getSessionThinkingLevel: () => string;
}): UiContextLike {
	const { runtimeRef, config, getSessionThinkingLevel } = params;
	return {
		getContext: () => runtimeRef.getContext(),
		getEpoch: () => runtimeRef.getEpoch(),
		getSuggestion: () => runtimeRef.getSuggestion(),
		setSuggestion: (text) => runtimeRef.setSuggestion(text),
		getPanelSuggestionStatus: () => runtimeRef.getPanelSuggestionStatus(),
		setPanelSuggestionStatus: (text) =>
			runtimeRef.setPanelSuggestionStatus(text),
		getPanelUsageStatus: () => runtimeRef.getPanelUsageStatus(),
		setPanelUsageStatus: (text) => runtimeRef.setPanelUsageStatus(text),
		getPanelLogStatus: () => runtimeRef.getPanelLogStatus(),
		setPanelLogStatus: (status) => runtimeRef.setPanelLogStatus(status),
		getSuggesterModelDisplay: () =>
			getConfiguredModelDisplay({
				ctx: runtimeRef.getContext(),
				configuredModel: config.inference.suggesterModel,
				configuredThinking: config.inference.suggesterThinking,
				getSessionThinkingLevel,
			}),
		get ghostAcceptKeys() {
			return config.suggestion.ghostAcceptKeys;
		},
		get ghostAcceptAndSendKeys() {
			return config.suggestion.ghostAcceptAndSendKeys;
		},
		get prefillOnlyWhenEditorEmpty() {
			return config.suggestion.prefillOnlyWhenEditorEmpty;
		},
		get showUsageInPanel() {
			return config.suggestion.showUsageInPanel;
		},
		get showPanelStatus() {
			return config.suggestion.showPanelStatus;
		},
	};
}
