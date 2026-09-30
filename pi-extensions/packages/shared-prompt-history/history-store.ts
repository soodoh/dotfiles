import { createReadStream } from "node:fs";
import { appendFile, chmod, mkdir, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { lock } from "proper-lockfile";

const HISTORY_FILE_NAME = "prompt-history.jsonl";
const TAIL_READ_CHUNK_SIZE = 8192;
const DEFAULT_HISTORY_PROMPT_LIMIT = 200;
const DEFAULT_HISTORY_TAIL_BYTES = 512 * 1024;

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

async function readTailLines(
	historyPath: string,
	maxBytes = DEFAULT_HISTORY_TAIL_BYTES,
): Promise<string[]> {
	let file: Awaited<ReturnType<typeof open>>;
	try {
		file = await open(historyPath, "r");
	} catch (error) {
		if (isNotFoundError(error)) return [];
		throw error;
	}

	try {
		const { size } = await file.stat();
		const length = Math.min(
			size,
			Math.max(TAIL_READ_CHUNK_SIZE, Math.floor(maxBytes)),
		);
		const position = size - length;
		const buffer = Buffer.alloc(length);
		const { bytesRead } = await file.read(buffer, 0, length, position);
		const bytes = buffer.subarray(0, bytesRead);
		// Discard a partial first record as bytes, then decode complete UTF-8 lines
		// once. Independent chunk decoding corrupts split multibyte characters.
		const start = position === 0 ? 0 : bytes.indexOf(10) + 1;
		if (position > 0 && start === 0) return [];
		return bytes.subarray(start).toString("utf8").split("\n");
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
	const lines = await readTailLines(historyPath, maxBytes);
	const prompts: string[] = [];
	for (
		let index = lines.length - 1;
		index >= 0 && prompts.length < maxPrompts;
		index--
	) {
		const prompt = parsePromptLine(lines[index]);
		if (prompt) prompts.push(prompt);
	}
	return prompts.reverse();
}

export async function appendPrompt(
	prompt: string,
	historyPath = getPromptHistoryPath(),
): Promise<boolean> {
	const trimmed = prompt.trim();
	if (!trimmed) return false;

	await ensurePrivateDirectory(dirname(historyPath));
	const file = await open(historyPath, "a", 0o600);
	await file.close();
	await chmodIfPossible(historyPath, 0o600);
	// Check-and-append is one cross-process critical section. Session-local
	// caches cannot identify the global last prompt after another session writes.
	const release = await lock(historyPath, {
		realpath: false,
		retries: { retries: 5, factor: 1, minTimeout: 10, maxTimeout: 10 },
	});
	try {
		const [lastPrompt] = await readPromptHistory(historyPath, {
			maxPrompts: 1,
		});
		if (lastPrompt === trimmed) return false;
		const reader = await open(historyPath, "r");
		let separator = "";
		try {
			const { size } = await reader.stat();
			if (size > 0) {
				const lastByte = Buffer.alloc(1);
				await reader.read(lastByte, 0, 1, size - 1);
				if (lastByte[0] !== 10) separator = "\n";
			}
		} finally {
			await reader.close();
		}
		await appendFile(
			historyPath,
			`${separator}${JSON.stringify({ ts: new Date().toISOString(), prompt: trimmed })}\n`,
			"utf8",
		);
		return true;
	} finally {
		await release();
	}
}
