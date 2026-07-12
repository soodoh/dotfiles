import { createHash } from "node:crypto";
import type { PromptSuggesterConfig } from "../../config/types";

export function computeConfigFingerprint(
	config: PromptSuggesterConfig,
): string {
	const hash = createHash("sha256");
	hash.update(
		JSON.stringify({
			seed: config.seed,
			inference: {
				seederModel: config.inference.seederModel,
				seederThinking: config.inference.seederThinking,
			},
		}),
	);
	return `sha256:${hash.digest("hex")}`;
}
