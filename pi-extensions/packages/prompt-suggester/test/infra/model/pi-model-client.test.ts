import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Model, SimpleStreamOptions } from "@mariozechner/pi-ai";
import { afterEach, expect, test } from "vitest";
import type { Logger } from "../../../src/app/ports/logger";
import type { SuggestionPromptContext } from "../../../src/app/services/prompt-context-builder";
import {
	PiModelClient,
	type RuntimeContextProvider,
} from "../../../src/infra/model/pi-model-client";
import { globToRegExp } from "../../../src/infra/model/seeder-tools";

const { registerApiProvider, unregisterApiProviders } = await import(
	pathToFileURL(
		join(
			process.cwd(),
			"node_modules/@mariozechner/pi-ai/dist/api-registry.js",
		),
	).href
);

const CLAUDE_BRIDGE_STREAM_SIMPLE_KEY = Symbol.for(
	"claude-bridge:activeStreamSimple",
);
const tempDirs: string[] = [];

async function tempDir(name: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), `${name}-`));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

type TestModel = Model<string>;
type AuthResult =
	| { ok: true; apiKey?: string; headers?: Record<string, string> }
	| { ok: false; error: string };
type CompletionResponse = {
	content: Array<{ type: "text"; text: string }>;
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		totalTokens: number;
		cost: { total: number };
	};
};

type RuntimeOverrides = {
	hasUI?: boolean;
	notify?: (message: string, level?: string) => void;
	getApiKeyAndHeaders?: (model: TestModel) => Promise<AuthResult>;
};

function createRuntimeWithModel(
	model: TestModel,
	overrides: RuntimeOverrides = {},
): RuntimeContextProvider {
	const notify = overrides.notify ?? (() => undefined);
	return {
		getContext() {
			return {
				model,
				modelRegistry: {
					getAll() {
						return [model];
					},
					async getApiKeyAndHeaders(requestedModel: TestModel) {
						expect(requestedModel).toBe(model);
						return overrides.getApiKeyAndHeaders
							? await overrides.getApiKeyAndHeaders(requestedModel)
							: { ok: true };
					},
				},
				hasUI: overrides.hasUI ?? false,
				ui: { notify },
			};
		},
	};
}

function createSuggestionContext(): SuggestionPromptContext {
	return {
		latestAssistantTurn: "I can do that.",
		turnStatus: "success",
		intentSeed: null,
		recentUserPrompts: ["Fix the tests"],
		toolSignals: [],
		touchedFiles: [],
		unresolvedQuestions: [],
		recentChanged: [],
		customInstruction: "",
		noSuggestionToken: "[no suggestion]",
		maxSuggestionChars: 200,
	};
}

function createModel(api: string, provider = "test"): TestModel {
	return {
		api,
		provider,
		id: "model-1",
		name: "model-1",
		baseUrl: "http://localhost",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 1000,
	};
}

function successResponse(text: string): CompletionResponse {
	return {
		content: [{ type: "text", text }],
		usage: {
			input: 1,
			output: text.trim() ? 1 : 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 1,
			cost: { total: 0 },
		},
	};
}

function registerTestProvider(
	response: CompletionResponse,
	onOptions?: (options: SimpleStreamOptions | undefined) => void,
) {
	const api = `test-api-${Math.random().toString(36).slice(2)}`;
	const sourceId = `test-provider-${Math.random().toString(36).slice(2)}`;
	registerApiProvider(
		{
			api,
			stream() {
				throw new Error("stream should not be used in these tests");
			},
			streamSimple(
				_model: TestModel,
				_context: unknown,
				options?: SimpleStreamOptions,
			) {
				onOptions?.(options);
				return {
					async result() {
						return response;
					},
				};
			},
		},
		sourceId,
	);
	return {
		sourceId,
		model: createModel(api),
		unregister() {
			unregisterApiProviders(sourceId);
		},
	};
}

test("globToRegExp supports single-character ? wildcards", () => {
	const matcher = globToRegExp("src/file?.ts");
	expect(matcher.test("src/file1.ts")).toBe(true);
	expect(matcher.test("src/fileA.ts")).toBe(true);
	expect(matcher.test("src/file10.ts")).toBe(false);
	expect(matcher.test("src/file/.ts")).toBe(false);
});

test("globToRegExp treats **/ as matching root-level files", () => {
	const matcher = globToRegExp("**/*.ts");
	expect(matcher.test("index.ts")).toBe(true);
	expect(matcher.test("src/index.ts")).toBe(true);
	expect(matcher.test("src/nested/index.ts")).toBe(true);
});

test("PiModelClient find tool matches root files for plain patterns", async (t) => {
	const cwd = await tempDir("pi-suggester-find");
	await writeFile(join(cwd, "package.json"), "{}\n", "utf8");
	let callCount = 0;
	const api = `test-api-${Math.random().toString(36).slice(2)}`;
	const sourceId = `test-provider-${Math.random().toString(36).slice(2)}`;
	registerApiProvider(
		{
			api,
			stream() {
				throw new Error("stream should not be used in these tests");
			},
			streamSimple() {
				callCount += 1;
				return {
					async result() {
						return successResponse(
							callCount === 1
								? JSON.stringify({
										type: "tool",
										tool: "find",
										arguments: { pattern: "package.json" },
									})
								: JSON.stringify({
										type: "final",
										seed: {
											projectIntentSummary: "Test project",
											objectivesSummary: "Exercise find tool",
											constraintsSummary: "Keep tests small",
											principlesGuidelinesSummary: "Use fixtures",
											implementationStatusSummary: "Ready",
											topObjectives: ["Exercise find tool"],
											constraints: ["Keep tests small"],
											keyFiles: [
												{
													path: "package.json",
													category: "vision",
													whyImportant: "Root package metadata",
												},
											],
											categoryFindings: {
												vision: {
													found: true,
													rationale: "Root metadata found",
												},
												architecture: {
													found: false,
													rationale: "Not needed for this fixture",
												},
												principles_guidelines: {
													found: false,
													rationale: "Not needed for this fixture",
												},
											},
										},
									}),
						);
					},
				};
			},
		},
		sourceId,
	);
	t.onTestFinished(() => unregisterApiProviders(sourceId));
	const toolResults: string[] = [];
	const logger: Logger = {
		debug() {},
		info(_message, meta) {
			if (typeof meta?.toolResultPreview === "string") {
				toolResults.push(meta.toolResultPreview);
			}
		},
		warn() {},
		error() {},
	};
	const model = createModel(api);
	const client = new PiModelClient(createRuntimeWithModel(model), logger, cwd);

	await client.generateSeed({
		reseedTrigger: { reason: "manual", changedFiles: [] },
		previousSeed: null,
	});

	expect(toolResults).toContain("package.json");
});

test("PiModelClient returns bounded tool errors to the seeder after missing paths", async (t) => {
	const cwd = await tempDir("pi-suggester-missing-tool-path");
	await writeFile(join(cwd, "visible.txt"), "visible\n", "utf8");
	let callCount = 0;
	const api = `test-api-${Math.random().toString(36).slice(2)}`;
	const sourceId = `test-provider-${Math.random().toString(36).slice(2)}`;
	registerApiProvider(
		{
			api,
			stream() {
				throw new Error("stream should not be used in these tests");
			},
			streamSimple() {
				callCount += 1;
				return {
					async result() {
						return successResponse(
							callCount === 1
								? JSON.stringify({
										type: "tool",
										tool: "read",
										arguments: { path: "missing.txt" },
									})
								: JSON.stringify({
										type: "final",
										seed: {
											projectIntentSummary: "Test project",
											objectivesSummary: "Exercise tool error recovery",
											constraintsSummary: "Keep tests small",
											principlesGuidelinesSummary: "Use fixtures",
											implementationStatusSummary: "Ready",
											topObjectives: ["Exercise tool error recovery"],
											constraints: ["Keep tests small"],
											keyFiles: [
												{
													path: "visible.txt",
													category: "vision",
													whyImportant: "Fixture file",
												},
											],
											categoryFindings: {
												vision: { found: true, rationale: "fixture file" },
												architecture: {
													found: false,
													rationale: "not needed",
												},
												principles_guidelines: {
													found: false,
													rationale: "not needed",
												},
											},
										},
									}),
						);
					},
				};
			},
		},
		sourceId,
	);
	t.onTestFinished(() => unregisterApiProviders(sourceId));
	const warnings: string[] = [];
	const results: string[] = [];
	const logger: Logger = {
		debug() {},
		info(_message, meta) {
			if (typeof meta?.toolResultPreview === "string") {
				results.push(meta.toolResultPreview);
			}
		},
		warn(_message, meta) {
			if (typeof meta?.toolResultPreview === "string") {
				warnings.push(meta.toolResultPreview);
			}
		},
		error() {},
	};
	const model = createModel(api);
	const client = new PiModelClient(createRuntimeWithModel(model), logger, cwd);

	const result = await client.generateSeed({
		reseedTrigger: { reason: "manual", changedFiles: [] },
		previousSeed: null,
	});

	expect(result.seed.keyFiles[0]?.path).toBe("visible.txt");
	expect(callCount).toBe(2);
	expect(warnings.join("\n")).toContain("[tool error:");
	expect(warnings.join("\n")).toContain("missing.txt");
	expect(results.join("\n")).toContain("[tool error:");
});

test("PiModelClient resolves auth via getApiKeyAndHeaders when available", async (t) => {
	let observedOptions: SimpleStreamOptions | undefined;
	const provider = registerTestProvider(successResponse("ok"), (options) => {
		observedOptions = options;
	});
	t.onTestFinished(() => provider.unregister());
	const client = new PiModelClient(
		createRuntimeWithModel(provider.model, {
			async getApiKeyAndHeaders() {
				return {
					ok: true,
					apiKey: "token-123",
					headers: { "x-test": "1" },
				};
			},
		}),
	);

	await client.generateSuggestion(createSuggestionContext());

	expect(observedOptions?.apiKey).toBe("token-123");
	expect(observedOptions?.headers).toEqual({ "x-test": "1" });
});

test("PiModelClient accepts header-only auth results from getApiKeyAndHeaders", async (t) => {
	let observedOptions: SimpleStreamOptions | undefined;
	const provider = registerTestProvider(successResponse("ok"), (options) => {
		observedOptions = options;
	});
	t.onTestFinished(() => provider.unregister());
	const client = new PiModelClient(
		createRuntimeWithModel(provider.model, {
			async getApiKeyAndHeaders() {
				return {
					ok: true,
					headers: { Authorization: "Bearer delegated" },
				};
			},
		}),
	);

	await client.generateSuggestion(createSuggestionContext());

	expect(observedOptions?.apiKey).toBeUndefined();
	expect(observedOptions?.headers).toEqual({
		Authorization: "Bearer delegated",
	});
});

test("PiModelClient falls back to getApiKey for older ModelRegistry versions", async (t) => {
	let observedOptions: SimpleStreamOptions | undefined;
	const provider = registerTestProvider(successResponse("ok"), (options) => {
		observedOptions = options;
	});
	t.onTestFinished(() => provider.unregister());
	const model = provider.model;
	const client = new PiModelClient({
		getContext() {
			return {
				model,
				modelRegistry: {
					getAll() {
						return [model];
					},
					async getApiKey(requestedModel: TestModel) {
						expect(requestedModel).toBe(model);
						return "legacy-token";
					},
				},
				hasUI: false,
				ui: { notify() {} },
			};
		},
	});

	await client.generateSuggestion(createSuggestionContext());

	expect(observedOptions?.apiKey).toBe("legacy-token");
});

test("PiModelClient uses first available configured model", async (t) => {
	const provider = registerTestProvider(successResponse("fallback suggestion"));
	t.onTestFinished(() => provider.unregister());
	const currentModel = {
		...provider.model,
		provider: "current",
		id: "current",
	};
	const fallbackModel = {
		...provider.model,
		provider: "fallback",
		id: "model-good",
	};
	const client = new PiModelClient({
		getContext() {
			return {
				model: currentModel,
				modelRegistry: {
					getAll() {
						return [currentModel, fallbackModel];
					},
					async getApiKeyAndHeaders(requestedModel: TestModel) {
						expect(requestedModel).toBe(fallbackModel);
						return { ok: true };
					},
				},
				hasUI: false,
				ui: { notify() {} },
			};
		},
	});

	const result = await client.generateSuggestion(createSuggestionContext(), {
		modelRef: ["missing/model", "fallback/model-good"],
	});

	expect(result.text).toBe("fallback suggestion");
});

test("PiModelClient surfaces ModelRegistry auth errors", async (t) => {
	const provider = registerTestProvider(successResponse("ok"));
	t.onTestFinished(() => provider.unregister());
	const client = new PiModelClient(
		createRuntimeWithModel(provider.model, {
			async getApiKeyAndHeaders() {
				return { ok: false, error: "missing auth" };
			},
		}),
	);

	await expect(
		client.generateSuggestion(createSuggestionContext()),
	).rejects.toThrow(/missing auth/);
});

test("PiModelClient allows empty text for suggestions", async (t) => {
	const provider = registerTestProvider(successResponse("   "));
	t.onTestFinished(() => provider.unregister());
	const client = new PiModelClient(createRuntimeWithModel(provider.model));

	const result = await client.generateSuggestion(createSuggestionContext());

	expect(result.text).toBe("");
	expect(typeof result.usage?.totalTokens).toBe("number");
});

test("PiModelClient uses claude-bridge global shim when local provider registry cannot resolve it", async (t) => {
	const bridgeModel = createModel("claude-bridge", "claude-bridge");
	Reflect.set(globalThis, CLAUDE_BRIDGE_STREAM_SIMPLE_KEY, () => ({
		async result() {
			return successResponse("Use the test shim.");
		},
	}));
	t.onTestFinished(() => {
		Reflect.deleteProperty(globalThis, CLAUDE_BRIDGE_STREAM_SIMPLE_KEY);
	});
	const client = new PiModelClient(createRuntimeWithModel(bridgeModel));

	const result = await client.generateSuggestion(createSuggestionContext());

	expect(result.text).toBe("Use the test shim.");
	expect(result.usage?.totalTokens).toBe(1);
});

test("PiModelClient degrades unsupported providers to empty suggestions and warns once", async () => {
	const unsupportedModel = createModel("custom-bridge", "custom");
	const warnings: Array<{ message: string; meta?: Record<string, unknown> }> =
		[];
	const notifications: Array<{ message: string; level?: string }> = [];
	const logger: Logger = {
		debug() {},
		info() {},
		warn(message, meta) {
			warnings.push({ message, meta });
		},
		error() {},
	};
	const client = new PiModelClient(
		createRuntimeWithModel(unsupportedModel, {
			hasUI: true,
			notify(message, level) {
				notifications.push({ message, level });
			},
		}),
		logger,
	);

	const first = await client.generateSuggestion(createSuggestionContext());
	const second = await client.generateSuggestion(createSuggestionContext());

	expect(first.text).toBe("");
	expect(second.text).toBe("");
	expect(warnings.length).toBe(1);
	expect(warnings[0].message).toBe("suggestion.provider.incompatible");
	expect(notifications.length).toBe(1);
	expect(notifications[0].message).toMatch(/isn't directly compatible/);
});

test("PiModelClient fails clearly for unsupported seeder providers", async () => {
	const unsupportedModel = createModel("custom-bridge", "custom");
	const client = new PiModelClient(createRuntimeWithModel(unsupportedModel));

	await expect(
		client.generateSeed({
			reseedTrigger: { reason: "manual", changedFiles: [] },
			previousSeed: null,
		}),
	).rejects.toThrow(/not generate a seed with provider 'custom-bridge'/);
});

test("PiModelClient still rejects empty text for seeder", async (t) => {
	const provider = registerTestProvider(successResponse("   "));
	t.onTestFinished(() => provider.unregister());
	const client = new PiModelClient(createRuntimeWithModel(provider.model));

	await expect(
		client.generateSeed({
			reseedTrigger: { reason: "manual", changedFiles: [] },
			previousSeed: null,
		}),
	).rejects.toThrow(/Model returned empty text/);
});
async function runSeederToolPreview(
	cwd: string,
	tool: string,
	args: Record<string, unknown>,
): Promise<string> {
	let callCount = 0;
	const api = `test-api-${Math.random().toString(36).slice(2)}`;
	const sourceId = `test-provider-${Math.random().toString(36).slice(2)}`;
	registerApiProvider(
		{
			api,
			stream() {
				throw new Error("stream should not be used in these tests");
			},
			streamSimple() {
				callCount += 1;
				return {
					async result() {
						return successResponse(
							callCount === 1
								? JSON.stringify({ type: "tool", tool, arguments: args })
								: JSON.stringify({
										type: "final",
										seed: {
											projectIntentSummary: "Test project",
											objectivesSummary: "Exercise tool",
											constraintsSummary: "Keep tests small",
											principlesGuidelinesSummary: "Use fixtures",
											implementationStatusSummary: "Ready",
											topObjectives: ["Exercise tool"],
											constraints: ["Keep tests small"],
											keyFiles: [
												{
													path: "visible.txt",
													category: "vision",
													whyImportant: "Fixture file",
												},
											],
											categoryFindings: {
												vision: { found: true, rationale: "fixture file" },
												architecture: { found: false, rationale: "not needed" },
												principles_guidelines: {
													found: false,
													rationale: "not needed",
												},
											},
										},
									}),
						);
					},
				};
			},
		},
		sourceId,
	);
	const previews: string[] = [];
	const logger: Logger = {
		debug() {},
		info(_message, meta) {
			if (typeof meta?.toolResultPreview === "string") {
				previews.push(meta.toolResultPreview);
			}
		},
		warn() {},
		error() {},
	};
	try {
		const model = createModel(api);
		const client = new PiModelClient(
			createRuntimeWithModel(model),
			logger,
			cwd,
		);
		await client.generateSeed({
			reseedTrigger: { reason: "manual", changedFiles: [] },
			previousSeed: null,
		});
		return previews.join("\n");
	} finally {
		unregisterApiProviders(sourceId);
	}
}

test("PiModelClient ls and find tools ignore local cache directories", async () => {
	const cwd = await tempDir("pi-suggester-ignore");
	await mkdir(join(cwd, ".turbo"));
	await mkdir(join(cwd, ".pi-lens"));
	await mkdir(join(cwd, ".ralph"));
	await writeFile(join(cwd, "visible.txt"), "visible\n", "utf8");
	await writeFile(join(cwd, ".turbo", "hidden.txt"), "hidden\n", "utf8");
	await writeFile(join(cwd, ".pi-lens", "hidden.txt"), "hidden\n", "utf8");
	await writeFile(join(cwd, ".ralph", "hidden.txt"), "hidden\n", "utf8");

	const lsPreview = await runSeederToolPreview(cwd, "ls", { path: "." });
	const findPreview = await runSeederToolPreview(cwd, "find", {
		path: ".",
		pattern: "hidden.txt",
	});

	expect(lsPreview).toContain("visible.txt");
	expect(lsPreview).not.toContain(".turbo");
	expect(lsPreview).not.toContain(".pi-lens");
	expect(lsPreview).not.toContain(".ralph");
	expect(findPreview).toContain("(no matches)");
});

test("PiModelClient grep tool treats leading-option patterns as literals", async () => {
	const cwd = await tempDir("pi-suggester-grep");
	await writeFile(join(cwd, "visible.txt"), "literal --files token\n", "utf8");

	const preview = await runSeederToolPreview(cwd, "grep", {
		path: ".",
		pattern: "--files",
		literal: true,
	});

	expect(preview).toContain("visible.txt:1:literal --files token");
});

test("PiModelClient ls tool falls back for malformed limits", async () => {
	const cwd = await tempDir("pi-suggester-ls-limit");
	await writeFile(join(cwd, "visible.txt"), "visible\n", "utf8");

	const preview = await runSeederToolPreview(cwd, "ls", {
		path: ".",
		limit: "not-a-number",
	});

	expect(preview).toContain("visible.txt");
});

test("PiModelClient grep tool falls back for malformed limits", async () => {
	const cwd = await tempDir("pi-suggester-grep-limit");
	await writeFile(join(cwd, "visible.txt"), "needle\n", "utf8");

	const preview = await runSeederToolPreview(cwd, "grep", {
		path: ".",
		pattern: "needle",
		limit: "not-a-number",
	});

	expect(preview).toContain("visible.txt:1:needle");
});

test("PiModelClient seeder tools operate on the checked real path", async () => {
	const cwd = await tempDir("pi-suggester-realpath");
	await mkdir(join(cwd, "safe"));
	await writeFile(join(cwd, "safe", "visible.txt"), "visible\n", "utf8");
	await symlink(join(cwd, "safe"), join(cwd, "linked-safe"));

	const preview = await runSeederToolPreview(cwd, "ls", {
		path: "linked-safe",
	});

	expect(preview).toContain("safe/visible.txt");
	expect(preview).not.toContain("linked-safe/visible.txt");
});

test("PiModelClient seeder tools allow filenames that begin with dot-dot", async () => {
	const cwd = await tempDir("pi-suggester-dotdot-name");
	await writeFile(join(cwd, "..plan.md"), "# Plan\n", "utf8");
	await writeFile(join(cwd, "visible.txt"), "visible\n", "utf8");

	const preview = await runSeederToolPreview(cwd, "read", {
		path: "..plan.md",
	});

	expect(preview).toContain("1: # Plan");
});

test("PiModelClient normalizes malformed provider usage values", async (t) => {
	const provider = registerTestProvider({
		content: [{ type: "text", text: "ok" }],
		usage: {
			input: Number.NaN,
			output: Number.POSITIVE_INFINITY,
			cacheRead: -1,
			cacheWrite: 5,
			totalTokens: Number.NEGATIVE_INFINITY,
			cost: { total: -0.01 },
		},
	});
	t.onTestFinished(() => provider.unregister());
	const client = new PiModelClient(createRuntimeWithModel(provider.model));

	const result = await client.generateSuggestion(createSuggestionContext());

	expect(result.usage).toEqual({
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 5,
		totalTokens: 0,
		costTotal: 0,
	});
});

test("PiModelClient read tool returns a bounded slice for large files", async () => {
	const cwd = await tempDir("pi-suggester-read");
	const largePath = join(cwd, "large.txt");
	const lines = Array.from({ length: 5000 }, (_, index) => `line-${index + 1}`);
	await writeFile(largePath, lines.join("\n"), "utf8");
	await writeFile(join(cwd, "visible.txt"), "visible\n", "utf8");

	const preview = await runSeederToolPreview(cwd, "read", {
		path: "large.txt",
		offset: 2500,
		limit: 3,
	});

	expect(preview).toContain("2500: line-2500");
	expect(preview).toContain("2502: line-2502");
	expect(preview).not.toContain("2499: line-2499");
	expect(preview).not.toContain("2503: line-2503");
});

test("PiModelClient read tool refuses files over the byte cap", async () => {
	const cwd = await tempDir("pi-suggester-read-cap");
	await writeFile(join(cwd, "huge.txt"), "x".repeat(300 * 1024), "utf8");
	await writeFile(join(cwd, "visible.txt"), "visible\n", "utf8");

	const preview = await runSeederToolPreview(cwd, "read", {
		path: "huge.txt",
	});

	expect(preview).toContain("[read truncated: file is");
	expect(preview).toContain("max 262144 bytes");
});

test("PiModelClient read tool truncates overlong lines", async () => {
	const cwd = await tempDir("pi-suggester-read-line-cap");
	await writeFile(join(cwd, "single-line.txt"), "x".repeat(3000), "utf8");
	await writeFile(join(cwd, "visible.txt"), "visible\n", "utf8");

	const preview = await runSeederToolPreview(cwd, "read", {
		path: "single-line.txt",
	});

	expect(preview).toContain("[line truncated at 2000 chars]");
});

test("PiModelClient find tool returns diagnostics when traversal hits depth cap", async () => {
	const cwd = await tempDir("pi-suggester-find-cap");
	let current = cwd;
	for (let index = 0; index < 14; index += 1) {
		current = join(current, `level-${index}`);
		await mkdir(current);
	}
	await writeFile(join(current, "target.txt"), "deep\n", "utf8");
	await writeFile(join(cwd, "visible.txt"), "visible\n", "utf8");

	const preview = await runSeederToolPreview(cwd, "find", {
		path: ".",
		pattern: "target.txt",
	});

	expect(preview).toContain("[find truncated: depth cap 12 reached");
});
