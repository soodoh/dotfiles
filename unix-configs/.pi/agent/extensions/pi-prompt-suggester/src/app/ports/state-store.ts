import type { RuntimeState } from "../../domain/state.js";
import type { SuggestionUsage } from "../../domain/suggestion.js";

export interface StateStore {
	load(): Promise<RuntimeState>;
	save(state: RuntimeState): Promise<void>;
	recordUsage(kind: "suggester" | "seeder", usage: SuggestionUsage): Promise<void>;
}
