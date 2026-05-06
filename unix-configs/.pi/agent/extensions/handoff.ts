import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

interface ReplacementSessionContext {
	ui: {
		notify(message: string, level: "info" | "error"): void;
	};
	sendUserMessage(content: string): Promise<void>;
}

interface HandoffCommandContext {
	hasUI: boolean;
	cwd: string;
	ui: {
		notify(message: string, level: "info" | "error"): void;
	};
	sessionManager: {
		getSessionFile(): string | undefined;
	};
	newSession(options: {
		parentSession?: string;
		withSession(ctx: ReplacementSessionContext): Promise<void> | void;
	}): Promise<{ cancelled: boolean }>;
}

interface PiApi {
	registerCommand(
		name: string,
		options: {
			description: string;
			handler(
				rawArgs: string,
				ctx: HandoffCommandContext,
			): Promise<void> | void;
		},
	): void;
}

const USAGE = "Usage: /handoff <prompt text | path/to/handoff.md>";

function hasMatchingQuotes(value: string): boolean {
	if (value.length < 2) {
		return false;
	}

	const first = value[0];
	const last = value[value.length - 1];
	return (first === '"' && last === '"') || (first === "'" && last === "'");
}

function stripMatchingQuotes(value: string): string {
	return hasMatchingQuotes(value) ? value.slice(1, -1) : value;
}

function expandHome(value: string): string {
	if (value === "~") {
		return homedir();
	}

	if (value.startsWith("~/")) {
		return resolve(homedir(), value.slice(2));
	}

	return value;
}

function resolvePathCandidate(input: string, cwd: string): string {
	const expanded = expandHome(stripMatchingQuotes(input.trim()));
	return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

function looksLikeMarkdownPath(input: string): boolean {
	const trimmed = input.trim();
	if (!hasMatchingQuotes(trimmed) && /\s/.test(trimmed)) {
		return false;
	}

	const normalized = stripMatchingQuotes(trimmed).toLowerCase();
	return normalized.endsWith(".md") || normalized.endsWith(".markdown");
}

async function readMarkdownPrompt(path: string): Promise<string | undefined> {
	const fileStat = await stat(path);
	if (!fileStat.isFile()) {
		return undefined;
	}

	return readFile(path, "utf8");
}

async function resolvePrompt(
	args: string,
	cwd: string,
): Promise<{ prompt: string; source: string }> {
	if (!looksLikeMarkdownPath(args)) {
		return { prompt: args, source: "inline prompt" };
	}

	const candidatePath = resolvePathCandidate(args, cwd);
	const prompt = await readMarkdownPrompt(candidatePath);
	if (prompt === undefined) {
		throw new Error(`Markdown handoff path is not a file: ${candidatePath}`);
	}

	return { prompt, source: candidatePath };
}

export default function (pi: PiApi) {
	pi.registerCommand("handoff", {
		description:
			"Start a fresh session and auto-submit an inline prompt or markdown handoff file",
		handler: async (rawArgs, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/handoff requires interactive mode", "error");
				return;
			}

			const args = rawArgs.trim();
			if (!args) {
				ctx.ui.notify(USAGE, "error");
				return;
			}

			let resolvedPrompt: { prompt: string; source: string };
			try {
				resolvedPrompt = await resolvePrompt(args, ctx.cwd);
			} catch (error) {
				const message =
					error instanceof Error
						? error.message
						: "Failed to resolve handoff prompt";
				ctx.ui.notify(message, "error");
				return;
			}

			if (!resolvedPrompt.prompt.trim()) {
				ctx.ui.notify("Handoff prompt is empty", "error");
				return;
			}

			const parentSession = ctx.sessionManager.getSessionFile();
			const result = await ctx.newSession({
				parentSession,
				withSession: async (replacementCtx) => {
					replacementCtx.ui.notify(
						`Auto-submitting handoff from ${resolvedPrompt.source}`,
						"info",
					);
					await replacementCtx.sendUserMessage(resolvedPrompt.prompt);
				},
			});

			if (result.cancelled) {
				ctx.ui.notify("Handoff cancelled", "info");
			}
		},
	});
}
