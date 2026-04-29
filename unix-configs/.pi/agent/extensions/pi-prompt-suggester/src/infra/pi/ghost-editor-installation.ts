import type { SuggestionDisplayMode } from "../../config/types.js";
import { usesGhostEditor } from "./suggestion-display-mode.js";

export interface GhostEditorInstallState {
	context: object;
	sessionFile: string | null;
}

export function getGhostEditorSyncAction(params: {
	state: GhostEditorInstallState | undefined;
	context: object;
	displayMode: SuggestionDisplayMode;
	sessionFile: string | null;
}): "install" | "uninstall" | "noop" {
	const { state, context, displayMode, sessionFile } = params;
	if (!usesGhostEditor(displayMode)) {
		return state ? "uninstall" : "noop";
	}
	if (state?.context === context && state.sessionFile === sessionFile) {
		return "noop";
	}
	return "install";
}
