import { promises as fs } from "node:fs";

function errorCode(error: unknown): string | undefined {
	const code =
		typeof error === "object" && error !== null
			? Reflect.get(error, "code")
			: undefined;
	return typeof code === "string" ? code : undefined;
}

export async function readJsonIfExists(
	filePath: string,
): Promise<unknown | undefined> {
	try {
		const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
		return parsed;
	} catch (error) {
		if (errorCode(error) === "ENOENT") return undefined;
		throw error;
	}
}
