import type { SeedArtifact } from "../../domain/seed";

export interface SeedStore {
	load(): Promise<SeedArtifact | null>;
	save(seed: SeedArtifact): Promise<void>;
}
