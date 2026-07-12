import { promises as fs } from "node:fs";
import path from "node:path";

export interface ResolvedProjectFile {
	absolutePath: string;
	relativePath: string;
}

function isInsideDirectory(parent: string, child: string): boolean {
	return child === parent || child.startsWith(`${parent}${path.sep}`);
}

export async function resolveProjectFile(
	cwd: string,
	inputPath: string,
): Promise<ResolvedProjectFile | undefined> {
	const trimmed = inputPath.trim();
	if (!trimmed) return undefined;

	const absoluteCandidate = path.isAbsolute(trimmed)
		? path.normalize(trimmed)
		: path.resolve(cwd, trimmed);
	const lexicalCwd = path.resolve(cwd);

	let realCwd: string;
	let realCandidate: string;
	try {
		realCwd = await fs.realpath(lexicalCwd);
		realCandidate = await fs.realpath(absoluteCandidate);
	} catch {
		return undefined;
	}

	if (!isInsideDirectory(realCwd, realCandidate)) return undefined;

	try {
		const stat = await fs.stat(realCandidate);
		if (!stat.isFile()) return undefined;
	} catch {
		return undefined;
	}

	const relativePath = path.normalize(path.relative(realCwd, realCandidate));
	if (!relativePath || relativePath === ".") return undefined;
	if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`)) {
		return undefined;
	}

	return { absolutePath: realCandidate, relativePath };
}
