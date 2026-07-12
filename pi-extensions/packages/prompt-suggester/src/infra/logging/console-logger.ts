import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { EventLog } from "../../app/ports/event-log";
import type { Logger } from "../../app/ports/logger";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

function truncate(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}…`;
}

const MAX_META_DEPTH = 4;
const MAX_META_ENTRIES = 50;
const MAX_META_STRING_CHARS = 500;

function safeMetaValue(
	value: unknown,
	seen: WeakSet<object>,
	depth: number,
): unknown {
	if (typeof value === "string") return truncate(value, MAX_META_STRING_CHARS);
	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null
	) {
		return value;
	}
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "symbol") return value.toString();
	if (typeof value === "function") return "[Function]";
	if (typeof value !== "object") return undefined;
	if (seen.has(value)) return "[Circular]";
	if (depth >= MAX_META_DEPTH) return "[MaxDepth]";
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			return value
				.slice(0, MAX_META_ENTRIES)
				.map((entry) => safeMetaValue(entry, seen, depth + 1));
		}

		const out: Record<string, unknown> = {};
		let keys: string[];
		try {
			keys = Object.keys(value).slice(0, MAX_META_ENTRIES);
		} catch {
			return "[Unserializable]";
		}
		for (const key of keys) {
			try {
				out[key] = safeMetaValue(Reflect.get(value, key), seen, depth + 1);
			} catch {
				out[key] = "[Thrown]";
			}
		}
		return out;
	} finally {
		seen.delete(value);
	}
}

function safeSerializeMeta(meta: Record<string, unknown> | undefined): string {
	if (!meta) return "";
	let hasKeys = false;
	try {
		hasKeys = Object.keys(meta).length > 0;
	} catch {
		return " [unserializable meta]";
	}
	if (!hasKeys) return "";
	try {
		const serialized = JSON.stringify(safeMetaValue(meta, new WeakSet(), 0));
		return serialized ? ` ${truncate(serialized, 1000)}` : "";
	} catch {
		return " [unserializable meta]";
	}
}

interface ConsoleLoggerOptions {
	getContext?: () => ExtensionContext | undefined;
	statusKey?: string;
	mirrorToConsoleWhenNoUi?: boolean;
	eventLog?: EventLog;
	setWidgetLogStatus?: (
		status: { level: Level; text: string } | undefined,
	) => void;
}

export class ConsoleLogger implements Logger {
	private readonly statusKey: string;
	private readonly mirrorToConsoleWhenNoUi: boolean;

	public constructor(
		private readonly level: Level = "info",
		private readonly options: ConsoleLoggerOptions = {},
	) {
		this.statusKey = options.statusKey ?? "suggester-log";
		this.mirrorToConsoleWhenNoUi = options.mirrorToConsoleWhenNoUi ?? true;
	}

	public debug(message: string, meta?: Record<string, unknown>): void {
		this.log("debug", message, meta);
	}

	public info(message: string, meta?: Record<string, unknown>): void {
		this.log("info", message, meta);
	}

	public warn(message: string, meta?: Record<string, unknown>): void {
		this.log("warn", message, meta);
	}

	public error(message: string, meta?: Record<string, unknown>): void {
		this.log("error", message, meta);
	}

	private log(
		level: Level,
		message: string,
		meta?: Record<string, unknown>,
	): void {
		if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
		if (this.options.eventLog) {
			try {
				void this.options.eventLog
					.append({
						at: new Date().toISOString(),
						level,
						message,
						meta,
					})
					.catch(() => undefined);
			} catch {
				// Logging must not fail the extension when the event sink rejects metadata.
			}
		}
		const payload = safeSerializeMeta(meta);
		const line = truncate(`[suggester ${level}] ${message}${payload}`, 220);
		const statusLine = truncate(`[suggester ${level}] ${message}`, 120);
		try {
			this.options.setWidgetLogStatus?.(
				level === "warn" || level === "error"
					? { level, text: statusLine }
					: undefined,
			);
		} catch {
			// Logging must not fail the extension when the pi UI context has gone stale.
		}

		const ctx = this.options.getContext?.();
		try {
			if (ctx?.hasUI && !this.options.setWidgetLogStatus) {
				const theme = ctx.ui.theme;
				const colorized =
					level === "error"
						? theme.fg("error", statusLine)
						: level === "warn"
							? theme.fg("warning", statusLine)
							: level === "debug"
								? theme.fg("dim", statusLine)
								: theme.fg("muted", statusLine);
				ctx.ui.setStatus(this.statusKey, colorized);
				return;
			}
		} catch {
			// Treat stale UI contexts the same as no UI.
		}

		if (!this.mirrorToConsoleWhenNoUi) return;
		if (level === "error") console.error(line);
		else if (level === "warn") console.warn(line);
		else console.log(line);
	}
}
