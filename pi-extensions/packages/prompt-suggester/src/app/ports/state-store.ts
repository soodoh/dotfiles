import type { RuntimeState } from "../../domain/state";
import type { SuggestionUsage } from "../../domain/suggestion";

export interface StateStore {
	load(): Promise<RuntimeState>;
	save(state: RuntimeState): Promise<void>;
	recordUsage(
		kind: "suggester" | "seeder",
		usage: SuggestionUsage,
	): Promise<void>;
}
