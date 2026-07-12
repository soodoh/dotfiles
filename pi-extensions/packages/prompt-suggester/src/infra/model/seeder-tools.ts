import { execFile } from "node:child_process";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type { Logger } from "../../app/ports/logger";

const execFileAsync = promisify(execFile);
const GREP_TIMEOUT_MS = 10_000;
const SEEDER_READ_MAX_FILE_BYTES = 256 * 1024;
const SEEDER_READ_MAX_LINE_CHARS = 2000;
const SEEDER_FIND_MAX_FILES = 5000;
const SEEDER_FIND_MAX_DIRECTORIES = 1000;
const SEEDER_FIND_MAX_DEPTH = 12;
const SEEDER_FIND_MAX_ELAPSED_MS = 2000;
const IGNORED_DIRS = new Set([
	".git",
	"node_modules",
	".pi",
	".turbo",
	".pi-lens",
	".ralph",
	"dist",
	"build",
	"coverage",
]);

export type SeederToolName = "ls" | "find" | "grep" | "read";

export function shouldIgnoreSeederDir(name: string): boolean {
	return IGNORED_DIRS.has(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorProperty(error: unknown, key: string): unknown {
	return isRecord(error) ? Reflect.get(error, key) : undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}\n...[truncated]`;
}

export function isExpectedSeederToolError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const code = getErrorProperty(error, "code");
	if (
		typeof code === "string" &&
		["ENOENT", "ENOTDIR", "EISDIR", "EACCES", "EPERM"].includes(code)
	) {
		return true;
	}
	return (
		error.message.startsWith("Path escapes repository root:") ||
		error.message.endsWith("requires pattern")
	);
}

export function seederToolErrorObservation(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return truncate(`[tool error: ${message}]`, 8000);
}

export function globToRegExp(glob: string): RegExp {
	let pattern = "";
	for (let index = 0; index < glob.length; index += 1) {
		const char = glob[index];
		if (char === "*") {
			if (glob[index + 1] === "*") {
				if (glob[index + 2] === "/") {
					pattern += "(?:.*/)?";
					index += 2;
				} else {
					pattern += ".*";
					index += 1;
				}
			} else {
				pattern += "[^/]*";
			}
			continue;
		}
		if (char === "?") {
			pattern += "[^/]";
			continue;
		}
		pattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${pattern}$`, "i");
}

function parsePositiveInteger(
	value: unknown,
	fallback: number,
	max?: number,
): number {
	const parsed = Number(value ?? fallback);
	const bounded = Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
	const positive = Math.max(1, bounded);
	return max === undefined ? positive : Math.min(max, positive);
}

class SeederToolRunner {
	private readonly cwd: string;

	public constructor(
		cwd: string,
		private readonly logger?: Logger,
	) {
		this.cwd = path.resolve(cwd);
	}

	public async execute(
		tool: SeederToolName,
		args: Record<string, unknown>,
	): Promise<string> {
		switch (tool) {
			case "ls":
				return await this.toolLs(args);
			case "find":
				return await this.toolFind(args);
			case "grep":
				return await this.toolGrep(args);
			case "read":
				return await this.toolRead(args);
			default:
				return "Unsupported tool";
		}
	}

	private async resolvePath(inputPath: unknown): Promise<string> {
		const value =
			typeof inputPath === "string" && inputPath.trim().length > 0
				? inputPath.trim()
				: ".";
		const clean = value.replace(/^@/, "");
		const absolute = path.resolve(this.cwd, clean);
		const relativePath = path.relative(this.cwd, absolute);
		if (
			relativePath === ".." ||
			relativePath.startsWith(`..${path.sep}`) ||
			path.isAbsolute(relativePath)
		) {
			throw new Error(`Path escapes repository root: ${value}`);
		}
		const [realRoot, realAbsolute] = await Promise.all([
			fs.realpath(this.cwd),
			fs.realpath(absolute),
		]);
		const realRelativePath = path.relative(realRoot, realAbsolute);
		if (
			realRelativePath === ".." ||
			realRelativePath.startsWith(`..${path.sep}`) ||
			path.isAbsolute(realRelativePath)
		) {
			throw new Error(`Path escapes repository root: ${value}`);
		}
		return realAbsolute;
	}

	private async realCwd(): Promise<string> {
		return await fs.realpath(this.cwd);
	}

	private async toolLs(args: Record<string, unknown>): Promise<string> {
		const absolute = await this.resolvePath(args.path);
		const realRoot = await this.realCwd();
		const limit = parsePositiveInteger(args.limit, 200, 500);
		const entries = await fs.readdir(absolute, { withFileTypes: true });
		const lines = entries
			.filter(
				(entry) => !entry.isDirectory() || !shouldIgnoreSeederDir(entry.name),
			)
			.sort((a, b) => a.name.localeCompare(b.name))
			.slice(0, limit)
			.map(
				(entry) =>
					`${entry.isDirectory() ? "d" : "f"} ${path.relative(realRoot, path.join(absolute, entry.name)) || "."}`,
			);
		return truncate(lines.join("\n") || "(empty)", 8000);
	}

	private async toolFind(args: Record<string, unknown>): Promise<string> {
		const absolute = await this.resolvePath(args.path);
		const realRoot = await this.realCwd();
		const pattern = String(args.pattern ?? "").trim();
		if (!pattern) throw new Error("find requires pattern");
		const limit = parsePositiveInteger(args.limit, 200, 500);
		const matcher = globToRegExp(
			pattern.includes("*") || pattern.includes("?")
				? pattern
				: `**/*${pattern}*`,
		);
		const results: string[] = [];
		const pending = [{ dir: absolute, depth: 0 }];
		const deadline = Date.now() + SEEDER_FIND_MAX_ELAPSED_MS;
		let visitedFiles = 0;
		let visitedDirectories = 0;
		let truncatedReason: string | undefined;

		while (pending.length > 0 && !truncatedReason) {
			if (Date.now() > deadline) {
				truncatedReason = `elapsed ${SEEDER_FIND_MAX_ELAPSED_MS}ms cap reached`;
				break;
			}
			if (results.length >= limit) {
				truncatedReason = `result limit ${limit} reached`;
				break;
			}
			if (visitedDirectories >= SEEDER_FIND_MAX_DIRECTORIES) {
				truncatedReason = `directory scan cap ${SEEDER_FIND_MAX_DIRECTORIES} reached`;
				break;
			}

			const current = pending.shift();
			if (!current) break;
			visitedDirectories += 1;
			const entries = await fs.readdir(current.dir, { withFileTypes: true });
			for (const entry of entries) {
				if (Date.now() > deadline) {
					truncatedReason = `elapsed ${SEEDER_FIND_MAX_ELAPSED_MS}ms cap reached`;
					break;
				}
				if (results.length >= limit) {
					truncatedReason = `result limit ${limit} reached`;
					break;
				}
				const fullPath = path.join(current.dir, entry.name);
				if (entry.isDirectory()) {
					if (shouldIgnoreSeederDir(entry.name)) continue;
					if (current.depth >= SEEDER_FIND_MAX_DEPTH) {
						truncatedReason = `depth cap ${SEEDER_FIND_MAX_DEPTH} reached`;
						break;
					}
					if (
						visitedDirectories + pending.length >=
						SEEDER_FIND_MAX_DIRECTORIES
					) {
						truncatedReason = `directory scan cap ${SEEDER_FIND_MAX_DIRECTORIES} reached`;
						break;
					}
					pending.push({ dir: fullPath, depth: current.depth + 1 });
					continue;
				}
				if (!entry.isFile()) continue;
				visitedFiles += 1;
				if (visitedFiles > SEEDER_FIND_MAX_FILES) {
					truncatedReason = `file scan cap ${SEEDER_FIND_MAX_FILES} reached`;
					break;
				}
				const rel = path.relative(realRoot, fullPath);
				if (matcher.test(rel.replaceAll("\\", "/"))) results.push(rel);
			}
		}

		const body = results.join("\n") || "(no matches)";
		const diagnostic = truncatedReason
			? `\n[find truncated: ${truncatedReason}; scanned ${visitedFiles} files and ${visitedDirectories} directories]`
			: "";
		return truncate(`${body}${diagnostic}`, 8000);
	}

	private async toolGrep(args: Record<string, unknown>): Promise<string> {
		const searchPath = await this.resolvePath(args.path);
		const pattern = String(args.pattern ?? "").trim();
		if (!pattern) throw new Error("grep requires pattern");
		const limit = parsePositiveInteger(args.limit, 80, 200);
		const rgArgs = [
			"--line-number",
			"--no-heading",
			"--color",
			"never",
			"--max-count",
			String(limit),
		];
		if (args.ignoreCase === true) rgArgs.push("-i");
		if (args.literal === true) rgArgs.push("-F");
		if (typeof args.glob === "string" && args.glob.trim())
			rgArgs.push("-g", args.glob.trim());
		rgArgs.push("--", pattern, searchPath);

		try {
			const { stdout } = await execFileAsync("rg", rgArgs, {
				cwd: this.cwd,
				maxBuffer: 1024 * 1024 * 10,
				timeout: GREP_TIMEOUT_MS,
			});
			return truncate(stdout.trim() || "(no matches)", 8000);
		} catch (error) {
			const code = getErrorProperty(error, "code");
			if (String(code) === "1") return "(no matches)";
			const signal = getErrorProperty(error, "signal");
			const timedOut =
				getErrorProperty(error, "killed") === true || signal === "SIGTERM";
			const rawStdout = getErrorProperty(error, "stdout");
			const rawStderr = getErrorProperty(error, "stderr");
			const stdout = typeof rawStdout === "string" ? rawStdout.trim() : "";
			const stderr = typeof rawStderr === "string" ? rawStderr.trim() : "";
			const fallback = [stdout, stderr].filter(Boolean).join("\n");
			this.logger?.warn("seeder.tool.grep.failed", {
				path: path.relative(await this.realCwd(), searchPath) || ".",
				timedOut,
				error: timedOut ? "grep timed out" : errorMessage(error),
			});
			return truncate(fallback || "(grep failed)", 8000);
		}
	}

	private async toolRead(args: Record<string, unknown>): Promise<string> {
		const absolute = await this.resolvePath(args.path);
		const metadata = await fs.stat(absolute);
		if (!metadata.isFile()) return "[read skipped: path is not a file]";
		if (metadata.size > SEEDER_READ_MAX_FILE_BYTES) {
			return `[read truncated: file is ${metadata.size} bytes; max ${SEEDER_READ_MAX_FILE_BYTES} bytes. Narrow the path or use grep/find first.]`;
		}
		const offset = parsePositiveInteger(args.offset, 1);
		const limit = parsePositiveInteger(args.limit, 220, 1200);
		const numbered: string[] = [];
		let lineNumber = 0;
		let truncatedLineCount = 0;
		const stream = createReadStream(absolute, { encoding: "utf8" });
		const lines = createInterface({
			input: stream,
			crlfDelay: Number.POSITIVE_INFINITY,
		});

		try {
			for await (const line of lines) {
				lineNumber += 1;
				if (lineNumber < offset) continue;
				const boundedLine =
					line.length > SEEDER_READ_MAX_LINE_CHARS
						? `[line truncated at ${SEEDER_READ_MAX_LINE_CHARS} chars] ${line.slice(0, SEEDER_READ_MAX_LINE_CHARS)}`
						: line;
				if (boundedLine !== line) truncatedLineCount += 1;
				numbered.push(`${lineNumber}: ${boundedLine}`);
				if (numbered.length >= limit) {
					lines.close();
					stream.destroy();
					break;
				}
			}
		} finally {
			lines.close();
			stream.destroy();
		}

		const diagnostic =
			truncatedLineCount > 0
				? `\n[read truncated ${truncatedLineCount} overlong line(s) at ${SEEDER_READ_MAX_LINE_CHARS} chars]`
				: "";
		return truncate(`${numbered.join("\n") || "(empty)"}${diagnostic}`, 12000);
	}
}

export async function executeSeederTool(input: {
	cwd: string;
	logger?: Logger;
	tool: SeederToolName;
	args: Record<string, unknown>;
}): Promise<string> {
	return await new SeederToolRunner(input.cwd, input.logger).execute(
		input.tool,
		input.args,
	);
}
