import { promises as fs } from "node:fs";

export async function readJsonIfExists<T = unknown>(
	filePath: string,
): Promise<T | undefined> {
	try {
		return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}
