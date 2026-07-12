import { describe, expect, test } from "vitest";
import {
	buildLatestHistoricalTurnContext,
	buildTurnContext,
} from "../../src/app/services/conversation-signals";

describe("conversation signal extraction", () => {
	test("malformed assistant tool call arguments do not throw", () => {
		const messages: unknown[] = [
			{
				role: "user",
				content: "Inspect the project",
				timestamp: 1,
			},
			{
				role: "assistant",
				content: [
					{ type: "toolCall", name: "read", arguments: "not an object" },
					{ type: "toolCall", name: "edit", arguments: null },
					{ type: "toolCall", name: "glob" },
					{
						type: "toolCall",
						name: "bash",
						arguments: { command: "bun test" },
					},
					{ type: "text", text: "Done" },
				],
				timestamp: 2,
			},
		];

		const context = buildTurnContext({
			turnId: "turn-1",
			sourceLeafId: "leaf-1",
			messagesFromPrompt: messages,
			branchMessages: messages,
			occurredAt: "2026-05-01T00:00:00.000Z",
		});

		expect(context?.toolSignals).toEqual([
			"read",
			"edit",
			"glob",
			"bash(bun test)",
		]);
		expect(context?.touchedFiles).toEqual([]);
	});

	test("latest historical context is not built when the branch ends with a user prompt", () => {
		const context = buildLatestHistoricalTurnContext({
			branchEntries: [
				{
					id: "user-1",
					message: { role: "user", content: "Fix the tests", timestamp: 1 },
				},
				{
					id: "assistant-1",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "I will fix them." }],
						timestamp: 2,
						api: "test",
						provider: "test",
						model: "test-model",
						usage: {
							input: 1,
							output: 1,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: 2,
							cost: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
								total: 0,
							},
						},
						stopReason: "stop",
					},
				},
				{
					id: "user-2",
					message: {
						role: "user",
						content: "Actually, update docs",
						timestamp: 3,
					},
				},
			],
		});

		expect(context).toBeNull();
	});

	test("assistant usage extraction sanitizes malformed values", () => {
		const messages: unknown[] = [
			{
				role: "user",
				content: "Inspect the project",
				timestamp: 1,
			},
			{
				role: "assistant",
				content: [{ type: "text", text: "Done" }],
				timestamp: 2,
				usage: {
					input: Number.NaN,
					output: Number.POSITIVE_INFINITY,
					cacheRead: -1,
					cacheWrite: 3,
					totalTokens: Number.NEGATIVE_INFINITY,
					cost: { total: -0.2 },
				},
			},
		];

		const context = buildTurnContext({
			turnId: "turn-1",
			sourceLeafId: "leaf-1",
			messagesFromPrompt: messages,
			branchMessages: messages,
			occurredAt: "2026-05-01T00:00:00.000Z",
		});

		expect(context?.assistantUsage).toEqual({
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 3,
			totalTokens: 0,
			costTotal: 0,
		});
	});
});
