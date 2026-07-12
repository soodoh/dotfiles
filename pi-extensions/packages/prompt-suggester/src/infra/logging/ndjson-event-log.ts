import { promises as fs } from "node:fs";
import path from "node:path";
import type { EventLog, LoggedEvent } from "../../app/ports/event-log";
import {
	appendPrivateFile,
	ensurePrivateDirectory,
	writePrivateFile,
} from "../storage/private-fs";

interface NdjsonEventLogOptions {
	maxEntries?: number;
	maxValueChars?: number;
}

function truncate(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function sanitizeValue(value: unknown, maxValueChars: number): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value === "string") return truncate(value, maxValueChars);
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (Array.isArray(value))
		return value.slice(0, 40).map((item) => sanitizeValue(item, maxValueChars));
	if (isRecord(value)) {
		const out: Record<string, unknown> = {};
		for (const [key, nested] of Object.entries(value).slice(0, 40)) {
			out[key] = sanitizeValue(nested, maxValueChars);
		}
		return out;
	}
	return truncate(String(value), maxValueChars);
}

export class NdjsonEventLog implements EventLog {
	private queue: Promise<void> = Promise.resolve();
	private readonly maxEntries: number;
	private readonly maxValueChars: number;

	public constructor(
		private readonly filePath: string,
		options: NdjsonEventLogOptions = {},
	) {
		this.maxEntries = options.maxEntries ?? 2000;
		this.maxValueChars = options.maxValueChars ?? 1200;
	}

	public async append(event: LoggedEvent): Promise<void> {
		const write = this.queue
			.catch(() => undefined)
			.then(async () => {
				const dir = path.dirname(this.filePath);
				await ensurePrivateDirectory(dir);
				const sanitizedMeta = event.meta
					? sanitizeValue(event.meta, this.maxValueChars)
					: undefined;
				const payload: LoggedEvent = {
					...event,
					meta: isRecord(sanitizedMeta) ? sanitizedMeta : undefined,
				};
				await appendPrivateFile(this.filePath, `${JSON.stringify(payload)}\n`);
				await this.rotateIfNeeded();
			});
		this.queue = write.catch(() => undefined);
		await write;
	}

	private async rotateIfNeeded(): Promise<void> {
		const raw = await fs.readFile(this.filePath, "utf8");
		const lines = raw
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		if (lines.length <= this.maxEntries) return;
		const trimmed = `${lines.slice(-this.maxEntries).join("\n")}\n`;
		await writePrivateFile(this.filePath, trimmed);
	}
}
