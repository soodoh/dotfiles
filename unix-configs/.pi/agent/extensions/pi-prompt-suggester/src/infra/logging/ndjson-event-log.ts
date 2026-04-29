import { promises as fs } from "node:fs";
import path from "node:path";
import type { EventLog, LoggedEvent } from "../../app/ports/event-log.js";

export interface NdjsonEventLogOptions {
	maxEntries?: number;
	maxValueChars?: number;
}

function truncate(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}…`;
}

function sanitizeValue(value: unknown, maxValueChars: number): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value === "string") return truncate(value, maxValueChars);
	if (typeof value === "number" || typeof value === "boolean") return value;
	if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitizeValue(item, maxValueChars));
	if (typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
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
		this.queue = this.queue.then(async () => {
			const dir = path.dirname(this.filePath);
			await fs.mkdir(dir, { recursive: true });
			const payload: LoggedEvent = {
				...event,
				meta: event.meta ? (sanitizeValue(event.meta, this.maxValueChars) as Record<string, unknown>) : undefined,
			};
			await fs.appendFile(this.filePath, `${JSON.stringify(payload)}\n`, "utf8");
			await this.rotateIfNeeded();
		});
		await this.queue;
	}

	public async readRecent(limit: number, options?: { messagePrefix?: string }): Promise<LoggedEvent[]> {
		try {
			const raw = await fs.readFile(this.filePath, "utf8");
			const lines = raw
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter(Boolean);
			const parsed = lines
				.map((line) => {
					try {
						return JSON.parse(line) as LoggedEvent;
					} catch {
						return null;
					}
				})
				.filter((entry): entry is LoggedEvent => entry !== null)
				.filter((entry) => !options?.messagePrefix || entry.message.startsWith(options.messagePrefix));
			return parsed.slice(-Math.max(1, limit));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw new Error(`Failed to read event log ${this.filePath}: ${(error as Error).message}`);
		}
	}

	private async rotateIfNeeded(): Promise<void> {
		const raw = await fs.readFile(this.filePath, "utf8");
		const lines = raw
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		if (lines.length <= this.maxEntries) return;
		const trimmed = `${lines.slice(-this.maxEntries).join("\n")}\n`;
		await fs.writeFile(this.filePath, trimmed, "utf8");
	}
}
