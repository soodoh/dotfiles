import { usesGhostEditor } from "./suggestion-display-mode.js";
export function getGhostEditorSyncAction(params) {
    const { state, context, displayMode, sessionFile } = params;
    if (!usesGhostEditor(displayMode)) {
        return state ? "uninstall" : "noop";
    }
    if (state?.context === context && state.sessionFile === sessionFile) {
        return "noop";
    }
    return "install";
}
