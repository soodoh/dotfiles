import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, release } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import type { Counter } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	AggregationTemporality,
	MeterProvider,
	PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";

const execFileAsync = promisify(execFile);

const SERVICE_NAME = "claude-code";
const FALLBACK_CLAUDE_VERSION = "2.1.118";
const METER_NAME = "com.anthropic.claude_code";
const DEFAULT_EXPORT_INTERVAL_MILLIS = 60_000;
const ACTIVE_USER_WINDOW_MILLIS = 5_000;
const GIT_COMMIT_COMMAND_RE =
	/(?:^|[;&|()\s])(?:git\s+(?:-[^\s]+\s+)*commit)(?:\s|$)/i;
const GIT_COMMIT_OUTPUT_RE = /^\[[^\]\r\n]+\s+[0-9a-f]{4,}\]/gim;
const PR_CREATE_COMMAND_RE =
	/(?:^|[;&|()\s])(?:gh\s+pr\s+create|glab\s+mr\s+create|bb\s+pr\s+create)(?:\s|$)/i;
const PR_URL_RE =
	/https?:\/\/[^\s]+\/(?:pull|pull-requests|merge_requests)\/\d+/gi;
const PR_TOOL_RE =
	/(?:^|[_-])(?:create|open)[_-]?(?:pull[_-]?request|merge[_-]?request|pr|mr)(?:$|[_-])/i;
const EDIT_TOOL_RE =
	/(?:^|[_-])(?:edit|write|multi[_-]?edit|notebook[_-]?edit)(?:$|[_-])/i;
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
	".c": "C",
	".cc": "C++",
	".cpp": "C++",
	".cs": "C#",
	".css": "CSS",
	".go": "Go",
	".html": "HTML",
	".java": "Java",
	".js": "JavaScript",
	".jsx": "JavaScript",
	".json": "JSON",
	".kt": "Kotlin",
	".lua": "Lua",
	".md": "Markdown",
	".php": "PHP",
	".py": "Python",
	".rb": "Ruby",
	".rs": "Rust",
	".sh": "Shell",
	".sql": "SQL",
	".swift": "Swift",
	".ts": "TypeScript",
	".tsx": "TypeScript",
	".vue": "Vue",
	".xml": "XML",
	".yaml": "YAML",
	".yml": "YAML",
};
type StartType = "fresh" | "resume" | "continue";
export type OtelEventName =
	| "session_start"
	| "model_select"
	| "message_end"
	| "tool_call"
	| "tool_result"
	| "input"
	| "agent_start"
	| "agent_end"
	| "session_shutdown";

export type ModelLike = {
	id?: string;
	provider?: string;
};

export type ExtensionContextLike = {
	model?: ModelLike;
	cwd?: string;
};

type ToolResultEventLike = {
	toolCallId?: string;
	toolName: string;
	input: Record<string, unknown>;
	details?: unknown;
	isError: boolean;
	output: string;
	modelId: string;
};

type ToolCallLike = {
	toolCallId?: string;
	toolName: string;
	input: Record<string, unknown>;
};

export type OtelHandler = (
	event: unknown,
	ctx: ExtensionContextLike,
) => void | Promise<void>;

export type OtelExtensionApi = {
	on(eventName: OtelEventName, handler: OtelHandler): void;
};

type AssistantUsage = {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	costTotal?: number;
};

export type MetricsManagerLike = {
	readonly sessionId: string;
	start(startType: StartType): Promise<void>;
	stop(): Promise<void>;
	flush(): Promise<void>;
	recordTokenUsage(usage: AssistantUsage, modelId: string): void;
	recordCostUsage(cost: number, modelId: string): void;
	recordToolCall(event: ToolCallLike): Promise<void>;
	recordToolResult(event: ToolResultEventLike): void;
	recordUserActivity(): void;
	recordAgentStart(): void;
	recordAgentEnd(): void;
};

type CreateManagerOptions = {
	endpoint: string;
	headers: Record<string, string>;
	resourceAttributes: Record<string, string>;
	metricAttributes: Record<string, string>;
	temporality: AggregationTemporality;
	exportIntervalMillis: number;
	includeSessionId: boolean;
	permissionMode: string;
	effortLevel?: string;
	sessionId: string;
	recordSessionStart: boolean;
	versionResolver: () => Promise<string>;
	now: () => number;
};

type ClaudeOtelExtensionOptions = {
	providerName: string;
	managerFactory?: (options: CreateManagerOptions) => MetricsManagerLike;
	versionResolver?: () => Promise<string>;
	now?: () => number;
};

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
	typeof value === "object" && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const hasString = <Key extends string>(
	value: Record<PropertyKey, unknown>,
	key: Key,
): value is Record<PropertyKey, unknown> & Record<Key, string> =>
	typeof value[key] === "string";

const readNumber = (
	record: Record<PropertyKey, unknown>,
	key: string,
): number | undefined => {
	const value = record[key];
	return isFiniteNumber(value) ? value : undefined;
};

const readBoolean = (
	value: string | undefined,
	defaultValue: boolean,
): boolean => {
	if (value === undefined) return defaultValue;
	return value.trim().toLowerCase() !== "false";
};

const readPositiveInteger = (
	value: string | undefined,
	defaultValue: number,
): number => {
	if (value === undefined) return defaultValue;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
};

export const parseKeyValueList = (
	value: string | undefined,
): Record<string, string> => {
	const entries: Record<string, string> = {};
	if (!value?.trim()) return entries;

	for (const rawPart of value.split(",")) {
		const part = rawPart.trim();
		if (!part) continue;
		const separatorIndex = part.indexOf("=");
		if (separatorIndex <= 0) continue;
		const key = part.slice(0, separatorIndex).trim();
		const entryValue = part.slice(separatorIndex + 1).trim();
		if (key) entries[key] = entryValue;
	}

	return entries;
};

export const parseResourceAttributes = (
	value: string | undefined,
): Record<string, string> => {
	if (!value?.trim()) return {};
	const attributes: Record<string, string> = {};
	try {
		for (const rawEntry of value.split(",").filter(Boolean)) {
			const parts = rawEntry.split("=");
			if (parts.length !== 2) return {};
			const rawKey = parts[0];
			const rawValue = parts[1];
			const allowedEncodedValue =
				/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;
			if (
				!rawKey ||
				rawValue === undefined ||
				!allowedEncodedValue.test(rawKey) ||
				!allowedEncodedValue.test(rawValue)
			) {
				return {};
			}
			const key = decodeURIComponent(rawKey);
			const entryValue = decodeURIComponent(rawValue);
			if (key.length > 255 || entryValue.length > 255) return {};
			attributes[key] = entryValue;
		}
	} catch {
		return {};
	}
	return attributes;
};

export const countLines = (text: string): number => {
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!normalized) return 0;
	const withoutFinalNewline = normalized.endsWith("\n")
		? normalized.slice(0, -1)
		: normalized;
	return withoutFinalNewline ? withoutFinalNewline.split("\n").length : 0;
};

const toLines = (text: string): string[] => {
	const count = countLines(text);
	if (count === 0) return [];
	return text
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/\n$/, "")
		.split("\n");
};

export const diffLineCounts = (
	oldText: string,
	newText: string,
): { added: number; removed: number } => {
	let oldLines = toLines(oldText);
	let newLines = toLines(newText);

	while (oldLines[0] !== undefined && oldLines[0] === newLines[0]) {
		oldLines = oldLines.slice(1);
		newLines = newLines.slice(1);
	}
	while (oldLines.at(-1) !== undefined && oldLines.at(-1) === newLines.at(-1)) {
		oldLines = oldLines.slice(0, -1);
		newLines = newLines.slice(0, -1);
	}

	const lcs = new Array<number>(newLines.length + 1).fill(0);
	for (const oldLine of oldLines) {
		let diagonal = 0;
		for (let index = 1; index <= newLines.length; index++) {
			const previous = lcs[index] ?? 0;
			if (oldLine === newLines[index - 1]) {
				lcs[index] = diagonal + 1;
			} else {
				lcs[index] = Math.max(lcs[index - 1] ?? 0, previous);
			}
			diagonal = previous;
		}
	}
	const unchanged = lcs[newLines.length] ?? 0;
	return {
		added: newLines.length - unchanged,
		removed: oldLines.length - unchanged,
	};
};

export const countUnifiedDiffLines = (
	diff: string,
): { added: number; removed: number } => {
	let added = 0;
	let removed = 0;
	for (const line of diff.replace(/\r\n/g, "\n").split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) added += 1;
		else if (line.startsWith("-")) removed += 1;
	}
	return { added, removed };
};

export const parseClaudeVersion = (output: string): string => {
	return output.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? FALLBACK_CLAUDE_VERSION;
};

export const resolveClaudeVersion = async (): Promise<string> => {
	try {
		const { stdout } = await execFileAsync("claude", ["--version"]);
		return parseClaudeVersion(stdout);
	} catch {
		return FALLBACK_CLAUDE_VERSION;
	}
};

export const sessionStartTypeFromReason = (reason: string): StartType =>
	reason === "resume" ? "resume" : "fresh";

const createResourceAttributes = async (
	versionResolver: () => Promise<string>,
): Promise<{
	resourceAttributes: Record<string, string>;
	metricAttributes: Record<string, string>;
}> => {
	const customAttributes = parseResourceAttributes(
		process.env.OTEL_RESOURCE_ATTRIBUTES,
	);
	const version = await versionResolver();
	const terminalType = process.env.TERM_PROGRAM?.trim();
	const anonymousUserId = loadClaudeAnonymousId();
	const resourceAttributes: Record<string, string> = {
		...customAttributes,
		"service.name": SERVICE_NAME,
		"service.version": version,
		"os.type": process.platform,
		"os.version": release(),
		"host.arch": process.arch,
	};
	const metricAttributes = readBoolean(
		process.env.OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES,
		true,
	)
		? { ...customAttributes }
		: {};

	if (anonymousUserId) {
		resourceAttributes["user.id"] = anonymousUserId;
		metricAttributes["user.id"] = anonymousUserId;
	}
	if (terminalType) {
		resourceAttributes["terminal.type"] = terminalType;
		metricAttributes["terminal.type"] = terminalType;
	}
	if (readBoolean(process.env.OTEL_METRICS_INCLUDE_VERSION, false)) {
		metricAttributes["app.version"] = version;
	}

	return { resourceAttributes, metricAttributes };
};

const getUsageFromMessage = (message: unknown): AssistantUsage | undefined => {
	if (!isRecord(message) || message.role !== "assistant") return undefined;
	if (!isRecord(message.usage)) return undefined;

	const cost = isRecord(message.usage.cost) ? message.usage.cost : undefined;
	return {
		input: readNumber(message.usage, "input"),
		output: readNumber(message.usage, "output"),
		cacheRead: readNumber(message.usage, "cacheRead"),
		cacheWrite: readNumber(message.usage, "cacheWrite"),
		costTotal: cost ? readNumber(cost, "total") : undefined,
	};
};

const getMessageModel = (message: unknown): string | undefined =>
	isRecord(message) && typeof message.model === "string"
		? message.model
		: undefined;

const getMessageProvider = (message: unknown): string | undefined =>
	isRecord(message) && typeof message.provider === "string"
		? message.provider
		: undefined;

const readString = (
	record: Record<PropertyKey, unknown>,
	key: string,
): string | undefined =>
	typeof record[key] === "string" ? record[key] : undefined;

const languageFromInput = (input: Record<string, unknown>): string => {
	const path =
		readString(input, "path") ??
		readString(input, "file_path") ??
		readString(input, "filePath") ??
		readString(input, "notebook_path");
	return path
		? (LANGUAGE_BY_EXTENSION[extname(path).toLowerCase()] ?? "unknown")
		: "unknown";
};

const loadClaudeAnonymousId = (): string | undefined => {
	try {
		const state = JSON.parse(
			readFileSync(join(homedir(), ".claude.json"), "utf8"),
		);
		return typeof state.anonymousId === "string"
			? state.anonymousId
			: undefined;
	} catch {
		return undefined;
	}
};

const loadClaudeSettings = (): {
	permissionMode: string;
	effortLevel?: string;
} => {
	try {
		const settingsPath = join(homedir(), ".claude", "settings.json");
		if (!existsSync(settingsPath)) return { permissionMode: "default" };
		const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
		return {
			permissionMode:
				isRecord(settings.permissions) &&
				typeof settings.permissions.defaultMode === "string"
					? settings.permissions.defaultMode
					: "default",
			effortLevel:
				typeof settings.effortLevel === "string"
					? settings.effortLevel
					: undefined,
		};
	} catch {
		return { permissionMode: "default" };
	}
};

const getEventText = (event: Record<PropertyKey, unknown>): string => {
	if (!Array.isArray(event.content)) return "";
	return event.content
		.flatMap((block): string[] =>
			isRecord(block) && block.type === "text" && typeof block.text === "string"
				? [block.text]
				: [],
		)
		.join("\n");
};

const isEditReplacement = (
	value: unknown,
): value is { oldText: string; newText: string } =>
	isRecord(value) &&
	typeof value.oldText === "string" &&
	typeof value.newText === "string";

const addPositive = (
	counter: Counter | undefined,
	value: number | undefined,
	attributes: Record<string, string>,
): void => {
	if (!counter || !isFiniteNumber(value) || value <= 0) return;
	counter.add(value, attributes);
};

export class OtelMetricsManager implements MetricsManagerLike {
	readonly sessionId: string;
	private meterProvider: MeterProvider | undefined;
	private metricReader: PeriodicExportingMetricReader | undefined;
	private sessionCounter: Counter | undefined;
	private tokenCounter: Counter | undefined;
	private costCounter: Counter | undefined;
	private activeTimeCounter: Counter | undefined;
	private linesCounter: Counter | undefined;
	private commitCounter: Counter | undefined;
	private pullRequestCounter: Counter | undefined;
	private editDecisionCounter: Counter | undefined;

	private activeTimeTimer: ReturnType<typeof setInterval> | undefined;
	private cliStartedAt: number | undefined;
	private lastCliFlushAt: number | undefined;
	private userActiveUntil: number | undefined;
	private lastUserFlushAt: number | undefined;
	private readonly decidedToolCalls = new Set<string>();

	constructor(private readonly options: CreateManagerOptions) {
		this.sessionId = options.sessionId;
	}

	async start(startType: StartType): Promise<void> {
		const exporter = new OTLPMetricExporter({
			url: this.options.endpoint,
			headers: this.options.headers,
			temporalityPreference: this.options.temporality,
		});
		this.metricReader = new PeriodicExportingMetricReader({
			exporter,
			exportIntervalMillis: this.options.exportIntervalMillis,
		});
		this.meterProvider = new MeterProvider({
			resource: resourceFromAttributes(this.options.resourceAttributes),
			readers: [this.metricReader],
		});
		const meter = this.meterProvider.getMeter(METER_NAME);
		this.sessionCounter = meter.createCounter("claude_code.session.count", {
			unit: "count",
		});
		this.tokenCounter = meter.createCounter("claude_code.token.usage", {
			unit: "tokens",
		});
		this.costCounter = meter.createCounter("claude_code.cost.usage", {
			unit: "USD",
		});
		this.activeTimeCounter = meter.createCounter(
			"claude_code.active_time.total",
			{ unit: "s" },
		);
		this.linesCounter = meter.createCounter("claude_code.lines_of_code.count", {
			unit: "count",
		});
		this.pullRequestCounter = meter.createCounter(
			"claude_code.pull_request.count",
			{ unit: "count" },
		);
		this.commitCounter = meter.createCounter("claude_code.commit.count", {
			unit: "count",
		});
		this.editDecisionCounter = meter.createCounter(
			"claude_code.code_edit_tool.decision",
			{ unit: "count" },
		);
		this.activeTimeTimer = setInterval(
			() => this.flushOpenCliTime(),
			this.options.exportIntervalMillis,
		);
		if (this.options.recordSessionStart) {
			this.sessionCounter.add(1, {
				...this.commonAttributes(),
				start_type: startType,
			});
		}
	}

	async flush(): Promise<void> {
		this.flushOpenCliTime();
		this.flushOpenUserTime();
		await this.meterProvider?.forceFlush();
	}

	async stop(): Promise<void> {
		if (this.activeTimeTimer) {
			clearInterval(this.activeTimeTimer);
			this.activeTimeTimer = undefined;
		}
		this.flushOpenCliTime();
		this.flushOpenUserTime();
		const meterProvider = this.meterProvider;
		this.meterProvider = undefined;
		this.metricReader = undefined;
		this.sessionCounter = undefined;
		this.tokenCounter = undefined;
		this.costCounter = undefined;
		this.activeTimeCounter = undefined;
		this.linesCounter = undefined;
		this.commitCounter = undefined;
		this.pullRequestCounter = undefined;
		this.editDecisionCounter = undefined;

		this.cliStartedAt = undefined;
		this.lastCliFlushAt = undefined;
		this.userActiveUntil = undefined;
		this.lastUserFlushAt = undefined;
		this.decidedToolCalls.clear();
		await meterProvider?.shutdown();
	}

	recordTokenUsage(usage: AssistantUsage, modelId: string): void {
		const commonAttributes = {
			...this.commonAttributes(),
			model: modelId,
			query_source: "main",
			...(this.options.effortLevel ? { effort: this.options.effortLevel } : {}),
		};
		addPositive(this.tokenCounter, usage.input, {
			...commonAttributes,
			type: "input",
		});
		addPositive(this.tokenCounter, usage.output, {
			...commonAttributes,
			type: "output",
		});
		addPositive(this.tokenCounter, usage.cacheRead, {
			...commonAttributes,
			type: "cacheRead",
		});
		addPositive(this.tokenCounter, usage.cacheWrite, {
			...commonAttributes,
			type: "cacheCreation",
		});
	}

	recordCostUsage(cost: number, modelId: string): void {
		addPositive(this.costCounter, cost, {
			...this.commonAttributes(),
			model: modelId,
			query_source: "main",
			...(this.options.effortLevel ? { effort: this.options.effortLevel } : {}),
		});
	}

	async recordToolCall(event: ToolCallLike): Promise<void> {
		if (!EDIT_TOOL_RE.test(event.toolName)) return;
		if (event.toolCallId) this.decidedToolCalls.add(event.toolCallId);
		this.editDecisionCounter?.add(1, {
			...this.commonAttributes(),
			tool_name: this.normalizedEditToolName(event.toolName),
			decision: "accept",
			source:
				this.options.permissionMode === "bypassPermissions"
					? "config"
					: "user_temporary",
			language: languageFromInput(event.input),
		});
	}

	recordToolResult(event: ToolResultEventLike): void {
		if (event.toolCallId) this.decidedToolCalls.delete(event.toolCallId);
		if (event.isError) return;

		if (event.toolName === "edit") {
			const details = isRecord(event.details) ? event.details : undefined;
			const diff = details ? readString(details, "diff") : undefined;
			const counts = diff ? countUnifiedDiffLines(diff) : undefined;
			if (counts) {
				this.recordLineCounts(counts.added, counts.removed, event.modelId);
			} else {
				const edits = Array.isArray(event.input.edits)
					? event.input.edits.filter(isEditReplacement)
					: [];
				let added = 0;
				let removed = 0;
				for (const edit of edits) {
					const editCounts = diffLineCounts(edit.oldText, edit.newText);
					added += editCounts.added;
					removed += editCounts.removed;
				}
				this.recordLineCounts(added, removed, event.modelId);
			}
		} else if (event.toolName === "write") {
			this.recordLineCounts(
				countLines(readString(event.input, "content") ?? ""),
				0,
				event.modelId,
			);
		}

		if (event.toolName === "bash") {
			const command = readString(event.input, "command") ?? "";
			if (GIT_COMMIT_COMMAND_RE.test(command)) {
				const commits = event.output.match(GIT_COMMIT_OUTPUT_RE)?.length ?? 0;
				addPositive(this.commitCounter, commits || 1, this.commonAttributes());
			}
			if (PR_CREATE_COMMAND_RE.test(command)) {
				const urls = new Set(event.output.match(PR_URL_RE) ?? []);
				addPositive(
					this.pullRequestCounter,
					urls.size || 1,
					this.commonAttributes(),
				);
			}
		} else if (PR_TOOL_RE.test(event.toolName)) {
			addPositive(this.pullRequestCounter, 1, this.commonAttributes());
		}
	}

	recordUserActivity(): void {
		const now = this.options.now();
		this.flushOpenUserTime();
		this.lastUserFlushAt = now;
		this.userActiveUntil = now + ACTIVE_USER_WINDOW_MILLIS;
	}

	recordAgentStart(): void {
		this.flushOpenCliTime();
		this.flushOpenUserTime();
		this.userActiveUntil = undefined;
		this.lastUserFlushAt = undefined;
		const now = this.options.now();
		this.cliStartedAt = now;
		this.lastCliFlushAt = now;
	}

	recordAgentEnd(): void {
		this.flushOpenCliTime();
		this.cliStartedAt = undefined;
		this.lastCliFlushAt = undefined;
		this.recordUserActivity();
	}

	private commonAttributes(): Record<string, string> {
		return {
			...this.options.metricAttributes,
			...(this.options.includeSessionId
				? { "session.id": this.sessionId }
				: {}),
		};
	}

	private recordLineCounts(
		added: number,
		removed: number,
		modelId: string,
	): void {
		addPositive(this.linesCounter, added, {
			...this.commonAttributes(),
			model: modelId,
			type: "added",
		});
		addPositive(this.linesCounter, removed, {
			...this.commonAttributes(),
			model: modelId,
			type: "removed",
		});
	}

	private normalizedEditToolName(toolName: string): string {
		const normalized = toolName.toLowerCase();
		if (normalized.includes("notebook")) return "NotebookEdit";
		if (normalized.includes("write")) return "Write";
		return "Edit";
	}

	private recordActiveTime(millis: number, type: "cli" | "user"): void {
		addPositive(this.activeTimeCounter, millis / 1000, {
			...this.commonAttributes(),
			type,
		});
	}

	private flushOpenCliTime(): void {
		if (this.cliStartedAt === undefined || this.lastCliFlushAt === undefined) {
			return;
		}
		const now = this.options.now();
		this.recordActiveTime(now - this.lastCliFlushAt, "cli");
		this.lastCliFlushAt = now;
	}

	private flushOpenUserTime(): void {
		if (
			this.userActiveUntil === undefined ||
			this.lastUserFlushAt === undefined
		) {
			return;
		}
		const now = this.options.now();
		const activeThrough = Math.min(now, this.userActiveUntil);
		this.recordActiveTime(activeThrough - this.lastUserFlushAt, "user");
		this.lastUserFlushAt = activeThrough;
		if (now >= this.userActiveUntil) {
			this.userActiveUntil = undefined;
			this.lastUserFlushAt = undefined;
		}
	}
}

const createDefaultManager = (
	options: CreateManagerOptions,
): MetricsManagerLike => new OtelMetricsManager(options);

const makeManagerOptions = async (
	versionResolver: () => Promise<string>,
	now: () => number,
	sessionId: string,
	recordSessionStart: boolean,
): Promise<CreateManagerOptions | undefined> => {
	if (process.env.CLAUDE_CODE_ENABLE_TELEMETRY?.trim() !== "1") {
		return undefined;
	}
	const exporters = (process.env.OTEL_METRICS_EXPORTER ?? "")
		.split(",")
		.map((value) => value.trim().toLowerCase());
	const metricsEndpoint =
		process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim();
	const generalEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
	const endpoint = metricsEndpoint
		? metricsEndpoint
		: generalEndpoint
			? `${generalEndpoint.replace(/\/+$/, "")}/v1/metrics`
			: undefined;
	const protocol = (
		process.env.OTEL_EXPORTER_OTLP_METRICS_PROTOCOL ??
		process.env.OTEL_EXPORTER_OTLP_PROTOCOL ??
		"http/json"
	)
		.trim()
		.toLowerCase();
	if (!exporters.includes("otlp") || !endpoint || protocol !== "http/json") {
		return undefined;
	}
	const headers = parseKeyValueList(
		process.env.OTEL_EXPORTER_OTLP_METRICS_HEADERS ??
			process.env.OTEL_EXPORTER_OTLP_HEADERS,
	);
	const { resourceAttributes, metricAttributes } =
		await createResourceAttributes(versionResolver);
	const claudeSettings = loadClaudeSettings();
	const temporality =
		process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE?.trim().toLowerCase() ===
		"cumulative"
			? AggregationTemporality.CUMULATIVE
			: AggregationTemporality.DELTA;
	return {
		endpoint,
		headers,
		resourceAttributes,
		metricAttributes,
		temporality,
		exportIntervalMillis: readPositiveInteger(
			process.env.OTEL_METRIC_EXPORT_INTERVAL,
			DEFAULT_EXPORT_INTERVAL_MILLIS,
		),
		includeSessionId: readBoolean(
			process.env.OTEL_METRICS_INCLUDE_SESSION_ID,
			true,
		),
		permissionMode: claudeSettings.permissionMode,
		effortLevel: claudeSettings.effortLevel,
		sessionId,
		recordSessionStart,
		versionResolver,
		now,
	};
};

export const createClaudeOtelExtension = ({
	providerName,
	managerFactory = createDefaultManager,
	versionResolver = resolveClaudeVersion,
	now = Date.now,
}: ClaudeOtelExtensionOptions) => {
	let manager: MetricsManagerLike | undefined;
	let transition = Promise.resolve();
	const sessionId = crypto.randomUUID();
	let sessionCountRecorded = false;

	const stopManager = async (): Promise<void> => {
		const current = manager;
		manager = undefined;
		if (!current) return;
		try {
			await current.flush();
		} finally {
			await current.stop().catch(() => undefined);
		}
	};

	const startManager = async (startType: StartType): Promise<void> => {
		await stopManager().catch(() => undefined);
		const options = await makeManagerOptions(
			versionResolver,
			now,
			sessionId,
			!sessionCountRecorded,
		);
		if (!options) return;
		const nextManager = managerFactory(options);
		manager = nextManager;
		try {
			await nextManager.start(startType);
			sessionCountRecorded = true;
		} catch {
			if (manager === nextManager) manager = undefined;
			await nextManager.stop().catch(() => undefined);
		}
	};

	const applyGate = (
		model: ModelLike | undefined,
		startType: StartType,
	): Promise<void> => {
		transition = transition
			.catch(() => undefined)
			.then(async () => {
				if (model?.provider !== providerName) {
					await stopManager().catch(() => undefined);
					return;
				}
				if (!manager) await startManager(startType);
			});
		return transition;
	};

	return (pi: OtelExtensionApi): void => {
		pi.on("session_start", async (event, ctx) => {
			if (!isRecord(event) || !hasString(event, "reason")) return;
			await applyGate(ctx.model, sessionStartTypeFromReason(event.reason));
		});

		pi.on("model_select", async (event, ctx) => {
			if (!isRecord(event)) return;
			const model = isRecord(event.model) ? event.model : ctx.model;
			await applyGate(model, "fresh");
		});

		pi.on("message_end", (event, ctx) => {
			if (
				!isRecord(event) ||
				!("message" in event) ||
				!manager ||
				ctx.model?.provider !== providerName
			) {
				return;
			}
			const messageProvider = getMessageProvider(event.message);
			if (messageProvider && messageProvider !== providerName) return;
			const usage = getUsageFromMessage(event.message);
			const modelId = getMessageModel(event.message) ?? ctx.model.id;
			if (!usage || !modelId) return;
			manager.recordTokenUsage(usage, modelId);
			if (usage.costTotal !== undefined) {
				manager.recordCostUsage(usage.costTotal, modelId);
			}
		});

		pi.on("tool_call", async (event, ctx) => {
			if (
				!isRecord(event) ||
				!hasString(event, "toolName") ||
				!isRecord(event.input) ||
				ctx.model?.provider !== providerName
			) {
				return;
			}
			await manager?.recordToolCall({
				toolCallId: readString(event, "toolCallId"),
				toolName: event.toolName,
				input: event.input,
			});
		});

		pi.on("tool_result", (event, ctx) => {
			if (
				!isRecord(event) ||
				!hasString(event, "toolName") ||
				!isRecord(event.input) ||
				typeof event.isError !== "boolean" ||
				ctx.model?.provider !== providerName ||
				!ctx.model.id
			) {
				return;
			}
			manager?.recordToolResult({
				toolCallId: readString(event, "toolCallId"),
				toolName: event.toolName,
				input: event.input,
				details: event.details,
				isError: event.isError,
				output: getEventText(event),
				modelId: ctx.model.id,
			});
		});

		pi.on("input", (_event, ctx) => {
			if (ctx.model?.provider === providerName) manager?.recordUserActivity();
		});

		pi.on("agent_start", (_event, ctx) => {
			if (ctx.model?.provider === providerName) manager?.recordAgentStart();
		});

		pi.on("agent_end", (_event, ctx) => {
			if (ctx.model?.provider === providerName) manager?.recordAgentEnd();
		});

		pi.on("session_shutdown", async () => {
			await transition.catch(() => undefined);
			await stopManager().catch(() => undefined);
		});
	};
};
