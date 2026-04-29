import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { FileHash } from "../../app/ports/file-hash.js";

export class Sha256FileHash implements FileHash {
	public async hashFile(filePath: string): Promise<string> {
		return await new Promise<string>((resolve, reject) => {
			const hash = createHash("sha256");
			const stream = createReadStream(filePath);
			stream.on("error", reject);
			stream.on("data", (chunk) => hash.update(chunk));
			stream.on("end", () => resolve(`sha256:${hash.digest("hex")}`));
		});
	}
}
