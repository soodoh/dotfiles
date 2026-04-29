import { promises as fs } from "node:fs";
import path from "node:path";
function truncate(value, maxChars) {
    if (value.length <= maxChars)
        return value;
    return `${value.slice(0, maxChars)}…`;
}
function sanitizeValue(value, maxValueChars) {
    if (value === null || value === undefined)
        return value;
    if (typeof value === "string")
        return truncate(value, maxValueChars);
    if (typeof value === "number" || typeof value === "boolean")
        return value;
    if (Array.isArray(value))
        return value.slice(0, 40).map((item) => sanitizeValue(item, maxValueChars));
    if (typeof value === "object") {
        const out = {};
        for (const [key, nested] of Object.entries(value).slice(0, 40)) {
            out[key] = sanitizeValue(nested, maxValueChars);
        }
        return out;
    }
    return truncate(String(value), maxValueChars);
}
export class NdjsonEventLog {
    filePath;
    queue = Promise.resolve();
    maxEntries;
    maxValueChars;
    constructor(filePath, options = {}) {
        this.filePath = filePath;
        this.maxEntries = options.maxEntries ?? 2000;
        this.maxValueChars = options.maxValueChars ?? 1200;
    }
    async append(event) {
        this.queue = this.queue.then(async () => {
            const dir = path.dirname(this.filePath);
            await fs.mkdir(dir, { recursive: true });
            const payload = {
                ...event,
                meta: event.meta ? sanitizeValue(event.meta, this.maxValueChars) : undefined,
            };
            await fs.appendFile(this.filePath, `${JSON.stringify(payload)}\n`, "utf8");
            await this.rotateIfNeeded();
        });
        await this.queue;
    }
    async readRecent(limit, options) {
        try {
            const raw = await fs.readFile(this.filePath, "utf8");
            const lines = raw
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean);
            const parsed = lines
                .map((line) => {
                try {
                    return JSON.parse(line);
                }
                catch {
                    return null;
                }
            })
                .filter((entry) => entry !== null)
                .filter((entry) => !options?.messagePrefix || entry.message.startsWith(options.messagePrefix));
            return parsed.slice(-Math.max(1, limit));
        }
        catch (error) {
            if (error.code === "ENOENT")
                return [];
            throw new Error(`Failed to read event log ${this.filePath}: ${error.message}`);
        }
    }
    async rotateIfNeeded() {
        const raw = await fs.readFile(this.filePath, "utf8");
        const lines = raw
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
        if (lines.length <= this.maxEntries)
            return;
        const trimmed = `${lines.slice(-this.maxEntries).join("\n")}\n`;
        await fs.writeFile(this.filePath, trimmed, "utf8");
    }
}
