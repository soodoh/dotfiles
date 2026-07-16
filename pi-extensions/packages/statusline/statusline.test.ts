import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import statusline from "./index";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function tempDir(name: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), `${name}-`));
	tempDirs.push(dir);
	return dir;
}

type Handler = (event: Record<string, unknown>, ctx: StatuslineContext) => void;
type Widget = {
	render(width: number): string[];
	dispose?(): void;
	invalidate?(): void;
};
type WidgetFactory = (
	tui: { requestRender?: () => void },
	theme: { fg(color: string, text: string): string },
) => Widget;
type FooterFactory = (
	tui: { requestRender?: () => void },
	theme: { fg(color: string, text: string): string },
	footerData: {
		getGitBranch(): string | null;
		onBranchChange(cb: () => void): () => void;
	},
) => Widget;
type StatuslineContext = {
	hasUI: boolean;
	ui: {
		setFooter(factory: FooterFactory | undefined): void;
		setWidget(key: string, factory: WidgetFactory | undefined): void;
	};
	model?: {
		name?: string;
		id?: string;
		provider?: string;
		contextWindow?: number;
	};
	modelRegistry?: {
		getAvailable():
			| Array<{ provider?: string }>
			| Promise<Array<{ provider?: string }>>;
		getApiKeyForProvider(provider: string): Promise<string | undefined>;
		isUsingOAuth?(model: { provider?: string }): boolean;
		authStorage?: {
			get(
				provider: string,
			): { type: "oauth"; access?: string; refresh?: string } | undefined;
		};
	};
	sessionManager: { getBranch(): unknown[]; getCwd?(): string };
	settingsManager: {
		getCompactionSettings(): { enabled: boolean };
		getGlobalSettings?(): Record<string, unknown>;
		getProjectSettings?(): Record<string, unknown>;
	};
	getContextUsage(): { tokens: number; contextWindow: number; percent: number };
};

function createPi() {
	const handlers = new Map<string, Handler>();
	return {
		handlers,
		on(eventName: string, handler: Handler) {
			handlers.set(eventName, handler);
		},
	};
}

beforeEach(async () => {
	const cacheDir = await tempDir("pi-statusline-provider-cache");
	vi.stubEnv(
		"PI_PROVIDER_USAGE_CACHE_PATH",
		join(cacheDir, "provider-usage.json"),
	);
	const claudeConfigDir = await tempDir("pi-statusline-claude-config");
	await writeFile(join(claudeConfigDir, "settings.json"), "{}");
	vi.stubEnv("CLAUDE_CONFIG_DIR", claudeConfigDir);
});

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	await Promise.all(
		tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

describe("statusline extension", () => {
	test("registers a below-editor widget and renders model/context smoke output", () => {
		let widgetFactory: WidgetFactory | undefined;
		let footerFactory: FooterFactory | undefined;
		const pi = createPi();
		statusline(pi);
		const ctx: StatuslineContext = {
			hasUI: true,
			ui: {
				setFooter(factory) {
					footerFactory = factory;
				},
				setWidget(key, factory) {
					expect(key).toBe("pi-statusline");
					widgetFactory = factory;
				},
			},
			model: {
				name: "Claude Sonnet Test",
				id: "sonnet-test",
				provider: "test-provider",
				contextWindow: 1000,
			},
			modelRegistry: {
				getAvailable() {
					return [];
				},
				async getApiKeyForProvider() {
					return undefined;
				},
			},
			sessionManager: { getBranch: () => [] },
			settingsManager: { getCompactionSettings: () => ({ enabled: true }) },
			getContextUsage: () => ({
				tokens: 250,
				contextWindow: 1000,
				percent: 25,
			}),
		};

		pi.handlers.get("session_start")?.({}, ctx);
		expect(footerFactory).toBeDefined();
		expect(widgetFactory).toBeDefined();

		footerFactory?.(
			{},
			{ fg: (_color, text) => text },
			{ getGitBranch: () => "main", onBranchChange: () => () => undefined },
		);
		const widget = widgetFactory?.({}, { fg: (_color, text) => text });
		const line = widget?.render(120).join("\n") ?? "";

		expect(line).toContain("Sonnet Test");
		expect(line).toContain("25.0%/1.0k");
	});

	test("renders configured sections in configured order", () => {
		let widgetFactory: WidgetFactory | undefined;
		let footerFactory: FooterFactory | undefined;
		const pi = createPi();
		statusline(pi);
		const ctx: StatuslineContext = {
			hasUI: true,
			ui: {
				setFooter(factory) {
					footerFactory = factory;
				},
				setWidget(_key, factory) {
					widgetFactory = factory;
				},
			},
			model: { name: "Test Model", contextWindow: 1000 },
			modelRegistry: {
				getAvailable() {
					return [];
				},
				async getApiKeyForProvider() {
					return undefined;
				},
			},
			sessionManager: { getBranch: () => [] },
			settingsManager: {
				getCompactionSettings: () => ({ enabled: true }),
				getGlobalSettings: () => ({
					statusline: { sections: ["context", "model"] },
				}),
			},
			getContextUsage: () => ({
				tokens: 125,
				contextWindow: 1000,
				percent: 12.5,
			}),
		};

		pi.handlers.get("session_start")?.({}, ctx);
		footerFactory?.(
			{},
			{ fg: (_color, text) => text },
			{ getGitBranch: () => "main", onBranchChange: () => () => undefined },
		);
		const line =
			widgetFactory?.({}, { fg: (_color, text) => text })
				.render(120)
				.join("\n") ?? "";

		expect(line).toContain("12.5%/1.0k");
		expect(line).toContain("Test Model");
		expect(line).not.toContain("main");
		expect(line.indexOf("12.5%/1.0k")).toBeLessThan(line.indexOf("Test Model"));
	});

	test("renders default relative section order when provider_usage is omitted", () => {
		let widgetFactory: WidgetFactory | undefined;
		let footerFactory: FooterFactory | undefined;
		const pi = createPi();
		statusline(pi);
		const ctx: StatuslineContext = {
			hasUI: true,
			ui: {
				setFooter(factory) {
					footerFactory = factory;
				},
				setWidget(_key, factory) {
					widgetFactory = factory;
				},
			},
			model: { name: "Test Model", contextWindow: 1000 },
			modelRegistry: {
				getAvailable() {
					return [];
				},
				async getApiKeyForProvider() {
					return undefined;
				},
			},
			sessionManager: { getBranch: () => [] },
			settingsManager: {
				getCompactionSettings: () => ({ enabled: true }),
				getGlobalSettings: () => ({
					statusline: { sections: ["model", "git", "context"] },
				}),
			},
			getContextUsage: () => ({
				tokens: 125,
				contextWindow: 1000,
				percent: 12.5,
			}),
		};

		pi.handlers.get("session_start")?.({}, ctx);
		footerFactory?.(
			{},
			{ fg: (_color, text) => text },
			{ getGitBranch: () => "main", onBranchChange: () => () => undefined },
		);
		const line =
			widgetFactory?.({}, { fg: (_color, text) => text })
				.render(120)
				.join("\n") ?? "";

		expect(line).toContain("Test Model");
		expect(line).toContain("main");
		expect(line).toContain("12.5%/1.0k");
		expect(line.indexOf("Test Model")).toBeLessThan(line.indexOf("main"));
		expect(line.indexOf("main")).toBeLessThan(line.indexOf("12.5%/1.0k"));
	});

	test("truncates statusline fallback to the viewport width", () => {
		vi.stubEnv("POWERLINE_NERD_FONTS", "1");

		let widgetFactory: WidgetFactory | undefined;
		let footerFactory: FooterFactory | undefined;
		const pi = createPi();
		statusline(pi);
		const ctx: StatuslineContext = {
			hasUI: true,
			ui: {
				setFooter(factory) {
					footerFactory = factory;
				},
				setWidget(_key, factory) {
					widgetFactory = factory;
				},
			},
			model: { name: "GPT-5.5", contextWindow: 272000 },
			modelRegistry: {
				getAvailable() {
					return [];
				},
				async getApiKeyForProvider() {
					return undefined;
				},
			},
			sessionManager: { getBranch: () => [] },
			settingsManager: {
				getCompactionSettings: () => ({ enabled: true }),
				getGlobalSettings: () => ({
					statusline: { sections: ["model", "git", "context"] },
				}),
			},
			getContextUsage: () => ({
				tokens: 21488,
				contextWindow: 272000,
				percent: 7.9,
			}),
		};

		pi.handlers.get("session_start")?.({}, ctx);
		footerFactory?.(
			{},
			{ fg: (_color, text) => text },
			{
				getGitBranch: () => "paul/autobranding",
				onBranchChange: () => () => undefined,
			},
		);
		const lines =
			widgetFactory?.({}, { fg: (_color, text) => text }).render(43) ?? [];

		expect(lines.length).toBeGreaterThan(0);
		expect(lines.every((line) => visibleWidth(line) <= 43)).toBe(true);
	});

	test("invalid project sections override global sections and fall back to defaults", () => {
		let widgetFactory: WidgetFactory | undefined;
		const pi = createPi();
		statusline(pi);
		const ctx: StatuslineContext = {
			hasUI: true,
			ui: {
				setFooter() {},
				setWidget(_key, factory) {
					widgetFactory = factory;
				},
			},
			model: { name: "Test Model", contextWindow: 1000 },
			modelRegistry: {
				getAvailable() {
					return [];
				},
				async getApiKeyForProvider() {
					return undefined;
				},
			},
			sessionManager: { getBranch: () => [] },
			settingsManager: {
				getCompactionSettings: () => ({ enabled: true }),
				getGlobalSettings: () => ({
					statusline: { sections: ["context"] },
				}),
				getProjectSettings: () => ({
					statusline: { sections: ["unknown"] },
				}),
			},
			getContextUsage: () => ({
				tokens: 125,
				contextWindow: 1000,
				percent: 12.5,
			}),
		};

		pi.handlers.get("session_start")?.({}, ctx);
		const line =
			widgetFactory?.({}, { fg: (_color, text) => text })
				.render(120)
				.join("\n") ?? "";

		expect(line).toContain("Test Model");
		expect(line).toContain("12.5%/1.0k");
		expect(line.indexOf("Test Model")).toBeLessThan(line.indexOf("12.5%/1.0k"));
	});

	test("renders nested sections array as multiple lines", () => {
		let widgetFactory: WidgetFactory | undefined;
		let footerFactory: FooterFactory | undefined;
		const pi = createPi();
		statusline(pi);
		const ctx: StatuslineContext = {
			hasUI: true,
			ui: {
				setFooter(factory) {
					footerFactory = factory;
				},
				setWidget(_key, factory) {
					widgetFactory = factory;
				},
			},
			model: { name: "Test Model", contextWindow: 1000, provider: "anthropic" },
			modelRegistry: {
				getAvailable() {
					return [];
				},
				async getApiKeyForProvider() {
					return undefined;
				},
			},
			sessionManager: { getBranch: () => [] },
			settingsManager: {
				getCompactionSettings: () => ({ enabled: true }),
				getGlobalSettings: () => ({
					statusline: {
						sections: [["model", "git"], ["context"]],
					},
				}),
			},
			getContextUsage: () => ({
				tokens: 125,
				contextWindow: 1000,
				percent: 12.5,
			}),
		};

		pi.handlers.get("session_start")?.({}, ctx);
		footerFactory?.(
			{},
			{ fg: (_color, text) => text },
			{ getGitBranch: () => "main", onBranchChange: () => () => undefined },
		);
		const lines =
			widgetFactory?.({}, { fg: (_color, text) => text }).render(120) ?? [];

		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("Test Model");
		expect(lines[0]).toContain("main");
		expect(lines[0]).not.toContain("12.5%/1.0k");
		expect(lines[1]).toContain("12.5%/1.0k");
		expect(lines[1]).not.toContain("Test Model");
	});

	test("default layout renders two lines with provider_usage on second line", () => {
		let widgetFactory: WidgetFactory | undefined;
		let footerFactory: FooterFactory | undefined;
		const pi = createPi();
		statusline(pi);
		const ctx: StatuslineContext = {
			hasUI: true,
			ui: {
				setFooter(factory) {
					footerFactory = factory;
				},
				setWidget(_key, factory) {
					widgetFactory = factory;
				},
			},
			model: { name: "Test Model", contextWindow: 1000 },
			modelRegistry: {
				getAvailable() {
					return [];
				},
				async getApiKeyForProvider() {
					return undefined;
				},
			},
			sessionManager: { getBranch: () => [] },
			settingsManager: {
				getCompactionSettings: () => ({ enabled: true }),
			},
			getContextUsage: () => ({
				tokens: 500,
				contextWindow: 1000,
				percent: 50,
			}),
		};

		pi.handlers.get("session_start")?.({}, ctx);
		footerFactory?.(
			{},
			{ fg: (_color, text) => text },
			{ getGitBranch: () => "main", onBranchChange: () => () => undefined },
		);
		const lines =
			widgetFactory?.({}, { fg: (_color, text) => text }).render(120) ?? [];

		// Line 1 has model, git, context
		expect(lines[0]).toContain("Test Model");
		expect(lines[0]).toContain("main");
		expect(lines[0]).toContain("50.0%/1.0k");
		// Line 2 is provider_usage — no providers configured, so line is empty/omitted
		// With no provider data the second line renders nothing
		expect(lines.length).toBeLessThanOrEqual(2);
	});

	test("handles async modelRegistry.getAvailable without iterating promises", () => {
		let widgetFactory: WidgetFactory | undefined;
		const pi = createPi();
		statusline(pi);
		const ctx: StatuslineContext = {
			hasUI: true,
			ui: {
				setFooter() {},
				setWidget(_key, factory) {
					widgetFactory = factory;
				},
			},
			model: { id: "custom", provider: "custom-provider" },
			modelRegistry: {
				async getAvailable() {
					return [{ provider: "openrouter" }];
				},
				async getApiKeyForProvider() {
					return undefined;
				},
			},
			sessionManager: { getBranch: () => [] },
			settingsManager: { getCompactionSettings: () => ({ enabled: true }) },
			getContextUsage: () => ({ tokens: 0, contextWindow: 1000, percent: 0 }),
		};

		expect(() => pi.handlers.get("session_start")?.({}, ctx)).not.toThrow();
		expect(() =>
			widgetFactory?.({}, { fg: (_color, text) => text }).render(120),
		).not.toThrow();
	});

	test("skips provider usage network egress when provider_usage is not configured", async () => {
		const fetchMock = vi.fn(async () => Response.json({}));
		vi.stubGlobal("fetch", fetchMock);
		let widgetFactory: WidgetFactory | undefined;
		const pi = createPi();
		statusline(pi);
		const ctx: StatuslineContext = {
			hasUI: true,
			ui: {
				setFooter() {},
				setWidget(_key, factory) {
					widgetFactory = factory;
				},
			},
			model: { id: "copilot", provider: "github-copilot" },
			modelRegistry: {
				getAvailable() {
					return [];
				},
				async getApiKeyForProvider() {
					throw new Error("provider token should not be read");
				},
				isUsingOAuth() {
					return true;
				},
			},
			sessionManager: { getBranch: () => [] },
			settingsManager: {
				getCompactionSettings: () => ({ enabled: true }),
				getGlobalSettings: () => ({
					statusline: { sections: ["model", "context"] },
				}),
			},
			getContextUsage: () => ({ tokens: 0, contextWindow: 1000, percent: 0 }),
		};

		pi.handlers.get("session_start")?.({}, ctx);
		widgetFactory?.({}, { fg: (_color, text) => text }).render(120);
		pi.handlers.get("agent_end")?.({}, ctx);
		pi.handlers.get("after_provider_response")?.({}, ctx);

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("uses stored GitHub Copilot refresh credential for OAuth usage", async () => {
		const fetchCalls: RequestInit[] = [];
		const fetchMock = vi.fn(
			async (_url: string | URL | Request, init?: RequestInit) => {
				fetchCalls.push(init ?? {});
				return Response.json({
					quotaSnapshots: {
						premiumInteractions: { percent_used: 42 },
					},
				});
			},
		);
		vi.stubGlobal("fetch", fetchMock);
		try {
			let widgetFactory: WidgetFactory | undefined;
			const pi = createPi();
			statusline(pi);
			const ctx: StatuslineContext = {
				hasUI: true,
				ui: {
					setFooter() {},
					setWidget(_key, factory) {
						widgetFactory = factory;
					},
				},
				model: { id: "copilot", provider: "github-copilot" },
				modelRegistry: {
					getAvailable() {
						return [];
					},
					async getApiKeyForProvider() {
						return "provider-token";
					},
					isUsingOAuth() {
						return true;
					},
					authStorage: {
						get(provider) {
							return provider === "github-copilot"
								? {
										type: "oauth",
										access: "stored-access-token",
										refresh: "stored-refresh-token",
									}
								: undefined;
						},
					},
				},
				sessionManager: { getBranch: () => [] },
				settingsManager: { getCompactionSettings: () => ({ enabled: true }) },
				getContextUsage: () => ({ tokens: 0, contextWindow: 1000, percent: 0 }),
			};

			pi.handlers.get("session_start")?.({}, ctx);
			widgetFactory?.({}, { fg: (_color, text) => text }).render(120);

			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
			expect(fetchCalls[0].headers).toMatchObject({
				Authorization: "token stored-refresh-token",
			});
		} finally {
			vi.unstubAllGlobals();
		}
	});

	test("scopes git status cache by active session cwd", async () => {
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
			await writeFile(join(repo, "tracked.txt"), "initial\n", "utf8");
			await execFileAsync("git", ["add", "tracked.txt"], { cwd: repo });
			await execFileAsync("git", ["commit", "-m", "initial"], { cwd: repo });
		}
		await writeFile(join(repoOne, "tracked.txt"), "modified\n", "utf8");
		const { stdout: repoTwoBranchOutput } = await execFileAsync(
			"git",
			["branch", "--show-current"],
			{ cwd: repoTwo },
		);
		const repoTwoBranch = repoTwoBranchOutput.trim();

		let widgetFactory: WidgetFactory | undefined;
		const pi = createPi();
		statusline(pi);
		const makeCtx = (cwd: string): StatuslineContext => ({
			hasUI: true,
			ui: {
				setFooter() {},
				setWidget(_key, factory) {
					widgetFactory = factory;
				},
			},
			model: { name: "Test Model", contextWindow: 1000 },
			modelRegistry: {
				getAvailable() {
					return [];
				},
				async getApiKeyForProvider() {
					return undefined;
				},
			},
			sessionManager: { getBranch: () => [], getCwd: () => cwd },
			settingsManager: { getCompactionSettings: () => ({ enabled: true }) },
			getContextUsage: () => ({ tokens: 0, contextWindow: 1000, percent: 0 }),
		});

		pi.handlers.get("session_start")?.({}, makeCtx(repoOne));
		const widget = widgetFactory?.(
			{},
			{ fg: (_color: string, text: string) => text },
		);
		if (!widget) throw new Error("expected statusline widget");
		const render = () => widget.render(120).join("\n");
		render();
		await vi.waitFor(() => expect(render()).toMatch(/[+*]1/));

		pi.handlers.get("session_start")?.({}, makeCtx(repoTwo));
		await vi.waitFor(() => expect(render()).toContain(repoTwoBranch));
		expect(render()).not.toMatch(/[+*]1/);
	});
});
