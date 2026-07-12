import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
	chmodIfPossible,
	ensurePrivateDirectory,
	writePrivateFile,
} from "./private-fs";

export async function atomicWriteJson(
	filePath: string,
	value: unknown,
): Promise<void> {
	const directory = path.dirname(filePath);
	await ensurePrivateDirectory(directory);
	const tempPath = path.join(
		directory,
		`.${path.basename(filePath)}.${randomUUID()}.tmp`,
	);
	await writePrivateFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
	await fs.rename(tempPath, filePath);
	await chmodIfPossible(filePath, 0o600);
}
