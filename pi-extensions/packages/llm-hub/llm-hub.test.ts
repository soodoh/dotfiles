import { describe, expect, test, vi } from "vitest";
import llmHubTelemetry from "./index";

const OTEL_EVENTS = [
	"session_start",
	"model_select",
	"message_end",
	"tool_call",
	"tool_result",
	"input",
	"agent_start",
	"agent_end",
	"session_shutdown",
];

describe("llm-hub entry point", () => {
	test("registers only provider-scoped telemetry lifecycle handlers", () => {
		const on = vi.fn();

		expect(() => llmHubTelemetry({ on })).not.toThrow();
		expect(on.mock.calls.map(([eventName]) => eventName)).toEqual(OTEL_EVENTS);
	});
});
