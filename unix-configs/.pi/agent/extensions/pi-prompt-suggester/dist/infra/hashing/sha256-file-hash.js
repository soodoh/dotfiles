import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
export class Sha256FileHash {
    async hashFile(filePath) {
        return await new Promise((resolve, reject) => {
            const hash = createHash("sha256");
            const stream = createReadStream(filePath);
            stream.on("error", reject);
            stream.on("data", (chunk) => hash.update(chunk));
            stream.on("end", () => resolve(`sha256:${hash.digest("hex")}`));
        });
    }
}
