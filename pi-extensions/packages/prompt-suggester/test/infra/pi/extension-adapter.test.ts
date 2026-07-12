import { expect, test, vi } from "vitest";
import {
	PiExtensionAdapter,
	type PiExtensionEventApi,
	type PromptSuggesterExtensionContext,
} from "../../../src/infra/pi/extension-adapter";

type Handler = (
	event: unknown,
	ctx: PromptSuggesterExtensionContext,
) => unknown | Promise<unknown>;

type InputHandler = (
	event: unknown,
	ctx: PromptSuggesterExtensionContext,
) => unknown | Promise<unknown>;

class FakePi implements PiExtensionEventApi {
	public inputHandler: InputHandler | undefined;
	public handlers = new Map<string, Handler>();

	public on(event: "input", handler: InputHandler): void;
	public on(
		event: "session_start" | "session_tree" | "session_shutdown",
		handler: Handler,
	): void;
	public on(event: "agent_end", handler: Handler): void;
	public on(event: string, handler: Handler | InputHandler): void {
		if (event === "input") {
			this.inputHandler = handler;
			return;
		}
		this.handlers.set(event, handler);
	}
}

function context(
	branch: PromptSuggesterExtensionContext["sessionManager"]["getBranch"],
): PromptSuggesterExtensionContext {
	return {
		hasUI: false,
		sessionManager: {
			getCwd: () => "/repo",
			getSessionFile: () => "/repo/session.jsonl",
			getSessionId: () => "session-1",
			getLeafId: () => "leaf-1",
			getBranch: branch,
		},
	};
}

test("PiExtensionAdapter routes session_start and session_tree through session start wiring", async () => {
	const pi = new FakePi();
	const onSessionStart = vi.fn(async () => undefined);
	new PiExtensionAdapter(pi, {
		onSessionStart,
		onAgentEnd: vi.fn(async () => undefined),
		onUserSubmit: vi.fn(async () => undefined),
	}).register();
	const ctx = context(() => []);

	await pi.handlers.get("session_start")?.({}, ctx);
	await pi.handlers.get("session_tree")?.({}, ctx);

	expect(onSessionStart).toHaveBeenCalledTimes(2);
	expect(onSessionStart).toHaveBeenCalledWith(ctx);
});

test("PiExtensionAdapter swallows stale context errors from async wiring", async () => {
	const pi = new FakePi();
	new PiExtensionAdapter(pi, {
		onSessionStart: vi.fn(async () => {
			throw new Error("extension ctx is stale after shutdown");
		}),
		onAgentEnd: vi.fn(async () => undefined),
		onUserSubmit: vi.fn(async () => undefined),
	}).register();

	await expect(
		pi.handlers.get("session_start")?.(
			{},
			context(() => []),
		),
	).resolves.toBeUndefined();
});

test("PiExtensionAdapter routes valid input events and always continues input handling", async () => {
	const pi = new FakePi();
	const onUserSubmit = vi.fn(async () => undefined);
	new PiExtensionAdapter(pi, {
		onSessionStart: vi.fn(async () => undefined),
		onAgentEnd: vi.fn(async () => undefined),
		onUserSubmit,
	}).register();
	const ctx = context(() => []);

	await expect(
		pi.inputHandler?.(
			{ type: "input", text: "hello", source: "interactive" },
			ctx,
		),
	).resolves.toEqual({ action: "continue" });
	await expect(
		pi.inputHandler?.({ type: "input", text: 42, source: "interactive" }, ctx),
	).resolves.toEqual({ action: "continue" });

	expect(onUserSubmit).toHaveBeenCalledTimes(1);
	expect(onUserSubmit).toHaveBeenCalledWith(
		{ type: "input", text: "hello", source: "interactive" },
		ctx,
	);
});

test("PiExtensionAdapter builds aborted fallback turns from branch messages when agent_end has no messages", async () => {
	const pi = new FakePi();
	const onAgentEnd = vi.fn(async () => undefined);
	new PiExtensionAdapter(pi, {
		onSessionStart: vi.fn(async () => undefined),
		onAgentEnd,
		onUserSubmit: vi.fn(async () => undefined),
	}).register();
	const ctx = context(() => [
		{
			type: "message",
			message: {
				role: "user",
				content: [{ type: "text", text: "Resume the refactor" }],
				timestamp: 1,
			},
		},
	]);

	await pi.handlers.get("agent_end")?.({ messages: [] }, ctx);

	expect(onAgentEnd).toHaveBeenCalledTimes(1);
	expect(onAgentEnd).toHaveBeenCalledWith(
		expect.objectContaining({
			turnId: "leaf-1",
			sourceLeafId: "leaf-1",
			assistantText: "[aborted]",
			status: "aborted",
			recentUserPrompts: ["Resume the refactor"],
		}),
		ctx,
	);
});
