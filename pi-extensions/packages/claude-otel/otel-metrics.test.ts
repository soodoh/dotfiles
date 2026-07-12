import { beforeEach, describe, expect, test, vi } from "vitest";

type AddCall = {
	metricName: string;
	value: number;
	attributes: Record<string, string>;
};

type ProviderCall = {
	method: "forceFlush" | "shutdown";
};

const otelMock = vi.hoisted(() => ({
	addCalls: [] as AddCall[],
	exporterOptions: [] as unknown[],
	readerOptions: [] as unknown[],
	providerOptions: [] as unknown[],
	meterNames: [] as string[],
	providerCalls: [] as ProviderCall[],
	resourceAttributes: [] as Record<string, string>[],
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
	AggregationTemporality: { DELTA: 0 },
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
				createCounter(metricName: string) {
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
		}

		async shutdown() {
			otelMock.providerCalls.push({ method: "shutdown" });
		}
	},
}));

import {
	countLines,
	createClaudeOtelExtension,
	type ExtensionContextLike,
	type MetricsManagerLike,
	type OtelEventName,
	type OtelExtensionApi,
	OtelMetricsManager,
	parseClaudeVersion,
	parseKeyValueList,
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
	inputs = 0;

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
	}

	recordTokenUsage(...args: unknown[]) {
		this.tokens.push(args);
	}

	recordCostUsage(...args: unknown[]) {
		this.costs.push(args);
	}

	recordToolResult(event: unknown) {
		this.tools.push(event);
	}

	recordAgentStart() {
		this.agentStarts += 1;
	}

	recordAgentEnd() {
		this.agentEnds += 1;
	}

	recordInput() {
		this.inputs += 1;
	}
}

beforeEach(() => {
	otelMock.addCalls.length = 0;
	otelMock.exporterOptions.length = 0;
	otelMock.readerOptions.length = 0;
	otelMock.providerOptions.length = 0;
	otelMock.meterNames.length = 0;
	otelMock.providerCalls.length = 0;
	otelMock.resourceAttributes.length = 0;
	vi.unstubAllEnvs();
});

describe("helpers", () => {
	test("parses comma separated OTEL key-value lists", () => {
		expect(parseKeyValueList("a=1, b = two, token=x=y, invalid")).toEqual({
			a: "1",
			b: "two",
			token: "x=y",
		});
	});

	test("counts logical lines without treating final newline as a blank line", () => {
		expect(countLines("")).toBe(0);
		expect(countLines("one")).toBe(1);
		expect(countLines("one\ntwo\n")).toBe(2);
		expect(countLines("one\r\ntwo")).toBe(2);
	});

	test("parses claude semver with fallback", () => {
		expect(parseClaudeVersion("Claude Code 2.3.4")).toBe("2.3.4");
		expect(parseClaudeVersion("not installed")).toBe("2.1.118");
	});
});

describe("OtelMetricsManager", () => {
	test("configures OTLP metrics and emits session count with Claude Code resource identity", async () => {
		vi.stubEnv("TERM_PROGRAM", "ghostty");
		const manager = new OtelMetricsManager({
			endpoint: "https://otel.example/v1/metrics",
			headers: { "x-webhook-secret": "secret" },
			resourceAttributes: {
				"service.name": "claude-code",
				"service.version": "9.8.7",
				"os.type": "darwin",
				"os.version": "25.5.0",
				"host.arch": "arm64",
				"terminal.type": "ghostty",
				"faros.user.id": "paul@example.com",
			},
			versionResolver: async () => "9.8.7",
			now: () => 0,
		});

		await manager.start("fresh");
		await manager.stop();

		expect(otelMock.meterNames).toEqual(["com.anthropic.claude_code"]);
		expect(otelMock.exporterOptions[0]).toMatchObject({
			url: "https://otel.example/v1/metrics",
			headers: { "x-webhook-secret": "secret" },
			temporalityPreference: 0,
		});
		expect(otelMock.resourceAttributes[0]).toMatchObject({
			"service.name": "claude-code",
			"service.version": "9.8.7",
			"faros.user.id": "paul@example.com",
		});
		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.session.count",
			value: 1,
			attributes: {
				"session.id": manager.sessionId,
				start_type: "fresh",
			},
		});
		expect(otelMock.providerCalls).toEqual([
			{ method: "forceFlush" },
			{ method: "shutdown" },
		]);
	});

	test("records token, cost, active time, code, commit, and pull request metrics", async () => {
		let currentTime = 1_000;
		const manager = new OtelMetricsManager({
			endpoint: "https://otel.example/v1/metrics",
			headers: {},
			resourceAttributes: {
				"service.name": "claude-code",
				"service.version": "9.8.7",
				"os.type": "darwin",
				"os.version": "25.5.0",
				"host.arch": "arm64",
			},
			versionResolver: async () => "9.8.7",
			now: () => currentTime,
		});
		await manager.start("resume");

		manager.recordTokenUsage(
			{ input: 10, output: 20, cacheRead: 3, cacheWrite: 4 },
			"claude-opus-4-6",
		);
		manager.recordCostUsage(0.0534, "claude-opus-4-6");
		manager.recordAgentStart();
		currentTime = 3_500;
		manager.recordAgentEnd();
		currentTime = 8_000;
		manager.recordInput();
		manager.recordToolResult({
			toolName: "edit",
			isError: false,
			input: {
				edits: [{ oldText: "old\nline\n", newText: "new\nline\nplus" }],
			},
		});
		manager.recordToolResult({
			toolName: "write",
			isError: false,
			input: { content: "a\nb\n" },
		});
		manager.recordToolResult({
			toolName: "bash",
			isError: false,
			input: { command: "git status && git commit -m test && gh pr create" },
		});
		await manager.stop();

		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.token.usage",
			value: 4,
			attributes: {
				"session.id": manager.sessionId,
				model: "claude-opus-4-6",
				type: "cacheCreation",
			},
		});
		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.cost.usage",
			value: 0.0534,
			attributes: {
				"session.id": manager.sessionId,
				model: "claude-opus-4-6",
			},
		});
		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.active_time.total",
			value: 2.5,
			attributes: { "session.id": manager.sessionId, type: "cli" },
		});
		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.active_time.total",
			value: 4.5,
			attributes: { "session.id": manager.sessionId, type: "user" },
		});
		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.lines_of_code.count",
			value: 3,
			attributes: { "session.id": manager.sessionId, type: "added" },
		});
		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.lines_of_code.count",
			value: 2,
			attributes: { "session.id": manager.sessionId, type: "removed" },
		});
		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.code_edit_tool.decision",
			value: 1,
			attributes: {
				"session.id": manager.sessionId,
				decision: "accept",
				tool_name: "Edit",
				source: "config",
			},
		});
		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.commit.count",
			value: 1,
			attributes: { "session.id": manager.sessionId },
		});
		expect(otelMock.addCalls).toContainEqual({
			metricName: "claude_code.pull_request.count",
			value: 1,
			attributes: { "session.id": manager.sessionId },
		});
	});
});

describe("createClaudeOtelExtension", () => {
	test("is a no-op when provider is disabled or endpoint is unset", async () => {
		vi.stubEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "");
		const managers: FakeManager[] = [];
		const pi = createPi();
		createClaudeOtelExtension({
			settingsReader: async () => ({ enabledProviders: ["llm-hub"] }),
			managerFactory: () => {
				const manager = new FakeManager(`session-${managers.length + 1}`);
				managers.push(manager);
				return manager;
			},
		})(pi);

		await pi.emit(
			"session_start",
			{ reason: "startup" },
			{ model: { provider: "openai-codex", id: "gpt-5" } },
		);
		expect(managers).toHaveLength(0);

		await pi.emit(
			"model_select",
			{ model: { provider: "llm-hub", id: "claude" } },
			{ model: { provider: "openai-codex", id: "gpt-5" } },
		);
		expect(managers).toHaveLength(0);
	});

	test("starts, forwards events, restarts, and flushes on provider gate transitions", async () => {
		vi.stubEnv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "https://otel.example");
		const managers: FakeManager[] = [];
		const pi = createPi();
		createClaudeOtelExtension({
			settingsReader: async () => ({
				enabledProviders: ["llm-hub", "other-hub"],
			}),
			versionResolver: async () => "9.8.7",
			managerFactory: () => {
				const manager = new FakeManager(`session-${managers.length + 1}`);
				managers.push(manager);
				return manager;
			},
		})(pi);

		await pi.emit(
			"session_start",
			{ reason: "resume" },
			{ model: { provider: "llm-hub", id: "claude-opus-4-6" } },
		);
		expect(managers[0].starts).toEqual(["resume"]);

		await pi.emit(
			"message_end",
			{
				message: {
					role: "assistant",
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
		await pi.emit("agent_start", {}, { model: { provider: "llm-hub" } });
		await pi.emit("agent_end", {}, { model: { provider: "llm-hub" } });
		await pi.emit(
			"input",
			{ text: "next" },
			{ model: { provider: "llm-hub" } },
		);
		await pi.emit(
			"tool_result",
			{
				toolName: "bash",
				isError: false,
				input: { command: "git commit -m x" },
			},
			{ model: { provider: "llm-hub" } },
		);

		expect(managers[0].tokens).toHaveLength(1);
		expect(managers[0].costs).toHaveLength(1);
		expect(managers[0].agentStarts).toBe(1);
		expect(managers[0].agentEnds).toBe(1);
		expect(managers[0].inputs).toBe(1);
		expect(managers[0].tools).toHaveLength(1);

		await pi.emit(
			"model_select",
			{
				previousModel: { provider: "llm-hub", id: "claude-opus-4-6" },
				model: { provider: "other-hub", id: "claude-sonnet" },
			},
			{ model: { provider: "llm-hub", id: "claude-opus-4-6" } },
		);
		expect(managers[0].stops).toBe(1);
		expect(managers[1].starts).toEqual(["fresh"]);

		await pi.emit(
			"model_select",
			{
				previousModel: { provider: "other-hub", id: "claude-sonnet" },
				model: { provider: "openai-codex", id: "gpt-5" },
			},
			{ model: { provider: "other-hub", id: "claude-sonnet" } },
		);
		expect(managers[1].stops).toBe(1);

		await pi.emit(
			"model_select",
			{
				previousModel: { provider: "openai-codex", id: "gpt-5" },
				model: { provider: "llm-hub", id: "claude-opus-4-6" },
			},
			{ model: { provider: "openai-codex", id: "gpt-5" } },
		);
		expect(managers[2].starts).toEqual(["fresh"]);

		await pi.emit(
			"session_shutdown",
			{ reason: "quit" },
			{ model: { provider: "llm-hub" } },
		);
		expect(managers[2].flushes).toBe(1);
		expect(managers[2].stops).toBe(1);
	});
});
