import { promises as fs } from "node:fs";

export async function chmodIfPossible(
	filePath: string,
	mode: number,
): Promise<void> {
	try {
		await fs.chmod(filePath, mode);
	} catch {
		// Best effort: chmod may be unsupported on some filesystems.
	}
}

export async function ensurePrivateDirectory(dir: string): Promise<void> {
	await fs.mkdir(dir, { recursive: true, mode: 0o700 });
	await chmodIfPossible(dir, 0o700);
}

export async function writePrivateFile(
	filePath: string,
	contents: string,
): Promise<void> {
	await fs.writeFile(filePath, contents, { encoding: "utf8", mode: 0o600 });
	await chmodIfPossible(filePath, 0o600);
}

export async function appendPrivateFile(
	filePath: string,
	contents: string,
): Promise<void> {
	await fs.appendFile(filePath, contents, { encoding: "utf8", mode: 0o600 });
	await chmodIfPossible(filePath, 0o600);
}
