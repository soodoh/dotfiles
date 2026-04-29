import type { SeedArtifact } from "../../domain/seed.js";

export interface SeedStore {
	load(): Promise<SeedArtifact | null>;
	save(seed: SeedArtifact): Promise<void>;
}
