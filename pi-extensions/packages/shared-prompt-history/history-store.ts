import { createReadStream } from "node:fs";
import { appendFile, chmod, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";

const HISTORY_FILE_NAME = "prompt-history.jsonl";
const TAIL_READ_CHUNK_SIZE = 8192;
const DEFAULT_HISTORY_PROMPT_LIMIT = 200;
const DEFAULT_HISTORY_TAIL_BYTES = 512 * 1024;
const lastPersistedPromptByPath = new Map<string, string>();

export interface PromptHistoryPathOptions {
	home?: string;
}

export interface PromptHistoryEntry {
	prompt: string;
	ts?: string;
}

export function getPromptHistoryPath(
	options: PromptHistoryPathOptions = {},
): string {
	const home = options.home ?? homedir();
	return join(home, ".local", "state", "pi", HISTORY_FILE_NAME);
}

function parsePromptEntry(line: string): PromptHistoryEntry | undefined {
	if (!line.trim()) return undefined;
	try {
		const entry: unknown = JSON.parse(line);
		const prompt = entry ? Reflect.get(Object(entry), "prompt") : undefined;
		if (typeof prompt !== "string" || !prompt.trim()) return undefined;

		const ts = Reflect.get(Object(entry), "ts");
		return typeof ts === "string" && ts.trim() ? { prompt, ts } : { prompt };
	} catch {
		return undefined;
	}
}

function parsePromptLine(line: string): string | undefined {
	return parsePromptEntry(line)?.prompt;
}

function isNotFoundError(error: unknown): boolean {
	return error instanceof Error && Reflect.get(error, "code") === "ENOENT";
}

async function chmodIfPossible(path: string, mode: number): Promise<void> {
	try {
		await chmod(path, mode);
	} catch {
		// Best effort: chmod may be unsupported on some filesystems.
	}
}

async function ensurePrivateDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	await chmodIfPossible(path, 0o700);
}

async function readLastPrompt(
	historyPath: string,
	maxBytes = DEFAULT_HISTORY_TAIL_BYTES,
): Promise<string | undefined> {
	let file: Awaited<ReturnType<typeof open>>;
	try {
		file = await open(historyPath, "r");
	} catch (error) {
		if (isNotFoundError(error)) return undefined;
		throw error;
	}

	try {
		const { size } = await file.stat();
		let position = size;
		let remainingBytes = Math.max(TAIL_READ_CHUNK_SIZE, Math.floor(maxBytes));
		let text = "";
		while (position > 0 && remainingBytes > 0) {
			const length = Math.min(TAIL_READ_CHUNK_SIZE, position, remainingBytes);
			position -= length;
			remainingBytes -= length;
			const buffer = Buffer.alloc(length);
			const { bytesRead } = await file.read(buffer, 0, length, position);
			text = `${buffer.subarray(0, bytesRead).toString("utf8")}${text}`;
			const lines = text.split("\n");
			const completeLines = position === 0 ? lines : lines.slice(1);
			for (let index = completeLines.length - 1; index >= 0; index -= 1) {
				const prompt = parsePromptLine(completeLines[index]);
				if (prompt) return prompt;
			}
			text = position === 0 ? "" : (lines[0] ?? "");
		}
		return undefined;
	} finally {
		await file.close();
	}
}

export interface ReadPromptHistoryOptions {
	maxPrompts?: number;
	maxBytes?: number;
}

export async function readAllPromptHistory(
	historyPath = getPromptHistoryPath(),
): Promise<PromptHistoryEntry[]> {
	const stream = createReadStream(historyPath, { encoding: "utf8" });
	const lines = createInterface({ input: stream, crlfDelay: Infinity });
	const entries: PromptHistoryEntry[] = [];

	try {
		for await (const line of lines) {
			const parsed = parsePromptEntry(line);
			if (parsed) entries.push(parsed);
		}
	} catch (error) {
		if (isNotFoundError(error)) return [];
		throw error;
	} finally {
		lines.close();
		stream.destroy();
	}

	return entries;
}

export async function readPromptHistory(
	historyPath = getPromptHistoryPath(),
	options: ReadPromptHistoryOptions = {},
): Promise<string[]> {
	const maxPrompts = Math.max(
		1,
		Math.floor(options.maxPrompts ?? DEFAULT_HISTORY_PROMPT_LIMIT),
	);
	const maxBytes = Math.max(
		TAIL_READ_CHUNK_SIZE,
		Math.floor(options.maxBytes ?? DEFAULT_HISTORY_TAIL_BYTES),
	);
	let file: Awaited<ReturnType<typeof open>>;
	try {
		file = await open(historyPath, "r");
	} catch (error) {
		if (isNotFoundError(error)) return [];
		throw error;
	}

	try {
		const { size } = await file.stat();
		let position = size;
		let remainingBytes = maxBytes;
		let text = "";
		const prompts: string[] = [];

		while (position > 0 && remainingBytes > 0 && prompts.length < maxPrompts) {
			const length = Math.min(TAIL_READ_CHUNK_SIZE, position, remainingBytes);
			position -= length;
			remainingBytes -= length;
			const buffer = Buffer.alloc(length);
			const { bytesRead } = await file.read(buffer, 0, length, position);
			text = `${buffer.subarray(0, bytesRead).toString("utf8")}${text}`;
			const lines = text.split("\n");
			const completeLines = position === 0 ? lines : lines.slice(1);
			for (let index = completeLines.length - 1; index >= 0; index -= 1) {
				const parsed = parsePromptLine(completeLines[index]);
				if (parsed) prompts.push(parsed);
				if (prompts.length >= maxPrompts) break;
			}
			text = position === 0 ? "" : (lines[0] ?? "");
		}

		const orderedPrompts = prompts.reverse();
		const lastPrompt = orderedPrompts.at(-1);
		if (lastPrompt) lastPersistedPromptByPath.set(historyPath, lastPrompt);
		return orderedPrompts;
	} finally {
		await file.close();
	}
}

export interface AppendPromptOptions {
	lastPersistedPrompt?: string;
}

export async function appendPrompt(
	prompt: string,
	historyPath = getPromptHistoryPath(),
	options: AppendPromptOptions = {},
): Promise<boolean> {
	const trimmed = prompt.trim();
	if (!trimmed) return false;

	const cachedLastPrompt = lastPersistedPromptByPath.get(historyPath);
	const suppliedLastPrompt = options.lastPersistedPrompt;
	if (cachedLastPrompt === trimmed || suppliedLastPrompt === trimmed) {
		return false;
	}

	const lastPrompt = await readLastPrompt(historyPath);
	if (lastPrompt) lastPersistedPromptByPath.set(historyPath, lastPrompt);
	if (lastPrompt === trimmed) return false;

	await ensurePrivateDirectory(dirname(historyPath));
	await appendFile(
		historyPath,
		`${JSON.stringify({ ts: new Date().toISOString(), prompt: trimmed })}\n`,
		{ encoding: "utf8", mode: 0o600 },
	);
	await chmodIfPossible(historyPath, 0o600);
	lastPersistedPromptByPath.set(historyPath, trimmed);
	return true;
}
