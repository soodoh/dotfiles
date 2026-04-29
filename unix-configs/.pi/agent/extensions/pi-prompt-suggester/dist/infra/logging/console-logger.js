const LEVEL_ORDER = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
function truncate(value, maxChars) {
    if (value.length <= maxChars)
        return value;
    return `${value.slice(0, maxChars)}…`;
}
export class ConsoleLogger {
    level;
    options;
    statusKey;
    mirrorToConsoleWhenNoUi;
    constructor(level = "info", options = {}) {
        this.level = level;
        this.options = options;
        this.statusKey = options.statusKey ?? "suggester-log";
        this.mirrorToConsoleWhenNoUi = options.mirrorToConsoleWhenNoUi ?? true;
    }
    debug(message, meta) {
        this.log("debug", message, meta);
    }
    info(message, meta) {
        this.log("info", message, meta);
    }
    warn(message, meta) {
        this.log("warn", message, meta);
    }
    error(message, meta) {
        this.log("error", message, meta);
    }
    log(level, message, meta) {
        if (this.options.eventLog) {
            void this.options.eventLog
                .append({
                at: new Date().toISOString(),
                level,
                message,
                meta,
            })
                .catch(() => undefined);
        }
        if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level])
            return;
        const payload = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
        const line = truncate(`[suggester ${level}] ${message}${payload}`, 220);
        const statusLine = truncate(`[suggester ${level}] ${message}`, 120);
        const ctx = this.options.getContext?.();
        this.options.setWidgetLogStatus?.(level === "warn" || level === "error" ? { level, text: statusLine } : undefined);
        if (ctx?.hasUI && !this.options.setWidgetLogStatus) {
            const theme = ctx.ui.theme;
            const colorized = level === "error"
                ? theme.fg("error", statusLine)
                : level === "warn"
                    ? theme.fg("warning", statusLine)
                    : level === "debug"
                        ? theme.fg("dim", statusLine)
                        : theme.fg("muted", statusLine);
            ctx.ui.setStatus(this.statusKey, colorized);
            return;
        }
        if (!this.mirrorToConsoleWhenNoUi)
            return;
        if (level === "error")
            console.error(line);
        else if (level === "warn")
            console.warn(line);
        else
            console.log(line);
    }
}
