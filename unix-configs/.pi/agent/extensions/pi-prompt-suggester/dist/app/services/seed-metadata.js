import { createHash } from "node:crypto";
export function computeConfigFingerprint(config) {
    const hash = createHash("sha256");
    hash.update(JSON.stringify({
        seed: config.seed,
        inference: {
            seederModel: config.inference.seederModel,
            seederThinking: config.inference.seederThinking,
        },
    }));
    return `sha256:${hash.digest("hex")}`;
}
