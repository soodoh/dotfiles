import path from "node:path";
import {
	type ThinkingLevel as AiThinkingLevel,
	completeSimple,
	type Message,
	type Model,
	type UserMessage,
} from "@mariozechner/pi-ai";
import type { Logger } from "../../app/ports/logger";
import type {
	ModelClient,
	ModelInvocationSettings,
	SuggestionModelContext,
} from "../../app/ports/model-client";
import type { TranscriptSuggestionPromptContext } from "../../app/services/transcript-prompt-context-builder";
import {
	REQUIRED_SEED_CATEGORIES,
	type SeedArtifact,
	type SeedCategoryFindings,
	type SeedDraft,
	type SeedKeyFileCategory,
} from "../../domain/seed";
import type { SuggestionUsage } from "../../domain/suggestion";
import {
	accumulateUsage,
	createEmptyUsage,
	normalizeFiniteNonNegativeNumber,
} from "../../domain/usage";
import {
	renderForcedSeederFinalPrompt,
	renderSeederSystemPrompt,
	renderSeederUserPrompt,
} from "../../prompts/seeder-template";
import { renderSuggestionPrompt } from "../../prompts/suggestion-template";
import { renderTranscriptSteeringPrompt } from "../../prompts/transcript-steering-template";
import { resolveFirstAvailableModel } from "../pi/model-resolution";
import {
	executeSeederTool,
	isExpectedSeederToolError,
	type SeederToolName,
	seederToolErrorObservation,
} from "./seeder-tools";

const CLAUDE_BRIDGE_STREAM_SIMPLE_KEY = Symbol.for(
	"claude-bridge:activeStreamSimple",
);

interface ModelRegistryLike {
	getAll(): Model<string>[];
	getApiKeyAndHeaders?: (
		model: Model<string>,
	) => Promise<
		| { ok: true; apiKey?: string; headers?: Record<string, string> }
		| { ok: false; error: string }
	>;
	getApiKey?: (model: Model<string>) => Promise<string | undefined>;
}

interface UiLike {
	notify(message: string, level?: string): void;
}

interface ExtensionContextLike {
	model?: Model<string>;
	modelRegistry: ModelRegistryLike;
	hasUI?: boolean;
	ui: UiLike;
}

export interface RuntimeContextProvider {
	getContext(): ExtensionContextLike | undefined;
}

interface CompletePromptOptions {
	allowEmptyText?: boolean;
}

interface ProviderInvocationContext {
	kind: "suggestion" | "seed";
	configuredModelRef?: string | string[];
	sessionId?: string;
	debugMeta?: Record<string, unknown>;
	allowEmptyText?: boolean;
}

interface CompletionResponseLike {
	content?: unknown;
	usage?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		totalTokens?: number;
		cost?: {
			total?: number;
		};
	};
}

type StreamSimpleLike = (
	model: Model<string>,
	context: { systemPrompt: string; messages: Message[] },
	options: {
		apiKey?: string;
		headers?: Record<string, string>;
		reasoning?: AiThinkingLevel;
		sessionId?: string;
		onPayload?: (payload: unknown) => Promise<undefined>;
	},
) => { result(): Promise<CompletionResponseLike> };

type SeederModelResponse =
	| {
			type: "tool";
			tool: SeederToolName;
			arguments?: Record<string, unknown>;
			reason?: string;
	  }
	| {
			type: "final";
			seed: Record<string, unknown>;
	  };

interface SeederHistoryEntry {
	modelResponse: string;
	toolResult?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isStreamSimpleLike(value: unknown): value is StreamSimpleLike {
	return typeof value === "function";
}

function parseSeederToolName(value: unknown): SeederToolName | undefined {
	switch (String(value ?? "").trim()) {
		case "ls":
			return "ls";
		case "find":
			return "find";
		case "grep":
			return "grep";
		case "read":
			return "read";
		default:
			return undefined;
	}
}

function isRequiredSeedCategory(
	category: SeedKeyFileCategory,
): category is keyof SeedCategoryFindings {
	return (
		category === "vision" ||
		category === "architecture" ||
		category === "principles_guidelines"
	);
}

class SeederRunError extends Error {
	public constructor(
		message: string,
		public readonly usage: SuggestionUsage,
	) {
		super(message);
	}
}

class UnsupportedProviderError extends Error {
	public constructor(
		public readonly providerApi: string,
		public readonly model: Model<string>,
		public readonly configuredModelRef: string | string[] | undefined,
		public readonly invocationKind: "suggestion" | "seed",
	) {
		super(
			invocationKind === "seed"
				? `Prompt suggester cannot generate a seed with provider '${providerApi}'. Set an explicit supported suggester/seeder model instead of relying on this session provider.`
				: `Prompt suggester skipped a suggestion because provider '${providerApi}' is not directly compatible with this extension. Set an explicit supported suggester model or switch the session to a supported provider.`,
		);
	}
}

function preview(value: string, maxChars: number = 500): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxChars) return normalized;
	return `${normalized.slice(0, maxChars)}…`;
}

function isStaleExtensionContextError(error: unknown): boolean {
	return (
		error instanceof Error && error.message.includes("extension ctx is stale")
	);
}

function extractText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (isRecord(block) && block.type === "text") {
				return String(block.text ?? "");
			}
			return "";
		})
		.join("\n")
		.trim();
}

function isTranscriptSuggestionContext(
	context: SuggestionModelContext,
): context is TranscriptSuggestionPromptContext {
	return "transcriptMessages" in context;
}

function tryParseObjectJson(text: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(text);
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function extractBalancedObjectJsonCandidates(text: string): string[] {
	const candidates: string[] = [];
	let inString = false;
	let escaped = false;
	let depth = 0;
	let start = -1;

	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (ch === "\\") {
				escaped = true;
				continue;
			}
			if (ch === '"') {
				inString = false;
			}
			continue;
		}

		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === "{") {
			if (depth === 0) start = i;
			depth += 1;
			continue;
		}
		if (ch === "}") {
			if (depth > 0) depth -= 1;
			if (depth === 0 && start >= 0) {
				candidates.push(text.slice(start, i + 1));
				start = -1;
			}
		}
	}

	return candidates;
}

function parseJsonObject(text: string): Record<string, unknown> {
	const trimmed = text.trim();
	const direct = tryParseObjectJson(trimmed);
	if (direct) return direct;

	const fencedMatches = trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
	for (const match of fencedMatches) {
		const candidate = match[1]?.trim();
		if (!candidate) continue;
		const parsed = tryParseObjectJson(candidate);
		if (parsed) return parsed;
	}

	for (const candidate of extractBalancedObjectJsonCandidates(trimmed)) {
		const parsed = tryParseObjectJson(candidate);
		if (parsed) return parsed;
	}

	throw new Error("Model did not return parseable JSON object");
}

function coerceStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => String(entry))
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function coerceCategory(value: unknown): SeedKeyFileCategory {
	const category = String(value ?? "other").trim();
	if (
		category === "vision" ||
		category === "architecture" ||
		category === "principles_guidelines" ||
		category === "code_entrypoint" ||
		category === "other"
	) {
		return category;
	}
	return "other";
}

function coerceSeedCategoryFinding(value: unknown):
	| {
			found: boolean;
			rationale: string;
			files: string[];
	  }
	| undefined {
	if (!isRecord(value)) return undefined;
	return {
		found: Boolean(value.found),
		rationale: String(value.rationale ?? "").trim(),
		files: coerceStringArray(value.files),
	};
}

function coerceCategoryFindings(
	value: unknown,
): SeedCategoryFindings | undefined {
	if (!isRecord(value)) return undefined;
	const vision = coerceSeedCategoryFinding(value.vision);
	const architecture = coerceSeedCategoryFinding(value.architecture);
	const principlesGuidelines = coerceSeedCategoryFinding(
		value.principles_guidelines,
	);
	if (!vision || !architecture || !principlesGuidelines) return undefined;
	return {
		vision,
		architecture,
		principles_guidelines: principlesGuidelines,
	};
}

function coerceSeedDraft(payload: Record<string, unknown>): SeedDraft {
	const keyFiles = Array.isArray(payload.keyFiles)
		? payload.keyFiles
				.map((entry) => {
					if (!isRecord(entry)) return null;
					const filePath = String(entry.path ?? "").trim();
					const whyImportant = String(entry.whyImportant ?? "").trim();
					if (!filePath) return null;
					return {
						path: filePath,
						whyImportant: whyImportant || "High-signal file",
						category: coerceCategory(entry.category),
					};
				})
				.filter(
					(
						entry,
					): entry is {
						path: string;
						whyImportant: string;
						category: SeedKeyFileCategory;
					} => entry !== null,
				)
		: [];

	const topObjectives = coerceStringArray(payload.topObjectives);
	const constraints = coerceStringArray(payload.constraints);
	const objectivesSummary =
		String(payload.objectivesSummary ?? "").trim() || topObjectives.join("\n");
	const constraintsSummary =
		String(payload.constraintsSummary ?? "").trim() || constraints.join("\n");
	return {
		projectIntentSummary: String(
			payload.projectIntentSummary ?? payload.visionSummary ?? "",
		).trim(),
		objectivesSummary,
		constraintsSummary,
		principlesGuidelinesSummary: String(
			payload.principlesGuidelinesSummary ?? payload.guidelinesSummary ?? "",
		).trim(),
		implementationStatusSummary: String(
			payload.implementationStatusSummary ?? payload.statusSummary ?? "",
		).trim(),
		topObjectives,
		constraints,
		keyFiles,
		categoryFindings: coerceCategoryFindings(payload.categoryFindings),
		openQuestions: coerceStringArray(payload.openQuestions),
		reseedNotes: String(payload.reseedNotes ?? "").trim() || undefined,
	};
}

function parseSeederResponse(text: string): SeederModelResponse {
	const parsed = parseJsonObject(text);
	const type = String(parsed.type ?? "").trim();
	if (type === "tool") {
		const tool = parseSeederToolName(parsed.tool);
		if (!tool) {
			throw new Error(
				`Invalid seeder tool: ${String(parsed.tool ?? "").trim() || "(empty)"}`,
			);
		}
		return {
			type: "tool",
			tool,
			arguments: isRecord(parsed.arguments) ? parsed.arguments : {},
			reason: String(parsed.reason ?? "").trim() || undefined,
		};
	}
	if (type === "final") {
		if (!isRecord(parsed.seed)) {
			throw new Error("Seeder final response missing seed object");
		}
		return {
			type: "final",
			seed: parsed.seed,
		};
	}
	throw new Error(`Invalid seeder response type: ${type || "(empty)"}`);
}

function parseSeederFinalResponse(text: string): Record<string, unknown> {
	const response = parseSeederResponse(text);
	if (response.type !== "final") {
		throw new Error(
			`Forced seeder final synthesis returned type=${response.type} instead of type=final`,
		);
	}
	return response.seed;
}

type SeedDraftValidation =
	| { ok: true }
	| { ok: false; reason: string; retryable: boolean };

function validateSeedCoverage(draft: SeedDraft): {
	ok: boolean;
	reason?: string;
} {
	const findings = draft.categoryFindings;
	if (!findings) {
		return {
			ok: false,
			reason:
				"Missing categoryFindings. Provide explicit findings for vision/architecture/principles_guidelines.",
		};
	}

	for (const category of REQUIRED_SEED_CATEGORIES) {
		if (!isRequiredSeedCategory(category)) continue;
		const finding = findings[category];
		if (!finding) {
			return { ok: false, reason: `Missing categoryFindings.${category}` };
		}
		if (!finding.rationale.trim()) {
			return {
				ok: false,
				reason: `categoryFindings.${category}.rationale is empty`,
			};
		}
		const hasCategoryFile = draft.keyFiles.some(
			(file) => file.category === category,
		);
		if (finding.found && !hasCategoryFile) {
			return {
				ok: false,
				reason: `categoryFindings.${category}.found=true but no keyFiles are marked as ${category}`,
			};
		}
	}

	return { ok: true };
}

function validateFinalSeedDraft(draft: SeedDraft): SeedDraftValidation {
	if (!draft.projectIntentSummary) {
		return {
			ok: false,
			reason: "Seeder final response missing projectIntentSummary",
			retryable: false,
		};
	}
	if (!draft.objectivesSummary) {
		return {
			ok: false,
			reason: "Seeder final response missing objectivesSummary",
			retryable: false,
		};
	}
	if (!draft.constraintsSummary) {
		return {
			ok: false,
			reason: "Seeder final response missing constraintsSummary",
			retryable: false,
		};
	}
	if (!draft.principlesGuidelinesSummary) {
		return {
			ok: false,
			reason: "Seeder final response missing principlesGuidelinesSummary",
			retryable: false,
		};
	}
	if (!draft.implementationStatusSummary) {
		return {
			ok: false,
			reason: "Seeder final response missing implementationStatusSummary",
			retryable: false,
		};
	}
	if (draft.keyFiles.length === 0) {
		return {
			ok: false,
			reason: "Seeder final response produced no keyFiles",
			retryable: false,
		};
	}
	const coverage = validateSeedCoverage(draft);
	return coverage.ok
		? { ok: true }
		: {
				ok: false,
				reason: coverage.reason ?? "Seeder final response failed coverage",
				retryable: true,
			};
}

export class PiModelClient implements ModelClient {
	private readonly cwd: string;
	private readonly warnedCompatibilityKeys = new Set<string>();

	public constructor(
		private readonly runtime: RuntimeContextProvider,
		private readonly logger?: Logger,
		cwd: string = process.cwd(),
	) {
		this.cwd = path.resolve(cwd);
	}

	public async generateSeed(input: {
		reseedTrigger: import("../../domain/seed").ReseedTrigger;
		previousSeed: SeedArtifact | null;
		settings?: ModelInvocationSettings;
		runId?: string;
	}): Promise<{ seed: SeedDraft; usage?: SuggestionUsage }> {
		const runId = input.runId ?? `seed-${Date.now().toString(36)}`;
		const systemPrompt = renderSeederSystemPrompt();
		const history: SeederHistoryEntry[] = [];
		const maxSteps = 16;
		let usage = createEmptyUsage();
		this.logger?.info("seeder.run.started", {
			runId,
			reason: input.reseedTrigger.reason,
			changedFiles: input.reseedTrigger.changedFiles,
			modelRef: input.settings?.modelRef,
			thinking: input.settings?.thinkingLevel,
			maxSteps,
		});

		try {
			for (let step = 1; step <= maxSteps; step += 1) {
				const prompt = renderSeederUserPrompt({
					reseedTrigger: input.reseedTrigger,
					previousSeed: input.previousSeed,
					cwd: this.cwd,
					step,
					maxSteps,
					history,
				});
				const responseText = await this.completePrompt(
					prompt,
					systemPrompt,
					input.settings,
				);
				usage = accumulateUsage(usage, responseText.usage);
				const response = parseSeederResponse(responseText.text);

				if (response.type === "final") {
					const draft = coerceSeedDraft(response.seed);
					const validation = validateFinalSeedDraft(draft);
					if (!validation.ok && !validation.retryable) {
						throw new Error(validation.reason);
					}
					if (validation.ok) {
						this.logger?.info("seeder.run.completed", {
							runId,
							step,
							keyFiles: draft.keyFiles.map((file) => file.path),
							categoryFindings: draft.categoryFindings,
							tokens: usage.totalTokens,
							cost: usage.costTotal,
						});
						return {
							seed: draft,
							usage,
						};
					}
					this.logger?.warn("seeder.validation.failed", {
						runId,
						step,
						reason: validation.reason,
						modelResponsePreview: preview(responseText.text),
					});
					history.push({
						modelResponse: responseText.text,
						toolResult: `Validation failed: ${validation.reason}. Continue exploring and/or explicitly report not-found categories in categoryFindings.`,
					});
					continue;
				}

				this.logger?.info("seeder.tool.requested", {
					runId,
					step,
					tool: response.tool,
					arguments: response.arguments,
					reason: response.reason,
					modelResponsePreview: preview(responseText.text),
				});
				let toolResult: string;
				try {
					toolResult = await executeSeederTool({
						cwd: this.cwd,
						logger: this.logger,
						tool: response.tool,
						args: response.arguments ?? {},
					});
				} catch (error) {
					if (!isExpectedSeederToolError(error)) throw error;
					toolResult = seederToolErrorObservation(error);
					this.logger?.warn("seeder.tool.failed", {
						runId,
						step,
						tool: response.tool,
						arguments: response.arguments,
						error: error instanceof Error ? error.message : String(error),
						toolResultPreview: preview(toolResult, 700),
					});
				}
				this.logger?.info("seeder.tool.result", {
					runId,
					step,
					tool: response.tool,
					toolResultPreview: preview(toolResult, 700),
				});
				history.push({
					modelResponse: responseText.text,
					toolResult,
				});
			}

			this.logger?.warn("seeder.run.max_steps_reached", {
				runId,
				maxSteps,
				tokens: usage.totalTokens,
				cost: usage.costTotal,
			});

			const forcedPrompt = renderForcedSeederFinalPrompt({
				reseedTrigger: input.reseedTrigger,
				previousSeed: input.previousSeed,
				cwd: this.cwd,
				step: maxSteps,
				maxSteps,
				history,
			});
			const forcedResponseText = await this.completePrompt(
				forcedPrompt,
				systemPrompt,
				input.settings,
			);
			usage = accumulateUsage(usage, forcedResponseText.usage);
			const forcedDraft = coerceSeedDraft(
				parseSeederFinalResponse(forcedResponseText.text),
			);
			const forcedValidation = validateFinalSeedDraft(forcedDraft);
			if (!forcedValidation.ok) {
				throw new Error(
					forcedValidation.retryable
						? `Forced seeder final synthesis failed validation: ${forcedValidation.reason}`
						: forcedValidation.reason,
				);
			}
			this.logger?.info("seeder.run.completed", {
				runId,
				step: maxSteps + 1,
				keyFiles: forcedDraft.keyFiles.map((file) => file.path),
				categoryFindings: forcedDraft.categoryFindings,
				tokens: usage.totalTokens,
				cost: usage.costTotal,
				forcedFinalSynthesis: true,
			});
			return {
				seed: forcedDraft,
				usage,
			};
		} catch (error) {
			if (error instanceof SeederRunError) throw error;
			throw new SeederRunError(errorMessage(error), usage);
		}
	}

	public async generateSuggestion(
		context: SuggestionModelContext,
		settings?: ModelInvocationSettings,
	): Promise<{ text: string; usage?: SuggestionUsage }> {
		if (isTranscriptSuggestionContext(context)) {
			const suffixPrompt = renderTranscriptSteeringPrompt(context);
			const userMessage: UserMessage = {
				role: "user",
				content: [{ type: "text", text: suffixPrompt }],
				timestamp: Date.now(),
			};
			return await this.completePrompt(
				[...context.transcriptMessages, userMessage],
				context.systemPrompt,
				settings,
				context.sessionId,
				{
					suggestionMode: "transcript-steering",
					transcriptMessageCount: context.transcriptMessageCount,
				},
				{ allowEmptyText: true },
			);
		}
		return await this.completePrompt(
			[
				{
					role: "user",
					content: [
						{
							type: "text",
							text: renderSuggestionPrompt(context),
						},
					],
					timestamp: Date.now(),
				},
			],
			undefined,
			settings,
			undefined,
			{ suggestionMode: "compact" },
			{ allowEmptyText: true },
		);
	}

	private async completePrompt(
		messagesOrPrompt: Message[] | string,
		systemPrompt?: string,
		settings?: ModelInvocationSettings,
		sessionId?: string,
		debugMeta?: Record<string, unknown>,
		options?: CompletePromptOptions,
	): Promise<{ text: string; usage?: SuggestionUsage }> {
		let model: Model<string>;
		let apiKey: string | undefined;
		let headers: Record<string, string> | undefined;
		let activeContext: ExtensionContextLike | undefined;
		try {
			const ctx = this.runtime.getContext();
			if (!ctx?.model) {
				throw new Error("No active model available for suggester");
			}

			activeContext = ctx;
			model = this.resolveModelForCall(
				ctx.model,
				settings?.modelRef,
				ctx.modelRegistry.getAll(),
			);
			const auth = await this.resolveRequestAuth(model, ctx.modelRegistry);
			apiKey = auth.apiKey;
			headers = auth.headers;
		} catch (error) {
			if (options?.allowEmptyText && isStaleExtensionContextError(error)) {
				return { text: "", usage: undefined };
			}
			throw error;
		}

		const messages =
			typeof messagesOrPrompt === "string"
				? [
						{
							role: "user",
							content: [{ type: "text", text: messagesOrPrompt }],
							timestamp: Date.now(),
						} satisfies UserMessage,
					]
				: messagesOrPrompt;
		const requestContext = {
			systemPrompt:
				systemPrompt ??
				"You are the internal model used by pi-prompt-suggester. Follow the user prompt exactly and return only the requested format.",
			messages,
		};
		const requestOptions = {
			apiKey,
			headers,
			reasoning: settings?.thinkingLevel,
			sessionId,
			onPayload: async (payload: unknown) => {
				this.logger?.debug("suggestion.provider.payload", {
					...debugMeta,
					sessionId,
					payloadPreview: preview(JSON.stringify(payload), 1000),
				});
				return undefined;
			},
		};

		let response: CompletionResponseLike;
		try {
			response = await this.invokeModel(model, requestContext, requestOptions, {
				kind: options?.allowEmptyText ? "suggestion" : "seed",
				configuredModelRef: settings?.modelRef,
				sessionId,
				debugMeta,
				allowEmptyText: options?.allowEmptyText,
			});
		} catch (error) {
			if (
				error instanceof UnsupportedProviderError &&
				options?.allowEmptyText
			) {
				if (activeContext)
					this.warnUnsupportedProviderOnce(error, activeContext);
				return { text: "", usage: undefined };
			}
			throw error;
		}

		const text = extractText(response.content);
		if (!text && !options?.allowEmptyText)
			throw new Error("Model returned empty text");
		return {
			text,
			usage: {
				inputTokens: normalizeFiniteNonNegativeNumber(response.usage?.input),
				outputTokens: normalizeFiniteNonNegativeNumber(response.usage?.output),
				cacheReadTokens: normalizeFiniteNonNegativeNumber(
					response.usage?.cacheRead,
				),
				cacheWriteTokens: normalizeFiniteNonNegativeNumber(
					response.usage?.cacheWrite,
				),
				totalTokens: normalizeFiniteNonNegativeNumber(
					response.usage?.totalTokens,
				),
				costTotal: normalizeFiniteNonNegativeNumber(
					response.usage?.cost?.total,
				),
			},
		};
	}

	private async invokeModel(
		model: Model<string>,
		context: { systemPrompt: string; messages: Message[] },
		options: {
			apiKey?: string;
			headers?: Record<string, string>;
			reasoning?: AiThinkingLevel;
			sessionId?: string;
			onPayload?: (payload: unknown) => Promise<undefined>;
		},
		invocation: ProviderInvocationContext,
	): Promise<CompletionResponseLike> {
		const claudeBridgeStream = this.getClaudeBridgeStreamSimple();
		if (model.api === "claude-bridge" && claudeBridgeStream) {
			this.logger?.debug("suggestion.provider.compat_shim", {
				providerApi: model.api,
				provider: model.provider,
				model: model.id,
				configuredModelRef: invocation.configuredModelRef,
				kind: invocation.kind,
			});
			return await claudeBridgeStream(model, context, options).result();
		}

		try {
			return await completeSimple(model, context, options);
		} catch (error) {
			if (this.isMissingProviderRegistrationError(error, model.api)) {
				throw new UnsupportedProviderError(
					model.api,
					model,
					invocation.configuredModelRef,
					invocation.kind,
				);
			}
			throw error;
		}
	}

	private getClaudeBridgeStreamSimple(): StreamSimpleLike | undefined {
		const value = Reflect.get(globalThis, CLAUDE_BRIDGE_STREAM_SIMPLE_KEY);
		return isStreamSimpleLike(value) ? value : undefined;
	}

	private isMissingProviderRegistrationError(
		error: unknown,
		api: string,
	): boolean {
		return (
			error instanceof Error &&
			error.message.includes(`No API provider registered for api: ${api}`)
		);
	}

	private warnUnsupportedProviderOnce(
		error: UnsupportedProviderError,
		ctx: ExtensionContextLike,
	): void {
		const configuredModelRef = Array.isArray(error.configuredModelRef)
			? error.configuredModelRef.join(", ")
			: error.configuredModelRef?.trim() || "session-default";
		const key = `${error.invocationKind}:${error.providerApi}:${configuredModelRef}`;
		if (this.warnedCompatibilityKeys.has(key)) return;
		this.warnedCompatibilityKeys.add(key);

		this.logger?.warn("suggestion.provider.incompatible", {
			providerApi: error.providerApi,
			provider: error.model.provider,
			model: error.model.id,
			configuredModelRef,
			resolution:
				"Set promptSuggester.suggesterModel in ~/.pi/agent/settings.json to a supported provider/model or switch the session to a provider that this extension can call directly.",
		});

		try {
			if (ctx.hasUI) {
				ctx.ui.notify(
					`Prompt suggester skipped this turn because provider '${error.providerApi}' isn't directly compatible. Set promptSuggester.suggesterModel in ~/.pi/agent/settings.json to use an explicit model.`,
					"warning",
				);
			}
		} catch {
			// Ignore stale UI contexts from async suggestion work finishing after shutdown.
		}
	}

	private async resolveRequestAuth(
		model: Model<string>,
		modelRegistry: {
			getApiKeyAndHeaders?: (
				model: Model<string>,
			) => Promise<
				| { ok: true; apiKey?: string; headers?: Record<string, string> }
				| { ok: false; error: string }
			>;
			getApiKey?: (model: Model<string>) => Promise<string | undefined>;
		},
	): Promise<{ apiKey?: string; headers?: Record<string, string> }> {
		if (typeof modelRegistry.getApiKeyAndHeaders === "function") {
			const auth = await modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) {
				throw new Error(auth.error);
			}
			return {
				apiKey: auth.apiKey,
				headers: auth.headers,
			};
		}

		return {
			apiKey: await modelRegistry.getApiKey?.(model),
		};
	}

	private resolveModelForCall(
		currentModel: Model<string>,
		modelRef: string | string[] | undefined,
		allModels: Model<string>[],
	): Model<string> {
		return resolveFirstAvailableModel({
			currentModel,
			configuredModelRefs: modelRef,
			allModels,
		}).model;
	}
}
