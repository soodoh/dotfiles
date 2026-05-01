import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export function makeRunId(): string {
	return `pwf-${randomUUID().slice(0, 8)}`;
}
export function nowIso(): string {
	return new Date().toISOString();
}
export function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}
export function homePath(...parts: string[]): string {
	return join(homedir(), ...parts);
}
export function ensureInsideCwd(cwd: string, path: string): string {
	const full = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
	const root = resolve(cwd);
	if (full !== root && !full.startsWith(root + "/"))
		throw new Error(`Path must be inside cwd: ${path}`);
	return full;
}
export async function readTextIfExists(
	path: string,
): Promise<string | undefined> {
	if (!existsSync(path)) return undefined;
	return readFile(path, "utf8");
}
export async function writeJson(path: string, data: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(tempPath, JSON.stringify(data, null, 2) + "\n", "utf8");
	await rename(tempPath, path);
}
export function extensionDir(importMetaUrl: string): string {
	return dirname(new URL(importMetaUrl).pathname);
}
