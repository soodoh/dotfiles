import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, release } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
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
const EXPORT_INTERVAL_MILLIS = 60_000;
const GIT_COMMIT_RE = /\bgit\s+commit\b/;
const GH_PR_CREATE_RE = /\bgh\s+pr\s+create\b/;

type StartType = "fresh" | "resume" | "continue";
type SessionStartReason = "startup" | "reload" | "new" | "resume" | "fork";
export type OtelEventName =
	| "session_start"
	| "model_select"
	| "message_end"
	| "tool_result"
	| "agent_start"
	| "agent_end"
	| "input"
	| "session_shutdown";

export type ModelLike = {
	id?: string;
	provider?: string;
};

export type ExtensionContextLike = {
	model?: ModelLike;
};

type SessionStartEventLike = {
	reason: SessionStartReason;
};

type ModelSelectEventLike = {
	model?: ModelLike;
	previousModel?: ModelLike;
};

type MessageEndEventLike = {
	message: unknown;
};

type ToolResultEventLike = {
	toolName: string;
	input: Record<string, unknown>;
	isError: boolean;
};

type InputEventLike = {
	text?: string;
};

type SessionShutdownEventLike = {
	reason?: string;
};

type OtelEventMap = {
	session_start: SessionStartEventLike;
	model_select: ModelSelectEventLike;
	message_end: MessageEndEventLike;
	tool_result: ToolResultEventLike;
	agent_start: Record<string, never>;
	agent_end: Record<string, never>;
	input: InputEventLike;
	session_shutdown: SessionShutdownEventLike;
};

export type OtelExtensionApi = {
	on<EventName extends OtelEventName>(
		eventName: EventName,
		handler: (
			event: OtelEventMap[EventName],
			ctx: ExtensionContextLike,
		) => void | Promise<void>,
	): void;
};

type OtelSettings = {
	enabledProviders: string[];
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
	recordToolResult(event: ToolResultEventLike): void;
	recordAgentStart(): void;
	recordAgentEnd(): void;
	recordInput(): void;
};

type CreateManagerOptions = {
	endpoint: string;
	headers: Record<string, string>;
	resourceAttributes: Record<string, string>;
	versionResolver: () => Promise<string>;
	now: () => number;
};

type ClaudeOtelExtensionOptions = {
	settingsReader?: () => Promise<OtelSettings>;
	managerFactory?: (options: CreateManagerOptions) => MetricsManagerLike;
	versionResolver?: () => Promise<string>;
	now?: () => number;
};

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
	typeof value === "object" && value !== null;

const isFiniteNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);

const readString = (
	record: Record<PropertyKey, unknown>,
	key: string,
): string | undefined => {
	const value = record[key];
	return typeof value === "string" ? value : undefined;
};

const readNumber = (
	record: Record<PropertyKey, unknown>,
	key: string,
): number | undefined => {
	const value = record[key];
	return isFiniteNumber(value) ? value : undefined;
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

export const countLines = (text: string): number => {
	const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	if (!normalized) return 0;
	const withoutFinalNewline = normalized.endsWith("\n")
		? normalized.slice(0, -1)
		: normalized;
	return withoutFinalNewline ? withoutFinalNewline.split("\n").length : 0;
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

export const readOtelSettings = async (): Promise<OtelSettings> => {
	const configDir =
		process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	try {
		const content = await readFile(join(configDir, "settings.json"), "utf8");
		const parsed = JSON.parse(content);
		const otel =
			isRecord(parsed) && isRecord(parsed.otel) ? parsed.otel : undefined;
		const enabledProviders = Array.isArray(otel?.enabledProviders)
			? otel.enabledProviders
					.filter((entry): entry is string => typeof entry === "string")
					.map((entry) => entry.trim())
					.filter(Boolean)
			: [];
		return { enabledProviders };
	} catch {
		return { enabledProviders: [] };
	}
};

export const sessionStartTypeFromReason = (
	reason: SessionStartReason,
): StartType => (reason === "resume" ? "resume" : "fresh");

const createResourceAttributes = async (
	versionResolver: () => Promise<string>,
): Promise<Record<string, string>> => {
	const attributes: Record<string, string> = {
		...parseKeyValueList(process.env.OTEL_RESOURCE_ATTRIBUTES),
		"service.name": SERVICE_NAME,
		"service.version": await versionResolver(),
		"os.type": process.platform,
		"os.version": release(),
		"host.arch": process.arch,
	};

	if (process.env.TERM_PROGRAM?.trim()) {
		attributes["terminal.type"] = process.env.TERM_PROGRAM.trim();
	}

	return attributes;
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
	readonly sessionId = crypto.randomUUID();
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
	private userStartedAt: number | undefined;

	constructor(private readonly options: CreateManagerOptions) {}

	async start(startType: StartType): Promise<void> {
		const exporter = new OTLPMetricExporter({
			url: this.options.endpoint,
			headers: this.options.headers,
			temporalityPreference: AggregationTemporality.DELTA,
		});
		this.metricReader = new PeriodicExportingMetricReader({
			exporter,
			exportIntervalMillis: EXPORT_INTERVAL_MILLIS,
		});
		this.meterProvider = new MeterProvider({
			resource: resourceFromAttributes(this.options.resourceAttributes),
			readers: [this.metricReader],
		});
		const meter = this.meterProvider.getMeter(METER_NAME);
		this.sessionCounter = meter.createCounter("claude_code.session.count");
		this.tokenCounter = meter.createCounter("claude_code.token.usage");
		this.costCounter = meter.createCounter("claude_code.cost.usage");
		this.activeTimeCounter = meter.createCounter(
			"claude_code.active_time.total",
		);
		this.linesCounter = meter.createCounter("claude_code.lines_of_code.count");
		this.commitCounter = meter.createCounter("claude_code.commit.count");
		this.pullRequestCounter = meter.createCounter(
			"claude_code.pull_request.count",
		);
		this.editDecisionCounter = meter.createCounter(
			"claude_code.code_edit_tool.decision",
		);
		this.activeTimeTimer = setInterval(
			() => this.flushOpenCliTime(),
			EXPORT_INTERVAL_MILLIS,
		);
		this.sessionCounter.add(1, {
			"session.id": this.sessionId,
			start_type: startType,
		});
	}

	async flush(): Promise<void> {
		this.flushOpenCliTime();
		await this.meterProvider?.forceFlush();
	}

	async stop(): Promise<void> {
		if (this.activeTimeTimer) {
			clearInterval(this.activeTimeTimer);
			this.activeTimeTimer = undefined;
		}
		this.flushOpenCliTime();
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
		this.userStartedAt = undefined;
		if (!meterProvider) return;
		await meterProvider.forceFlush();
		await meterProvider.shutdown();
	}

	recordTokenUsage(usage: AssistantUsage, modelId: string): void {
		const commonAttributes = {
			"session.id": this.sessionId,
			model: modelId,
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
			"session.id": this.sessionId,
			model: modelId,
		});
	}

	recordToolResult(event: ToolResultEventLike): void {
		if (event.isError) return;

		if (event.toolName === "bash") {
			const command = readString(event.input, "command");
			if (!command) return;
			if (GIT_COMMIT_RE.test(command)) {
				this.commitCounter?.add(1, { "session.id": this.sessionId });
			}
			if (GH_PR_CREATE_RE.test(command)) {
				this.pullRequestCounter?.add(1, { "session.id": this.sessionId });
			}
			return;
		}

		if (event.toolName === "edit") {
			this.recordEditDecision("Edit");
			const edits = Array.isArray(event.input.edits)
				? event.input.edits.filter(isEditReplacement)
				: [];
			let added = 0;
			let removed = 0;
			for (const edit of edits) {
				added += countLines(edit.newText);
				removed += countLines(edit.oldText);
			}
			this.recordLineCounts(added, removed);
			return;
		}

		if (event.toolName === "write") {
			this.recordEditDecision("Write");
			const content = readString(event.input, "content");
			this.recordLineCounts(content ? countLines(content) : 0, 0);
		}
	}

	recordAgentStart(): void {
		const now = this.options.now();
		this.userStartedAt = undefined;
		this.cliStartedAt = now;
		this.lastCliFlushAt = now;
	}

	recordAgentEnd(): void {
		const now = this.options.now();
		if (this.lastCliFlushAt !== undefined) {
			this.recordActiveTime("cli", now - this.lastCliFlushAt);
		}
		this.cliStartedAt = undefined;
		this.lastCliFlushAt = undefined;
		this.userStartedAt = now;
	}

	recordInput(): void {
		const now = this.options.now();
		if (this.userStartedAt !== undefined) {
			this.recordActiveTime("user", now - this.userStartedAt);
		}
		this.userStartedAt = undefined;
	}

	private recordEditDecision(toolName: "Edit" | "Write"): void {
		this.editDecisionCounter?.add(1, {
			"session.id": this.sessionId,
			decision: "accept",
			tool_name: toolName,
			source: "config",
		});
	}

	private recordLineCounts(added: number, removed: number): void {
		addPositive(this.linesCounter, added, {
			"session.id": this.sessionId,
			type: "added",
		});
		addPositive(this.linesCounter, removed, {
			"session.id": this.sessionId,
			type: "removed",
		});
	}

	private recordActiveTime(type: "cli" | "user", millis: number): void {
		addPositive(this.activeTimeCounter, millis / 1000, {
			"session.id": this.sessionId,
			type,
		});
	}

	private flushOpenCliTime(): void {
		if (this.cliStartedAt === undefined || this.lastCliFlushAt === undefined) {
			return;
		}
		const now = this.options.now();
		this.recordActiveTime("cli", now - this.lastCliFlushAt);
		this.lastCliFlushAt = now;
	}
}

const createDefaultManager = (
	options: CreateManagerOptions,
): MetricsManagerLike => new OtelMetricsManager(options);

const providerIsEnabled = (
	settings: OtelSettings,
	provider: string | undefined,
) => Boolean(provider && settings.enabledProviders.includes(provider));

const makeManagerOptions = async (
	versionResolver: () => Promise<string>,
	now: () => number,
): Promise<CreateManagerOptions | undefined> => {
	const endpoint = process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim();
	if (!endpoint) return undefined;
	return {
		endpoint,
		headers: parseKeyValueList(process.env.OTEL_EXPORTER_OTLP_HEADERS),
		resourceAttributes: await createResourceAttributes(versionResolver),
		versionResolver,
		now,
	};
};

export const createClaudeOtelExtension = ({
	settingsReader = readOtelSettings,
	managerFactory = createDefaultManager,
	versionResolver = resolveClaudeVersion,
	now = Date.now,
}: ClaudeOtelExtensionOptions = {}) => {
	let manager: MetricsManagerLike | undefined;

	const stopManager = async (): Promise<void> => {
		const current = manager;
		manager = undefined;
		await current?.stop();
	};

	const startManager = async (startType: StartType): Promise<void> => {
		await stopManager();
		const options = await makeManagerOptions(versionResolver, now);
		if (!options) return;
		const nextManager = managerFactory(options);
		manager = nextManager;
		try {
			await nextManager.start(startType);
		} catch {
			if (manager === nextManager) manager = undefined;
			await nextManager.stop().catch(() => undefined);
		}
	};

	const applyGate = async (
		ctx: ExtensionContextLike,
		startType: StartType,
		restartIfAlreadyActive: boolean,
	): Promise<void> => {
		const settings = await settingsReader();
		if (!providerIsEnabled(settings, ctx.model?.provider)) {
			await stopManager();
			return;
		}
		if (manager && !restartIfAlreadyActive) return;
		await startManager(startType);
	};

	return (pi: OtelExtensionApi): void => {
		pi.on("session_start", async (event, ctx) => {
			await applyGate(ctx, sessionStartTypeFromReason(event.reason), false);
		});

		pi.on("model_select", async (event, ctx) => {
			const selectedCtx: ExtensionContextLike = {
				...ctx,
				model: event.model ?? ctx.model,
			};
			await applyGate(
				selectedCtx,
				"fresh",
				Boolean(manager && event.previousModel),
			);
		});

		pi.on("message_end", (event, ctx) => {
			if (!manager) return;
			const usage = getUsageFromMessage(event.message);
			const modelId = ctx.model?.id;
			if (!usage || !modelId) return;
			manager.recordTokenUsage(usage, modelId);
			if (usage.costTotal !== undefined) {
				manager.recordCostUsage(usage.costTotal, modelId);
			}
		});

		pi.on("tool_result", (event) => {
			manager?.recordToolResult(event);
		});

		pi.on("agent_start", () => {
			manager?.recordAgentStart();
		});

		pi.on("agent_end", () => {
			manager?.recordAgentEnd();
		});

		pi.on("input", () => {
			manager?.recordInput();
		});

		pi.on("session_shutdown", async () => {
			const current = manager;
			manager = undefined;
			await current?.flush();
			await current?.stop();
		});
	};
};

export default function claudeOtel(pi: ExtensionAPI): void {
	createClaudeOtelExtension()(pi);
}
