import { beforeEach, describe, expect, test, vi } from "vitest";

type AddCall = {
	metricName: string;
	value: number;
	attributes: Record<string, string>;
};

type CounterOptions = {
	metricName: string;
	options?: { unit?: string };
};

type ProviderCall = {
	method: "forceFlush" | "shutdown";
};

const otelMock = vi.hoisted(() => ({
	addCalls: [] as AddCall[],
	counterOptions: [] as CounterOptions[],
	exporterOptions: [] as unknown[],
	readerOptions: [] as unknown[],
	providerOptions: [] as unknown[],
	meterNames: [] as string[],
	providerCalls: [] as ProviderCall[],
	resourceAttributes: [] as Record<string, string>[],
	forceFlushError: undefined as Error | undefined,
	shutdownError: undefined as Error | undefined,
}));

vi.mock("@opentelemetry/exporter-metrics-otlp-http", () => ({
	OTLPMetricExporter: class OTLPMetricExporter {
		constructor(options: unknown) {
			otelMock.exporterOptions.push(options);
		}
	},
}));

vi.mock("@opentelemetry/resources", () => ({
	resourceFromAttributes(attributes: Record<string, string>) {
		otelMock.resourceAttributes.push(attributes);
		return { attributes };
	},
}));

vi.mock("@opentelemetry/sdk-metrics", () => ({
	AggregationTemporality: { DELTA: 0, CUMULATIVE: 1 },
	PeriodicExportingMetricReader: class PeriodicExportingMetricReader {
		constructor(options: unknown) {
			otelMock.readerOptions.push(options);
		}
	},
	MeterProvider: class MeterProvider {
		constructor(options: unknown) {
			otelMock.providerOptions.push(options);
		}

		getMeter(name: string) {
			otelMock.meterNames.push(name);
			return {
				createCounter(metricName: string, options?: { unit?: string }) {
					otelMock.counterOptions.push({ metricName, options });
					return {
						add(value: number, attributes: Record<string, string>) {
							otelMock.addCalls.push({ metricName, value, attributes });
						},
					};
				},
			};
		}

		async forceFlush() {
			otelMock.providerCalls.push({ method: "forceFlush" });
			if (otelMock.forceFlushError) throw otelMock.forceFlushError;
		}

		async shutdown() {
			otelMock.providerCalls.push({ method: "shutdown" });
			if (otelMock.shutdownError) throw otelMock.shutdownError;
		}
	},
}));

import {
	countLines,
	createClaudeOtelExtension,
	diffLineCounts,
	type ExtensionContextLike,
	type MetricsManagerLike,
	type OtelEventName,
	type OtelExtensionApi,
	OtelMetricsManager,
	parseClaudeVersion,
	parseKeyValueList,
	parseResourceAttributes,
} from "./otel-metrics";

type Handler = (
	event: unknown,
	ctx: ExtensionContextLike,
) => void | Promise<void>;

type TestPi = OtelExtensionApi & {
	emit(
		eventName: OtelEventName,
		event: unknown,
		ctx: ExtensionContextLike,
	): Promise<void>;
};

function createPi(): TestPi {
	const handlers = new Map<OtelEventName, Handler[]>();
	return {
		on(eventName, handler) {
			const current = handlers.get(eventName) ?? [];
			current.push(handler as Handler);
			handlers.set(eventName, current);
		},
		async emit(eventName, event, ctx) {
			for (const handler of handlers.get(eventName) ?? []) {
				await handler(event, ctx);
			}
		},
	};
}

class FakeManager implements MetricsManagerLike {
	readonly sessionId: string;
	starts: string[] = [];
	stops = 0;
	flushes = 0;
	tokens: unknown[] = [];
	costs: unknown[] = [];
	tools: unknown[] = [];
	agentStarts = 0;
	agentEnds = 0;
	flushError: Error | undefined;

	constructor(id: string) {
		this.sessionId = id;
	}

	async start(startType: "fresh" | "resume" | "continue") {
		this.starts.push(startType);
	}

	async stop() {
		this.stops += 1;
	}

	async flush() {
		this.flushes += 1;
		if (this.flushError) throw this.flushError;
	}

	recordTokenUsage(...args: unknown[]) {
		this.tokens.push(args);
	}

	recordCostUsage(...args: unknown[]) {
		this.costs.push(args);
	}

	async recordToolCall(event: unknown) {
		this.tools.push(event);
	}

	recordToolResult(event: unknown) {
		this.tools.push(event);
	}

	recordUserActivity() {}

	recordAgentStart() {
		this.agentStarts += 1;
	}

	recordAgentEnd() {
		this.agentEnds += 1;
	}
}

const managerOptions = (overrides: Record<string, unknown> = {}) => ({
	endpoint: "https://otel.example/v1/metrics",
	headers: {},
	resourceAttributes: {
		"service.name": "claude-code",
		"service.version": "9.8.7",
		"os.type": "darwin",
		"os.version": "25.5.0",
		"host.arch": "arm64",
	},
	metricAttributes: {},
	temporality: 0,
	exportIntervalMillis: 60_000,
	includeSessionId: true,
	permissionMode: "bypassPermissions",
	sessionId: "session-1",
	recordSessionStart: true,
	versionResolver: async () => "9.8.7",
	now: () => 0,
	...overrides,
});

const enableTelemetry = () => {
	vi.stubEnv("CLAUDE_CODE_ENABLE_TELEMETRY", "1");
	vi.stubEnv("OTEL_METRICS_EXPORTER", "otlp");
	vi.stubEnv("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json");
	vi.stubEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "https://otel.example");
};

beforeEach(() => {
	otelMock.addCalls.length = 0;
	otelMock.counterOptions.length = 0;
	otelMock.exporterOptions.length = 0;
	otelMock.readerOptions.length = 0;
	otelMock.providerOptions.length = 0;
	otelMock.meterNames.length = 0;
	otelMock.providerCalls.length = 0;
	otelMock.resourceAttributes.length = 0;
	otelMock.forceFlushError = undefined;
	otelMock.shutdownError = undefined;
	vi.unstubAllEnvs();
});

describe("helpers", () => {
	test("parses OTEL headers and strict resource attributes", () => {
		expect(parseKeyValueList("a=1, b = two, token=x=y, invalid")).toEqual({
			a: "1",
			b: "two",
			token: "x=y",
		});
		expect(
			parseResourceAttributes("team=platform,faros.user.id=paul%40example.com"),
		).toEqual({ team: "platform", "faros.user.id": "paul@example.com" });
		expect(parseResourceAttributes("invalid=x=y")).toEqual({});
		expect(parseResourceAttributes("team=platform value")).toEqual({});
		expect(parseResourceAttributes('team="platform"')).toEqual({});
		expect(parseResourceAttributes("team=plätform")).toEqual({});
	});

	test("counts logical and changed lines", () => {
		expect(countLines("")).toBe(0);
		expect(countLines("one\ntwo\n")).toBe(2);
		expect(diffLineCounts("same\nold\ntail", "same\nnew\nplus\ntail")).toEqual({
			added: 2,
			removed: 1,
		});
		expect(diffLineCounts("same\nline", "same\nline")).toEqual({
			added: 0,
			removed: 0,
		});
	});

	test("parses claude semver with fallback", () => {
		expect(parseClaudeVersion("Claude Code 2.3.4")).toBe("2.3.4");
		expect(parseClaudeVersion("not installed")).toBe("2.1.118");
	});
});

describe("OtelMetricsManager", () => {
	test("configures Claude-compatible units, attributes, and session count", async () => {
		const manager = new OtelMetricsManager(
			managerOptions({
				headers: { "x-webhook-secret": "secret" },
				metricAttributes: { "faros.user.id": "paul@example.com" },
			}) as ConstructorParameters<typeof OtelMetricsManager>[0],
		);

		await manager.start("fresh");
		await manager.stop();

		expect(otelMock.exporterOptions[0]).toMatchObject({
			url: "https://otel.example/v1/metrics",
			headers: { "x-webhook-secret": "secret" },
			temporalityPreference: 0,
		});
		expect(otelMock.counterOptions).toContainEqual({
			metricName: "claude_code.cost.usage",
			options: { unit: "USD" },
		});
		expect(otelMock.counterOptions).toContainEqual({
			metricName: "claude_code.active_time.total",
			options: { unit: "s" },
		});
		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.session.count",
			value: 1,
			attributes: {
				"faros.user.id": "paul@example.com",
				"session.id": "session-1",
				start_type: "fresh",
			},
		});
		expect(otelMock.providerCalls).toEqual([{ method: "shutdown" }]);
	});

	test("records tokens, cost, CLI time, and exact edit diffs", async () => {
		let currentTime = 1_000;
		const manager = new OtelMetricsManager(
			managerOptions({ now: () => currentTime }) as ConstructorParameters<
				typeof OtelMetricsManager
			>[0],
		);
		await manager.start("resume");

		manager.recordTokenUsage(
			{ input: 10, output: 20, cacheRead: 3, cacheWrite: 4 },
			"claude-opus-4-6",
		);
		manager.recordCostUsage(0.0534, "claude-opus-4-6");
		manager.recordAgentStart();
		currentTime = 3_500;
		manager.recordAgentEnd();
		await manager.recordToolCall({
			toolCallId: "edit-1",
			toolName: "edit",
			input: { path: "src/app.ts" },
		});
		manager.recordToolResult({
			toolCallId: "edit-1",
			toolName: "edit",
			isError: false,
			modelId: "claude-opus-4-6",
			output: "",
			input: {
				path: "src/app.ts",
				edits: [
					{ oldText: "same\nold\ntail", newText: "same\nnew\nplus\ntail" },
				],
			},
		});
		manager.recordToolResult({
			toolName: "bash",
			isError: false,
			modelId: "claude-opus-4-6",
			input: { command: "git commit -m test && gh pr create" },
			output:
				"[main abc1234] test\nhttps://github.example.com/org/repo/pull/42",
		});
		await manager.stop();

		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.token.usage",
			value: 4,
			attributes: {
				"session.id": "session-1",
				model: "claude-opus-4-6",
				query_source: "main",
				type: "cacheCreation",
			},
		});
		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.active_time.total",
			value: 2.5,
			attributes: { "session.id": "session-1", type: "cli" },
		});
		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.lines_of_code.count",
			value: 2,
			attributes: {
				"session.id": "session-1",
				model: "claude-opus-4-6",
				type: "added",
			},
		});
		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.lines_of_code.count",
			value: 1,
			attributes: {
				"session.id": "session-1",
				model: "claude-opus-4-6",
				type: "removed",
			},
		});
		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.code_edit_tool.decision",
			value: 1,
			attributes: {
				"session.id": "session-1",
				tool_name: "Edit",
				decision: "accept",
				source: "config",
				language: "TypeScript",
			},
		});
		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.commit.count",
			value: 1,
			attributes: { "session.id": "session-1" },
		});
		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.pull_request.count",
			value: 1,
			attributes: { "session.id": "session-1" },
		});
	});

	test("best-effort tracks writes, MCP PRs, and user active time", async () => {
		let currentTime = 10_000;
		const manager = new OtelMetricsManager(
			managerOptions({ now: () => currentTime }) as ConstructorParameters<
				typeof OtelMetricsManager
			>[0],
		);
		await manager.start("fresh");
		manager.recordUserActivity();
		currentTime = 13_000;
		manager.recordUserActivity();
		manager.recordToolResult({
			toolCallId: "write-1",
			toolName: "write",
			input: { path: "README.md", content: "one\ntwo\n" },
			isError: false,
			output: "",
			modelId: "claude-sonnet-4-6",
		});
		manager.recordToolResult({
			toolCallId: "pr-1",
			toolName: "github_create_pull_request",
			input: {},
			isError: false,
			output: "created",
			modelId: "claude-sonnet-4-6",
		});
		currentTime = 18_000;
		await manager.stop();

		expect(
			otelMock.addCalls
				.filter(
					(call) =>
						call.metricName === "claude_code.active_time.total" &&
						call.attributes.type === "user",
				)
				.reduce((total, call) => total + call.value, 0),
		).toBe(8);
		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.lines_of_code.count",
			value: 2,
			attributes: {
				"session.id": "session-1",
				model: "claude-sonnet-4-6",
				type: "added",
			},
		});
		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.pull_request.count",
			value: 1,
			attributes: { "session.id": "session-1" },
		});
	});

	test("shutdown still runs when explicit flush fails", async () => {
		const manager = new OtelMetricsManager(
			managerOptions() as ConstructorParameters<typeof OtelMetricsManager>[0],
		);
		await manager.start("fresh");
		otelMock.forceFlushError = new Error("collector unavailable");

		await expect(manager.flush()).rejects.toThrow("collector unavailable");
		await expect(manager.stop()).resolves.toBeUndefined();
		expect(otelMock.providerCalls).toEqual([
			{ method: "forceFlush" },
			{ method: "shutdown" },
		]);
	});
});

describe("createClaudeOtelExtension", () => {
	test("requires the supplied OTLP metrics exporter and HTTP JSON protocol", async () => {
		vi.stubEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "https://otel.example");
		const managers: FakeManager[] = [];
		const pi = createPi();
		createClaudeOtelExtension({
			providerName: "llm-hub",
			managerFactory: () => {
				const manager = new FakeManager(`session-${managers.length + 1}`);
				managers.push(manager);
				return manager;
			},
		})(pi);

		await pi.emit(
			"session_start",
			{ reason: "startup" },
			{ model: { provider: "llm-hub", id: "claude" } },
		);
		expect(managers).toHaveLength(0);

		enableTelemetry();
		await pi.emit(
			"model_select",
			{ model: { provider: "llm-hub", id: "claude" } },
			{ model: { provider: "openai-codex", id: "gpt-5" } },
		);
		expect(managers).toHaveLength(1);
	});

	test("uses the general OTLP endpoint fallback with the metrics path", async () => {
		enableTelemetry();
		vi.stubEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "");
		vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://otel.example/base/");
		const optionsSeen: Array<Record<string, unknown>> = [];
		const pi = createPi();
		createClaudeOtelExtension({
			providerName: "llm-hub",
			managerFactory: (options) => {
				optionsSeen.push(options);
				return new FakeManager(options.sessionId);
			},
		})(pi);

		await pi.emit(
			"session_start",
			{ reason: "startup" },
			{ model: { provider: "llm-hub", id: "claude" } },
		);
		expect(optionsSeen[0]?.endpoint).toBe(
			"https://otel.example/base/v1/metrics",
		);
	});

	test("scopes metrics to llm-hub and preserves one logical telemetry session", async () => {
		enableTelemetry();
		const managers: FakeManager[] = [];
		const managerOptionsSeen: Array<Record<string, unknown>> = [];
		const pi = createPi();
		createClaudeOtelExtension({
			providerName: "llm-hub",
			versionResolver: async () => "9.8.7",
			managerFactory: (options) => {
				managerOptionsSeen.push(options);
				const manager = new FakeManager(options.sessionId);
				managers.push(manager);
				return manager;
			},
		})(pi);

		await pi.emit(
			"session_start",
			{ reason: "resume" },
			{ model: { provider: "llm-hub", id: "claude-opus-4-6" } },
		);
		expect(managers[0]?.starts).toEqual(["resume"]);
		expect(managerOptionsSeen[0]?.recordSessionStart).toBe(true);

		await pi.emit(
			"message_end",
			{
				message: {
					role: "assistant",
					provider: "llm-hub",
					model: "claude-opus-4-6",
					usage: {
						input: 1,
						output: 2,
						cacheRead: 3,
						cacheWrite: 4,
						cost: { total: 0.1 },
					},
				},
			},
			{ model: { provider: "llm-hub", id: "claude-opus-4-6" } },
		);
		expect(managers[0]?.tokens).toHaveLength(1);

		await pi.emit(
			"model_select",
			{ model: { provider: "litellm", id: "claude-opus-4-6" } },
			{ model: { provider: "llm-hub", id: "claude-opus-4-6" } },
		);
		expect(managers[0]?.stops).toBe(1);

		await pi.emit(
			"model_select",
			{ model: { provider: "llm-hub", id: "claude-sonnet-4-6" } },
			{ model: { provider: "litellm", id: "claude-opus-4-6" } },
		);
		expect(managers[1]?.starts).toEqual(["fresh"]);
		expect(managerOptionsSeen[1]?.sessionId).toBe(
			managerOptionsSeen[0]?.sessionId,
		);
		expect(managerOptionsSeen[1]?.recordSessionStart).toBe(false);
	});

	test("a rejected flush cannot keep a stale exporter or poison later transitions", async () => {
		enableTelemetry();
		const managers: FakeManager[] = [];
		const pi = createPi();
		createClaudeOtelExtension({
			providerName: "llm-hub",
			managerFactory: (options) => {
				const manager = new FakeManager(options.sessionId);
				managers.push(manager);
				return manager;
			},
		})(pi);

		await pi.emit(
			"session_start",
			{ reason: "startup" },
			{ model: { provider: "llm-hub", id: "claude" } },
		);
		if (!managers[0]) throw new Error("manager was not created");
		managers[0].flushError = new Error("collector unavailable");

		await expect(
			pi.emit(
				"model_select",
				{ model: { provider: "openai-codex", id: "gpt-5" } },
				{ model: { provider: "llm-hub", id: "claude" } },
			),
		).resolves.toBeUndefined();
		expect(managers[0].stops).toBe(1);

		await pi.emit(
			"model_select",
			{ model: { provider: "llm-hub", id: "claude" } },
			{ model: { provider: "openai-codex", id: "gpt-5" } },
		);
		expect(managers[1]?.starts).toEqual(["fresh"]);
	});
});
