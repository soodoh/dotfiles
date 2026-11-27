import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	type ExtensionAPI,
	type ExtensionContext,
	readStoredCredential,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

vi.mock("@earendil-works/pi-coding-agent", async (original) => ({
	...(await original<typeof import("@earendil-works/pi-coding-agent")>()),
	readStoredCredential: vi.fn(),
}));

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	FAST_CHANGED_EVENT,
	FAST_READER_EVENT,
	type SpeedMode,
	type SpeedReader,
} from "../cliproxyapi";
import statusline from "./index";
import { createGitStatusStore, type GitStatusStore } from "./src/git-status";
import {
	createProviderUsageStore,
	type ModelLike,
	type ModelRegistryLike,
	type ProviderUsageStore,
	type ProviderUsageTarget,
} from "./src/provider-usage";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];
const disposers: (() => void)[] = [];
type Settings = ReturnType<ExtensionAPI["getSettings"]> & {
	statusline?: { sections: unknown };
};
type Event = { toolName?: string; level?: "off" | "high" | "xhigh" };
type Handler = (event: Event, ctx: ExtensionContext) => unknown;
type Context = {
	hasUI: boolean;
	mode?: string;
	ui: Pick<ExtensionContext["ui"], "setFooter">;
	model?: ModelLike;
	modelRegistry?: ModelRegistryLike;
	sessionManager?: { getBranch?(): unknown[]; getCwd?(): string };
	getContextUsage?: ExtensionContext["getContextUsage"];
	readStoredCredential?: typeof readStoredCredential;
	settings?: Settings;
};
type FooterFactory = Exclude<
	Parameters<Context["ui"]["setFooter"]>[0],
	undefined
>;
type Footer = ReturnType<FooterFactory>;

async function tempDir(name: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), `${name}-`));
	tempDirs.push(dir);
	return dir;
}

function createPi(
	thinkingLevel: "off" | "high" = "off",
	effectiveSettings: Settings = {},
) {
	const handlers = new Map<string, Handler>();
	const listeners = new Map<string, (data: unknown) => void>();
	return {
		handlers,
		events: {
			on(name: string, handler: (data: unknown) => void) {
				listeners.set(name, handler);
				return () => listeners.delete(name);
			},
			emit(name: string, data: unknown) {
				listeners.get(name)?.(data);
			},
		},
		getSettings: vi.fn(() => effectiveSettings),
		getThinkingLevel: vi.fn(() => thinkingLevel),
		registerTool: vi.fn(),
		on(eventName: string, handler: Handler) {
			handlers.set(eventName, handler);
		},
	};
}

function fakeGitStatusStore(
	getStatusImpl: GitStatusStore["getStatus"] = () => ({
		branch: "main",
		staged: 0,
		unstaged: 0,
		untracked: 0,
	}),
): GitStatusStore & {
	getStatus: ReturnType<typeof vi.fn<GitStatusStore["getStatus"]>>;
	invalidate: ReturnType<typeof vi.fn<GitStatusStore["invalidate"]>>;
} {
	return {
		getStatus: vi.fn<GitStatusStore["getStatus"]>(getStatusImpl),
		invalidate: vi.fn<GitStatusStore["invalidate"]>(),
	};
}

function harness(
	overrides: Partial<Context> & {
		usageStore?: ProviderUsageStore;
		gitStatusStore?: GitStatusStore;
	} = {},
	thinking: "off" | "high" = "off",
) {
	let footer: Footer | undefined;
	let branchChange: (() => void) | undefined;
	const statuses = new Map<string, string>();
	const unsubscribe = vi.fn();
	const requestRender = vi.fn();
	const theme = { fg: (_color: string, text: string) => text };
	const pi = createPi(
		thinking,
		overrides.settings ?? {
			statusline: { sections: ["model", "thinking", "context"] },
			compaction: { enabled: true },
		},
	);
	vi.mocked(readStoredCredential).mockImplementation(
		overrides.readStoredCredential ?? (() => undefined),
	);
	const usageStore = overrides.usageStore ?? createProviderUsageStore();
	const gitStatusStore = overrides.gitStatusStore ?? createGitStatusStore();
	statusline(pi as unknown as ExtensionAPI, { usageStore, gitStatusStore });
	const data = {
		getGitBranch: () => "main",
		getAvailableProviderCount: () => 0,
		getExtensionStatuses: () => statuses,
		onBranchChange(cb: () => void) {
			branchChange = cb;
			return unsubscribe;
		},
	};
	const setWidget = vi.fn();
	const setFooter = vi.fn((factory: FooterFactory | undefined) => {
		footer?.dispose?.();
		footer = factory?.(
			{ requestRender } as unknown as Parameters<FooterFactory>[0],
			theme as Parameters<FooterFactory>[1],
			data,
		);
		if (footer?.dispose) disposers.push(footer.dispose);
	});
	const ui = { setFooter, setWidget };
	const ctx: Context = {
		hasUI: true,
		mode: "tui",
		ui,
		model: {
			name: "Claude Sonnet Test",
			id: "sonnet-test",
			provider: "test-provider",
			contextWindow: 1000,
		},
		modelRegistry: {
			getAvailable: () => [],
			getApiKeyForProvider: async () => undefined,
		},
		readStoredCredential: () => undefined,
		sessionManager: { getBranch: () => [] },
		getContextUsage: () => ({ tokens: 250, contextWindow: 1000, percent: 25 }),
		...overrides,
	};
	function emit(name: string, event: Event = {}, context = ctx) {
		return pi.handlers.get(name)?.(
			event,
			context as unknown as ExtensionContext,
		);
	}
	emit("session_start");
	return {
		pi,
		ctx,
		usageStore,
		emit,
		setFooter,
		setWidget,
		requestRender,
		theme,
		statuses,
		unsubscribe,
		branchChange: () => branchChange?.(),
		footer: () => {
			if (!footer) throw new Error("expected statusline footer");
			return footer;
		},
		render: (width = 120) => footer?.render(width).join("\n") ?? "",
	};
}

function settings(sections: unknown): Settings {
	return { compaction: { enabled: true }, statusline: { sections } };
}

beforeEach(async () => {
	vi.stubEnv("CLIPROXYAPI_MANAGEMENT_KEY", undefined);
	const cacheDir = await tempDir("pi-statusline-provider-cache");
	vi.stubEnv(
		"PI_PROVIDER_USAGE_CACHE_PATH",
		join(cacheDir, "provider-usage.json"),
	);
});

afterEach(async () => {
	for (const dispose of disposers.splice(0)) dispose();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

describe("statusline extension", () => {
	test("does not call runtime action methods while loading", () => {
		const pi = createPi("high");
		statusline(pi as unknown as ExtensionAPI);
		expect(pi.getThinkingLevel).not.toHaveBeenCalled();
	});

	test("renders directly in the footer without registering a widget", () => {
		const h = harness();
		expect(h.setFooter).toHaveBeenCalledOnce();
		expect(h.setWidget).not.toHaveBeenCalled();
		expect(h.render()).toContain("Sonnet Test");
		expect(h.render()).toContain("off");
		expect(h.render()).toContain("25.0%/1.0k");
		expect(h.render().indexOf("Sonnet Test")).toBeLessThan(
			h.render().indexOf("off"),
		);
	});

	test("preserves sorted, sanitized, width-bounded extension status text", () => {
		const h = harness();
		h.statuses.set("z", "later\nstatus\ttext");
		h.statuses.set("a", "first status");
		const lines = h.footer().render(120);
		expect(lines.at(-1)).toBe("first status later status text");
		expect(
			h
				.footer()
				.render(15)
				.every((line) => visibleWidth(line) <= 15),
		).toBe(true);
		h.statuses.clear();
		expect(h.render()).not.toContain("first status");
	});

	test("renders unknown context after compaction instead of old assistant usage", () => {
		const getBranch = vi.fn(() => [
			{
				type: "message",
				message: {
					role: "assistant",
					usage: { input: 900, output: 50, cacheRead: 0, cacheWrite: 0 },
				},
			},
		]);
		const h = harness({ sessionManager: { getBranch } });
		h.ctx.getContextUsage = () => ({
			tokens: null,
			contextWindow: 1000,
			percent: null,
		});
		h.emit("session_compact");
		expect(h.render()).toContain("?/1.0k");
		expect(h.render()).not.toContain("95.0%");
		expect(getBranch).not.toHaveBeenCalled();
		h.ctx.getContextUsage = () => ({
			tokens: 100,
			contextWindow: 1000,
			percent: 10,
		});
		h.emit("message_end");
		expect(h.render()).toContain("10.0%/1.0k");
	});

	test("reads context usage once per render and respects Pi's effective context window", () => {
		const getContextUsage = vi.fn(() => ({
			tokens: 100,
			contextWindow: 2000,
			percent: 5,
		}));
		const h = harness({
			getContextUsage,
			settings: settings(["context"]),
		});
		expect(h.render()).toContain("5.0%/2.0k");
		expect(getContextUsage).toHaveBeenCalledOnce();
		getContextUsage.mockClear();
		h.render(5);
		expect(getContextUsage).toHaveBeenCalledOnce();
		h.ctx.getContextUsage = () => undefined;
		expect(h.render()).toContain("?/1.0k");
	});

	test("renders and immediately updates thinking colors", () => {
		const h = harness({}, "high");
		h.theme.fg = (color, text) => `<${color}>${text}</${color}>`;
		expect(h.render()).toContain("<thinkingHigh>\uF0EB high</thinkingHigh>");
		h.emit("thinking_level_select", { level: "xhigh" });
		expect(h.requestRender).toHaveBeenCalled();
		expect(h.render()).toContain("<thinkingXhigh>\uF0EB xhigh</thinkingXhigh>");
	});

	test("shows one or two bolts for the selected model’s live speed, not the stored preference", async () => {
		const agentDir = await tempDir("pi-statusline-cliproxy");
		vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
		await writeFile(join(agentDir, "cliproxyapi.json"), '{"fast":false}');
		const model = { name: "gpt-fast", id: "gpt-fast", provider: "cliproxyapi" };
		const h = harness({ model });
		const bolts = () => h.render().match(/\uF0E7+/g);
		let speed: SpeedMode | undefined;
		const readSpeed: SpeedReader = (provider, id) =>
			provider === model.provider && id === model.id ? speed : undefined;
		h.pi.events.emit(FAST_READER_EVENT, readSpeed);
		expect(bolts()).toBeNull();

		speed = "fast";
		h.pi.events.emit(FAST_CHANGED_EVENT, undefined);
		expect(bolts()).toEqual(["\uF0E7"]);
		h.requestRender.mockClear();
		speed = "ultrafast";
		h.pi.events.emit(FAST_CHANGED_EVENT, undefined);
		expect(h.requestRender).toHaveBeenCalledOnce();
		expect(bolts()).toEqual(["\uF0E7\uF0E7"]);

		h.ctx.model = { ...model, id: "gpt-standard" };
		h.emit("model_select");
		expect(bolts()).toBeNull();
		h.ctx.model = model;
		h.emit("model_select");
		expect(bolts()).toEqual(["\uF0E7\uF0E7"]);

		speed = undefined;
		h.pi.events.emit(FAST_CHANGED_EVENT, undefined);
		expect(bolts()).toBeNull();
	});

	test("reads native effective compaction settings without a context settings manager", () => {
		const h = harness({
			settings: {
				statusline: { sections: ["context"] },
				compaction: { enabled: false },
			},
		});
		expect(h.render()).toContain("25.0%/1.0k");
		expect(h.render()).not.toContain("Sonnet Test");
		expect(h.render()).not.toContain("\u{F0068}");
		h.pi.getSettings.mockReturnValue({ compaction: { enabled: true } });
		expect(h.render()).toContain("\u{F0068}");
	});

	test("preserves configured section order and nested rows", () => {
		const h = harness({
			settings: settings([["context"], ["model", "thinking"]]),
		});
		const lines = h.footer().render(120);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("25.0%/1.0k");
		expect(lines[0]).not.toContain("Sonnet Test");
		expect(lines[1]).toContain("Sonnet Test");
		expect(lines[1]).toContain("off");
	});

	test("invalid effective sections fall back to defaults", () => {
		const h = harness({
			gitStatusStore: fakeGitStatusStore(),
			settings: {
				...settings(["unknown"]),
			},
		});
		expect(h.render()).toContain("Sonnet Test");
		expect(h.render()).toContain("main");
		expect(h.render()).toContain("25.0%/1.0k");
	});

	test("wraps overflow within viewport width without dropping sections", () => {
		const h = harness({
			gitStatusStore: fakeGitStatusStore(() => ({
				branch: "paul/autobranding",
				staged: 0,
				unstaged: 0,
				untracked: 0,
			})),
			model: { name: "GPT-5.5", contextWindow: 272000 },
			settings: settings(["model", "git", "context"]),
			getContextUsage: () => ({
				tokens: 21488,
				contextWindow: 272000,
				percent: 7.9,
			}),
		});
		const lines = h.footer().render(43);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.every((line) => visibleWidth(line) <= 43)).toBe(true);
		expect(lines.join("\n")).toContain("GPT-5.5");
		expect(lines.join("\n")).toContain("paul/autobranding");
		expect(lines.join("\n")).toContain("7.9%/272k");
		expect(h.footer().render(0)).toEqual([]);
	});

	test("handles async model discovery and puts provider usage on the default second row", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({ five_hour: { used_percent: 10 } }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const h = harness({
			gitStatusStore: fakeGitStatusStore(),
			settings: { compaction: { enabled: true } },
			model: {
				name: "Claude Sonnet Test",
				id: "sonnet-test",
				provider: "anthropic",
				contextWindow: 1000,
			},
			modelRegistry: {
				getAvailable: async () => [{ provider: "anthropic" }],
				getApiKeyForProvider: async () => "active-anthropic-token",
				isUsingOAuth: () => true,
			},
			readStoredCredential: (provider) =>
				provider === "anthropic"
					? {
							type: "oauth",
							access: "active-anthropic-token",
							refresh: "active-anthropic-refresh",
							expires: Date.now() + 60_000,
						}
					: undefined,
		});
		await vi.waitFor(() => expect(h.render()).toContain("Anthropic 10%"));
		const lines = h.footer().render(120);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("Sonnet Test");
		expect(lines[1]).toContain(
			"\u001b[38;2;215;135;175mAnthropic 10%\u001b[0m",
		);
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	test("uses stored GitHub Copilot refresh credential for OAuth usage", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({
				quotaSnapshots: { premiumInteractions: { percent_used: 42 } },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const h = harness({
			settings: settings(["provider_usage"]),
			model: { id: "copilot", provider: "github-copilot" },
			modelRegistry: {
				getAvailable: () => [],
				getApiKeyForProvider: async () => "provider-token",
				isUsingOAuth: () => true,
			},
			readStoredCredential: (provider) =>
				provider === "github-copilot"
					? {
							type: "oauth",
							access: "stored-access-token",
							refresh: "stored-refresh-token",
							expires: Date.now() + 60_000,
						}
					: undefined,
		});
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(fetchMock.mock.calls[0]).toBeDefined();
		const init = (
			fetchMock.mock.calls as unknown as [unknown, RequestInit][]
		)[0][1];
		expect(init.headers).toMatchObject({
			Authorization: "token stored-refresh-token",
		});
		expect(h.render()).toBeDefined();
	});

	test("render and invalidation perform no git, provider discovery, or auth work", async () => {
		const gitStatusStore = fakeGitStatusStore();
		const getGitStatus = gitStatusStore.getStatus;
		const usageStore = createProviderUsageStore();
		const discovery = vi.spyOn(usageStore, "discoverTargetsAsync");
		const refresh = vi.spyOn(usageStore, "refresh");
		const getAvailable = vi.fn(async () => []);
		const getApiKeyForProvider = vi.fn(async () => undefined);
		const h = harness({
			usageStore,
			gitStatusStore,
			settings: settings(["model", "git", "provider_usage"]),
			modelRegistry: { getAvailable, getApiKeyForProvider },
		});
		await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
		for (const spy of [
			getGitStatus,
			discovery,
			refresh,
			getAvailable,
			getApiKeyForProvider,
		])
			spy.mockClear();
		h.requestRender.mockClear();
		for (let i = 0; i < 30; i++) h.render(40 + i);
		h.footer().invalidate?.();
		for (const spy of [
			getGitStatus,
			discovery,
			refresh,
			getAvailable,
			getApiKeyForProvider,
			h.requestRender,
		])
			expect(spy).not.toHaveBeenCalled();
	});

	test("skips provider auth/network work when provider_usage is omitted", async () => {
		const getAvailable = vi.fn(async () => []);
		const getApiKeyForProvider = vi.fn(async () => undefined);
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const h = harness({
			model: { id: "copilot", provider: "github-copilot" },
			modelRegistry: { getAvailable, getApiKeyForProvider },
		});
		h.render();
		h.emit("agent_end");
		h.emit("after_provider_response");
		await Promise.resolve();
		for (const spy of [getAvailable, getApiKeyForProvider, fetchMock])
			expect(spy).not.toHaveBeenCalled();
	});

	test("does not install UI or start refreshes outside TUI mode", () => {
		const usageStore = createProviderUsageStore();
		const discovery = vi.spyOn(usageStore, "discoverTargetsAsync");
		const gitStatusStore = fakeGitStatusStore();
		const git = gitStatusStore.getStatus;
		for (const mode of ["rpc", "print", "json"]) {
			const h = harness({
				usageStore,
				gitStatusStore,
				mode,
				hasUI: mode === "rpc",
				settings: settings(["git", "provider_usage"]),
			});
			h.emit("agent_end");
			h.emit("model_select");
			expect(h.setFooter).not.toHaveBeenCalled();
		}
		expect(discovery).not.toHaveBeenCalled();
		expect(git).not.toHaveBeenCalled();
	});

	test("polls only configured sources, refreshes on tool/branch changes, and disposes idempotently", async () => {
		vi.useFakeTimers();
		const gitStatusStore = fakeGitStatusStore();
		const git = gitStatusStore.getStatus;
		const usageStore = createProviderUsageStore();
		const discovery = vi
			.spyOn(usageStore, "discoverTargetsAsync")
			.mockResolvedValue([]);
		vi.spyOn(usageStore, "refresh").mockResolvedValue();
		const h = harness({
			usageStore,
			gitStatusStore,
			settings: settings(["git", "provider_usage"]),
		});
		await vi.advanceTimersByTimeAsync(60_000);
		expect(discovery).toHaveBeenCalledTimes(2);
		expect(git.mock.calls.length).toBeLessThanOrEqual(13);
		for (const toolName of ["bash", "write", "edit"]) {
			git.mockClear();
			h.emit("tool_result", { toolName });
			expect(git).toHaveBeenCalledOnce();
		}
		git.mockClear();
		h.branchChange();
		expect(git).toHaveBeenCalledOnce();
		h.footer().dispose?.();
		h.footer().dispose?.();
		expect(h.unsubscribe).toHaveBeenCalledOnce();
		git.mockClear();
		discovery.mockClear();
		h.requestRender.mockClear();
		await vi.advanceTimersByTimeAsync(120_000);
		h.branchChange();
		h.emit("agent_end");
		expect(git).not.toHaveBeenCalled();
		expect(discovery).not.toHaveBeenCalled();
		expect(h.requestRender).not.toHaveBeenCalled();
		expect(h.render()).toBe("");
	});

	test("discovers newly authenticated providers while idle without doing discovery in render", async () => {
		vi.useFakeTimers();
		let authenticated = false;
		const fetchMock = vi.fn(async () =>
			Response.json({ five_hour: { used_percent: 12 } }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const h = harness({
			settings: settings(["provider_usage"]),
			modelRegistry: {
				getAvailable: async () =>
					authenticated ? [{ provider: "anthropic" }] : [],
				getApiKeyForProvider: async () =>
					authenticated ? "new-token" : undefined,
				isUsingOAuth: () => true,
			},
			readStoredCredential: (provider) =>
				authenticated && provider === "anthropic"
					? {
							type: "oauth",
							access: "new-token",
							refresh: "refresh",
							expires: Date.now() + 120_000,
						}
					: undefined,
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock).not.toHaveBeenCalled();
		authenticated = true;
		h.render();
		expect(fetchMock).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(60_000);
		// Cache I/O uses real filesystem promises, not fake timers.
		vi.useRealTimers();
		await vi.waitFor(() => expect(h.render()).toContain("Anthropic 12%"));
		expect(fetchMock).toHaveBeenCalledOnce();
	});

	test("preserves OpenAI proxy grouping across periodic rediscovery before refresh resolves", async () => {
		const proxyDir = await tempDir("pi-statusline-proxy-cache");
		const proxyCachePath = join(proxyDir, "cliproxy-usage.json");
		const baseUrl = "https://proxy.example.test";
		const managementKey = "test-management-key";
		const source = createHash("sha256")
			.update(`${baseUrl}\0${managementKey}`)
			.digest("hex");
		const identity = createHash("sha256").update("acct-a").digest("hex");
		const registration = "oaiapp_periodic-rediscovery";
		await writeFile(
			proxyCachePath,
			JSON.stringify({
				source,
				fetchedAt: Date.now(),
				accounts: [
					{
						provider: "codex",
						identity,
						scope: { weeklyPercentUsed: 47 },
						observedAt: Date.now(),
					},
				],
				openaiRegistrations: {
					[createHash("sha256").update(registration).digest("hex")]: identity,
				},
			}),
		);
		vi.stubEnv("CLIPROXYAPI_BASE_URL", baseUrl);
		vi.stubEnv("CLIPROXYAPI_MANAGEMENT_KEY", managementKey);
		vi.stubEnv("PI_CLIPROXY_USAGE_CACHE_PATH", proxyCachePath);
		vi.useFakeTimers();

		let authCalls = 0;
		let resolveSecondAuth:
			| ((value: { auth: { apiKey: string } }) => void)
			| undefined;
		const h = harness({
			settings: settings(["provider_usage"]),
			model: { provider: "openai" },
			modelRegistry: {
				getAvailable: async () => [{ provider: "openai" }],
				getProviderAuthStatus: (provider) => ({
					configured: provider === "openai",
					source: "OAuth",
				}),
				getProviderAuth: () => {
					authCalls++;
					if (authCalls === 1) {
						return Promise.resolve({ auth: { apiKey: "native-token" } });
					}
					return new Promise((resolve) => {
						resolveSecondAuth = resolve;
					});
				},
				isUsingOAuth: () => true,
			},
			readStoredCredential: (provider) =>
				provider === "openai"
					? {
							type: "oauth",
							access: "native-token",
							refresh: "refresh-token",
							expires: Date.now() + 120_000,
							clientId: registration,
							scopes: ["chatgpt.tokens.use.direct"],
						}
					: undefined,
		});
		const stripAnsi = (value: string) =>
			value.replaceAll(
				new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"),
				"",
			);
		await vi.advanceTimersByTimeAsync(0);
		expect(stripAnsi(h.render())).toContain("\u{F0004} \uF120 47%");

		await vi.advanceTimersByTimeAsync(60_000);
		// Rediscovery must keep the grouped badge while the follow-up auth verification is still pending.
		expect(authCalls).toBe(2);
		expect(stripAnsi(h.render())).toContain("\u{F0004} \uF120 47%");
		expect(stripAnsi(h.render())).not.toContain("?");
		resolveSecondAuth?.({ auth: { apiKey: "native-token" } });
		await vi.advanceTimersByTimeAsync(0);
	});

	test("ignores late git callbacks after footer disposal", () => {
		let update: (() => void) | undefined;
		const gitStatusStore = fakeGitStatusStore((_cwd, _branch, onUpdate) => {
			update = onUpdate;
			return { branch: "main", staged: 0, unstaged: 0, untracked: 0 };
		});
		const git = gitStatusStore.getStatus;
		const h = harness({ gitStatusStore, settings: settings(["git"]) });
		h.footer().dispose?.();
		git.mockClear();
		h.requestRender.mockClear();
		update?.();
		expect(git).not.toHaveBeenCalled();
		expect(h.requestRender).not.toHaveBeenCalled();
	});

	test("ignores obsolete async discovery after model selection and shutdown", async () => {
		const usageStore = createProviderUsageStore();
		const pending: ((targets: ProviderUsageTarget[]) => void)[] = [];
		vi.spyOn(usageStore, "discoverTargetsAsync").mockImplementation(
			() => new Promise((resolve) => pending.push(resolve)),
		);
		const refresh = vi.spyOn(usageStore, "refresh").mockResolvedValue();
		const h = harness({
			usageStore,
			settings: settings(["provider_usage"]),
		});
		h.emit("model_select");
		pending[0]([]);
		await Promise.resolve();
		expect(refresh).not.toHaveBeenCalled();
		h.emit("session_shutdown", {}, { ...h.ctx });
		h.requestRender.mockClear();
		pending[1]([]);
		await Promise.resolve();
		expect(refresh).not.toHaveBeenCalled();
		expect(h.requestRender).not.toHaveBeenCalled();
		expect(h.unsubscribe).toHaveBeenCalledOnce();
	});

	test("scopes git status by session cwd and replaces the old footer on session start", async () => {
		const repoOne = await tempDir("pi-statusline-repo-one");
		const repoTwo = await tempDir("pi-statusline-repo-two");
		for (const repo of [repoOne, repoTwo]) {
			await execFileAsync("git", ["init"], { cwd: repo });
			await execFileAsync("git", ["config", "user.email", "test@example.com"], {
				cwd: repo,
			});
			await execFileAsync("git", ["config", "user.name", "Test User"], {
				cwd: repo,
			});
			await writeFile(join(repo, "tracked.txt"), "initial\n");
			await execFileAsync("git", ["add", "tracked.txt"], { cwd: repo });
			await execFileAsync("git", ["commit", "-m", "initial"], { cwd: repo });
		}
		await writeFile(join(repoOne, "tracked.txt"), "modified\n");
		const h = harness({
			settings: settings(["model", "git"]),
			sessionManager: { getCwd: () => repoOne },
		});
		await vi.waitFor(() => expect(h.render()).toContain("*1"));
		const oldFooter = h.footer();
		h.emit(
			"session_start",
			{},
			{ ...h.ctx, sessionManager: { getCwd: () => repoTwo } },
		);
		await vi.waitFor(() => expect(h.render()).not.toMatch(/[+*]1/));
		expect(oldFooter.render(120)).toEqual([]);
		expect(h.setFooter).toHaveBeenCalledTimes(2);
	});
});
