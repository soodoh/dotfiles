import { describe, expect, test } from "vitest";
import { toInvocationThinkingLevel } from "../../src/config/inference";

describe("toInvocationThinkingLevel", () => {
	test("omits invocation thinking when config disables it or uses session default", () => {
		expect(toInvocationThinkingLevel("off")).toBeUndefined();
		expect(toInvocationThinkingLevel("session-default")).toBeUndefined();
	});

	test("returns enabled thinking levels unchanged", () => {
		expect(toInvocationThinkingLevel("minimal")).toBe("minimal");
		expect(toInvocationThinkingLevel("high")).toBe("high");
	});
});
