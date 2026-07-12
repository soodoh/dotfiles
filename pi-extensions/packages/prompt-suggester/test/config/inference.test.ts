import { describe, expect, test } from "vitest";
import { toInvocationThinkingLevel } from "../../src/config/inference";

describe("toInvocationThinkingLevel", () => {
	test("omits invocation thinking when config uses session default", () => {
		expect(toInvocationThinkingLevel("session-default")).toBeUndefined();
	});

	test("returns configured thinking levels unchanged", () => {
		expect(toInvocationThinkingLevel("minimal")).toBe("minimal");
		expect(toInvocationThinkingLevel("high")).toBe("high");
	});
});
