import { emptyUsageStats } from "./usage.js";
export const CURRENT_RUNTIME_STATE_VERSION = 9;
export const INITIAL_RUNTIME_STATE = {
    stateVersion: CURRENT_RUNTIME_STATE_VERSION,
    steeringHistory: [],
    suggestionUsage: emptyUsageStats(),
    seederUsage: emptyUsageStats(),
    turnsSinceLastStalenessCheck: 0,
};
