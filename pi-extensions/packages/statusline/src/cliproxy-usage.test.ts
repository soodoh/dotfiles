import { createHash } from "node:crypto";
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
	parseProxyAccounts,
	proxyUsageBadges,
	refreshProxyUsage,
	resetProxyUsageForTests,
} from "./cliproxy-usage";
import { formatProviderUsage, renderProviderUsage } from "./provider-usage";

const directory = mkdtempSync(join(tmpdir(), "cliproxy-usage-test-"));
const originalEnv = { ...process.env };
const path = join(directory, "usage.json");
const fixturePath = join(directory, "fixture.json");
const curlPath = join(directory, "curl");
writeFileSync(
	curlPath,
	'#!/bin/sh\ncat >/dev/null\ncat "$CLIPROXY_TEST_FIXTURE"\nprintf "\\n200"\n',
);
chmodSync(curlPath, 0o755);

function account(id: string, used: number, observedAt = Date.now()) {
	return {
		provider: "codex",
		auth_index: id,
		email: `${id}@example.test`,
		id_token: `secret-${id}`,
		quota: {
			observed_at: new Date(observedAt).toISOString(),
			signals: {
				"X-Codex-Primary-Used-Percent": String(used),
				"X-Codex-Primary-Window-Minutes": "10080",
				"X-Codex-Primary-Reset-At": String(
					Math.floor((observedAt + 2 * 86_400_000) / 1000),
				),
				"X-Codex-Secondary-Used-Percent": "20",
				"X-Codex-Secondary-Window-Minutes": "300",
				"X-Codex-Secondary-Reset-After-Seconds": "7200",
			},
		},
	};
}

afterEach(() => {
	resetProxyUsageForTests();
	process.env = { ...originalEnv };
	try {
		rmSync(path);
	} catch {
		/* missing */
	}
	try {
		rmSync(`${path}.refresh.lock`);
	} catch {
		/* missing */
	}
});

test("keeps deterministic account identities, independent of response order or quota", () => {
	const first = parseProxyAccounts({
		files: [account("b", 100), account("a", 47)],
	});
	const second = parseProxyAccounts({
		files: [account("a", 100), account("b", 47)],
	});
	expect(first.map(({ identity }) => identity)).toEqual(
		second.map(({ identity }) => identity),
	);
	expect(first.every(({ identity }) => identity.length === 64)).toBe(true);
	expect(
		first
			.map(({ scope }) => scope.weeklyPercentUsed)
			.sort((a, b) => (a ?? 0) - (b ?? 0)),
	).toEqual([47, 100]);
});

test("groups proxy accounts under one icon and +N without caching credentials", async () => {
	process.env.CLIPROXYAPI_MANAGEMENT_KEY = "private-management-key";
	process.env.CLIPROXYAPI_BASE_URL = "https://proxy.example.test/";
	process.env.PI_CLIPROXY_USAGE_CACHE_PATH = path;
	process.env.CLIPROXY_TEST_FIXTURE = fixturePath;
	process.env.PATH = `${directory}:${originalEnv.PATH}`;
	writeFileSync(
		fixturePath,
		JSON.stringify({
			files: [account("c", 90), account("a", 47), account("b", 100)],
		}),
	);
	await refreshProxyUsage(() => {});
	const labels = proxyUsageBadges(true);
	expect(labels).toEqual([
		expect.stringMatching(
			/^\uF120 S20% \(2h\)\/W\d+% \(2d\), S20% \(2h\)\/W\d+% \(2d\), \+1$/,
		),
	]);
	expect(proxyUsageBadges()).toEqual([
		expect.stringMatching(
			/^\uF120 S20% \(2h\)\/W\d+% \(2d\), S20% \(2h\)\/W\d+% \(2d\), S20% \(2h\)\/W\d+% \(2d\)$/,
		),
	]);
	expect(formatProviderUsage([], false, true)).toBe(labels[0]);
	expect(
		renderProviderUsage(
			[],
			{ fg: (_color, text) => text },
			true,
			undefined,
			undefined,
			true,
		),
	).toContain(proxyUsageBadges(false)[0]);
	const cached = readFileSync(path, "utf8");
	expect(cached).not.toContain("private-management-key");
	expect(cached).not.toContain("id_token");
	expect(cached).not.toContain("@example.test");
	expect(cached).not.toContain("secret-");
});

test("retains old observations only until their reset, skipping unsupported or disabled accounts", () => {
	const old = Date.now() - 16 * 60_000;
	const expired = Date.now() - 3 * 86_400_000;
	expect(
		parseProxyAccounts({
			files: [
				account("old", 45, old),
				account("expired", 80, expired),
				{ ...account("disabled", 100), disabled: true },
				{ ...account("claude", 50), provider: "claude" },
			],
		}),
	).toHaveLength(1);
});

test("a fresh management snapshot does not mark an older, unexpired quota stale", () => {
	process.env.CLIPROXYAPI_MANAGEMENT_KEY = "test-key";
	process.env.CLIPROXYAPI_BASE_URL = "https://proxy.example.test/";
	process.env.PI_CLIPROXY_USAGE_CACHE_PATH = path;
	const now = Date.now();
	const source = createHash("sha256")
		.update("https://proxy.example.test\0test-key")
		.digest("hex");
	writeFileSync(
		path,
		JSON.stringify({
			version: 3,
			source,
			fetchedAt: now,
			accounts: [
				{
					provider: "codex",
					identity: createHash("sha256").update("id").digest("hex"),
					observedAt: now - 35 * 60_000,
					scope: {
						weeklyPercentUsed: 100,
						weeklyResetAt: now + 12 * 60 * 60_000,
					},
				},
			],
		}),
	);
	expect(proxyUsageBadges()).toEqual([
		expect.stringMatching(/^\uF120 100% \(12h\)$/),
	]);
});

test("shows a stale marker briefly, then hides expired cache; absent key disables proxy", () => {
	process.env.CLIPROXYAPI_MANAGEMENT_KEY = "test-key";
	process.env.CLIPROXYAPI_BASE_URL = "https://proxy.example.test/";
	process.env.PI_CLIPROXY_USAGE_CACHE_PATH = path;
	const source = createHash("sha256")
		.update("https://proxy.example.test\0test-key")
		.digest("hex");
	const now = Date.now();
	const identity = createHash("sha256").update("id").digest("hex");
	writeFileSync(
		path,
		JSON.stringify({
			version: 3,
			source,
			fetchedAt: now - 6 * 60_000,
			accounts: [
				{
					provider: "codex",
					identity,
					observedAt: now - 6 * 60_000,
					scope: { weeklyPercentUsed: 90 },
				},
			],
		}),
	);
	expect(proxyUsageBadges()[0]).toMatch(/90% !$/);
	writeFileSync(
		path,
		JSON.stringify({
			version: 3,
			source,
			fetchedAt: now - 16 * 60_000,
			accounts: [
				{
					provider: "codex",
					identity,
					observedAt: now - 16 * 60_000,
					scope: { weeklyPercentUsed: 90 },
				},
			],
		}),
	);
	resetProxyUsageForTests();
	expect(proxyUsageBadges()).toEqual([]);
	delete process.env.CLIPROXYAPI_MANAGEMENT_KEY;
	expect(proxyUsageBadges()).toEqual([]);
});
