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
	`#!${process.execPath}
const fs = require("node:fs");
const config = fs.readFileSync(0, "utf8");
const endpoint = process.argv.at(-1);
const dataLine = config.split("\\n").find(line => line.startsWith("data = "));
const data = dataLine ? JSON.parse(JSON.parse(dataLine.slice(7))) : undefined;
if (process.env.CLIPROXY_TEST_REQUESTS) {
  fs.appendFileSync(process.env.CLIPROXY_TEST_REQUESTS, JSON.stringify({endpoint, config, data, argv: process.argv.slice(2)}) + "\\n");
}
let status = 200;
let body;
if (endpoint.endsWith("/credentials")) {
  status = Number(process.env.CLIPROXY_TEST_CREDENTIALS_STATUS ?? 200);
  if (process.env.CLIPROXY_TEST_ENDPOINT) fs.writeFileSync(process.env.CLIPROXY_TEST_ENDPOINT, endpoint);
  body = JSON.parse(fs.readFileSync(process.env.CLIPROXY_TEST_FIXTURE, "utf8"));
} else {
  const resets = process.env.CLIPROXY_TEST_RESETS
    ? JSON.parse(fs.readFileSync(process.env.CLIPROXY_TEST_RESETS, "utf8")) : {};
  const response = resets[data?.auth_index];
  status = response?.management_status ?? 200;
  body = response ?? {status_code: 404, body: "{}"};
}
process.stdout.write(JSON.stringify(body) + "\\n" + status);
`,
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

test.each(["", "/", "/v1", "/v1/", "/backend-api", "/backend-api/"])(
	"normalizes supported base URL suffix %s for management requests",
	async (suffix) => {
		process.env.CLIPROXYAPI_MANAGEMENT_KEY = "fixture-key";
		process.env.CLIPROXYAPI_BASE_URL = `https://proxy.example.test/proxy${suffix}`;
		process.env.PI_CLIPROXY_USAGE_CACHE_PATH = path;
		process.env.CLIPROXY_TEST_FIXTURE = fixturePath;
		process.env.CLIPROXY_TEST_ENDPOINT = join(directory, "endpoint.txt");
		process.env.PATH = `${directory}:${originalEnv.PATH}`;
		writeFileSync(fixturePath, JSON.stringify({ files: [account("a", 12)] }));
		await refreshProxyUsage(() => {});
		expect(
			readFileSync(process.env.CLIPROXY_TEST_ENDPOINT, "utf8").trim(),
		).toBe("https://proxy.example.test/proxy/v8/management/credentials");
		expect(proxyUsageBadges()).toHaveLength(1);
	},
);

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

test("fetches manual reset counts per account through the proxy", async () => {
	process.env.CLIPROXYAPI_MANAGEMENT_KEY = "private-management-key";
	process.env.CLIPROXYAPI_BASE_URL = "https://proxy.example.test/proxy/v1";
	process.env.PI_CLIPROXY_USAGE_CACHE_PATH = path;
	process.env.CLIPROXY_TEST_FIXTURE = fixturePath;
	process.env.CLIPROXY_TEST_RESETS = join(directory, "resets.json");
	process.env.CLIPROXY_TEST_REQUESTS = join(directory, "requests.jsonl");
	process.env.PATH = `${directory}:${originalEnv.PATH}`;
	writeFileSync(process.env.CLIPROXY_TEST_REQUESTS, "");
	writeFileSync(
		fixturePath,
		JSON.stringify({
			files: [
				{
					...account("a", 47),
					id_token: { chatgpt_account_id: "private-account-a" },
				},
				{
					...account("b", 88),
					id_token: { chatgpt_account_id: "private-account-b" },
				},
				{ ...account("disabled", 100), disabled: true },
				{ ...account("claude", 50), provider: "claude" },
			],
		}),
	);
	writeFileSync(
		process.env.CLIPROXY_TEST_RESETS,
		JSON.stringify({
			a: {
				status_code: 200,
				body: JSON.stringify({
					available_count: 2,
					credits: ["private-credit-a"],
				}),
			},
			b: {
				status_code: 200,
				body: JSON.stringify({
					availableCount: "3",
					credits: ["private-credit-b"],
				}),
			},
		}),
	);
	await refreshProxyUsage(() => {});
	const badges = proxyUsageBadges();
	expect(badges[0]).toContain("W47% (2d ↻2)");
	expect(badges[0]).toContain("W88% (2d ↻3)");
	expect(formatProviderUsage([], false, true)).toBe(badges[0]);
	expect(renderProviderUsage([], { fg: (_color, text) => text }, false)).toBe(
		badges[0],
	);
	const requests = readFileSync(process.env.CLIPROXY_TEST_REQUESTS, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	const calls = requests.filter(({ data }) => data !== undefined);
	expect(calls).toHaveLength(2);
	for (const id of ["a", "b"]) {
		const call = calls.find(({ data }) => data.auth_index === id);
		expect(call.endpoint).toBe(
			"https://proxy.example.test/proxy/v8/management/requests/api-call",
		);
		expect(call.data).toEqual({
			auth_index: id,
			method: "GET",
			url: "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
			header: {
				Authorization: "Bearer $TOKEN$",
				Accept: "application/json",
				"OpenAI-Beta": "codex-1",
				originator: "Codex Desktop",
				"chatgpt-account-id": `private-account-${id}`,
			},
		});
		expect(call.config).toContain(
			'header = "Authorization: Bearer private-management-key"',
		);
		expect(JSON.stringify(call.argv)).not.toContain("private-");
	}
	const cached = readFileSync(path, "utf8");
	expect(cached).not.toContain("private-");
	expect(cached).not.toContain("auth_index");
	resetProxyUsageForTests();
	expect(proxyUsageBadges()).toEqual(badges);
	await refreshProxyUsage(() => {});
	expect(
		readFileSync(process.env.CLIPROXY_TEST_REQUESTS, "utf8").trim().split("\n"),
	).toHaveLength(requests.length);
});

test.each([
	{ status_code: 200, body: '{"available_count":0}' },
	{ status_code: 200, body: '{"available_count":-2}' },
	{ status_code: 200, body: '{"available_count":"invalid"}' },
	{ status_code: 200, body: '{"credits":[]}' },
	{ status_code: 200, body: "invalid JSON" },
	{ status_code: 401, body: '{"available_count":9}' },
	{ management_status: 404 },
	{ management_status: 500 },
])(
	"preserves quota without advertising unavailable reset credits: %j",
	async (response) => {
		process.env.CLIPROXYAPI_MANAGEMENT_KEY = "test-key";
		process.env.CLIPROXYAPI_BASE_URL = "https://proxy.example.test/";
		process.env.PI_CLIPROXY_USAGE_CACHE_PATH = path;
		process.env.CLIPROXY_TEST_FIXTURE = fixturePath;
		process.env.CLIPROXY_TEST_RESETS = join(directory, "resets.json");
		process.env.PATH = `${directory}:${originalEnv.PATH}`;
		writeFileSync(fixturePath, JSON.stringify({ files: [account("a", 47)] }));
		writeFileSync(
			process.env.CLIPROXY_TEST_RESETS,
			JSON.stringify({ a: response }),
		);
		await refreshProxyUsage(() => {});
		expect(proxyUsageBadges()).toEqual(["\uF120 S20% (2h)/W47% (2d)"]);
	},
);

test.each([
	{ status_code: 200, body: '{"available_count":0}' },
	{ status_code: 401, body: "{}" },
])(
	"replaces old reset counts without hiding another account's credits: %j",
	async (response) => {
		process.env.CLIPROXYAPI_MANAGEMENT_KEY = "test-key";
		process.env.CLIPROXYAPI_BASE_URL = "https://proxy.example.test/";
		process.env.PI_CLIPROXY_USAGE_CACHE_PATH = path;
		process.env.CLIPROXY_TEST_FIXTURE = fixturePath;
		process.env.CLIPROXY_TEST_RESETS = join(directory, "resets.json");
		process.env.PATH = `${directory}:${originalEnv.PATH}`;
		writeFileSync(
			fixturePath,
			JSON.stringify({ files: [account("a", 47), account("b", 88)] }),
		);
		writeFileSync(
			process.env.CLIPROXY_TEST_RESETS,
			JSON.stringify({
				a: { status_code: 200, body: '{"available_count":2}' },
			}),
		);
		await refreshProxyUsage(() => {});
		expect(proxyUsageBadges()[0]).toContain("W47% (2d ↻2)");
		const cached = JSON.parse(readFileSync(path, "utf8"));
		cached.fetchedAt = Date.now() - 6 * 60_000;
		writeFileSync(path, JSON.stringify(cached));
		resetProxyUsageForTests();
		writeFileSync(
			process.env.CLIPROXY_TEST_RESETS,
			JSON.stringify({
				a: response,
				b: { status_code: 200, body: '{"available_count":3}' },
			}),
		);
		await refreshProxyUsage(() => {});
		expect(proxyUsageBadges()[0]).toContain("W47% (2d)");
		expect(proxyUsageBadges()[0]).toContain("W88% (2d ↻3)");
	},
);

test.each([0, 6])(
	"refreshes cached quota with missing optional reset counts only when its TTL expires (age: %s minutes)",
	async (ageMinutes) => {
		process.env.CLIPROXYAPI_MANAGEMENT_KEY = "test-key";
		process.env.CLIPROXYAPI_BASE_URL = "https://proxy.example.test/";
		process.env.PI_CLIPROXY_USAGE_CACHE_PATH = path;
		process.env.CLIPROXY_TEST_FIXTURE = fixturePath;
		process.env.CLIPROXY_TEST_RESETS = join(directory, "resets.json");
		process.env.PATH = `${directory}:${originalEnv.PATH}`;
		const files = [account("a", 47)];
		const source = createHash("sha256")
			.update("https://proxy.example.test\0test-key")
			.digest("hex");
		writeFileSync(
			path,
			JSON.stringify({
				source,
				fetchedAt: Date.now() - ageMinutes * 60_000,
				accounts: parseProxyAccounts({ files }),
			}),
		);
		writeFileSync(fixturePath, JSON.stringify({ files }));
		writeFileSync(
			process.env.CLIPROXY_TEST_RESETS,
			JSON.stringify({
				a: { status_code: 200, body: '{"available_count":2}' },
			}),
		);
		await refreshProxyUsage(() => {});
		expect(proxyUsageBadges()[0]).toContain(
			ageMinutes === 0 ? "W47% (2d)" : "W47% (2d ↻2)",
		);
	},
);

test.each(["{", "null", '{"accounts":{}}'])(
	"refetches proxy usage when the disk cache is malformed: %s",
	async (cache) => {
		process.env.CLIPROXYAPI_MANAGEMENT_KEY = "test-key";
		process.env.CLIPROXYAPI_BASE_URL = "https://proxy.example.test/";
		process.env.PI_CLIPROXY_USAGE_CACHE_PATH = path;
		process.env.CLIPROXY_TEST_FIXTURE = fixturePath;
		process.env.CLIPROXY_TEST_RESETS = join(directory, "resets.json");
		process.env.PATH = `${directory}:${originalEnv.PATH}`;
		writeFileSync(path, cache);
		writeFileSync(fixturePath, JSON.stringify({ files: [account("a", 47)] }));
		writeFileSync(
			process.env.CLIPROXY_TEST_RESETS,
			JSON.stringify({
				a: { status_code: 200, body: '{"available_count":2}' },
			}),
		);
		await refreshProxyUsage(() => {});
		expect(proxyUsageBadges()).toEqual(["\uF120 S20% (2h)/W47% (2d ↻2)"]);
		resetProxyUsageForTests();
		expect(proxyUsageBadges()).toEqual(["\uF120 S20% (2h)/W47% (2d ↻2)"]);
	},
);

test.each([404, 500])(
	"keeps usable cached quota when credential discovery fails with HTTP %s",
	async (status) => {
		process.env.CLIPROXYAPI_MANAGEMENT_KEY = "test-key";
		process.env.CLIPROXYAPI_BASE_URL = "https://proxy.example.test/";
		process.env.PI_CLIPROXY_USAGE_CACHE_PATH = path;
		process.env.CLIPROXY_TEST_FIXTURE = fixturePath;
		process.env.PATH = `${directory}:${originalEnv.PATH}`;
		writeFileSync(fixturePath, JSON.stringify({ files: [account("a", 47)] }));
		await refreshProxyUsage(() => {});
		const cached = JSON.parse(readFileSync(path, "utf8"));
		cached.fetchedAt = Date.now() - 7 * 60_000;
		const cachedText = JSON.stringify(cached);
		writeFileSync(path, cachedText);
		resetProxyUsageForTests();
		process.env.CLIPROXY_TEST_CREDENTIALS_STATUS = String(status);
		await refreshProxyUsage(() => {});
		expect(readFileSync(path, "utf8")).toBe(cachedText);
		expect(proxyUsageBadges()).toEqual(["\uF120 S20% (2h)/W47% (2d) !"]);
	},
);

test("shows reset credits even without a current quota observation", async () => {
	process.env.CLIPROXYAPI_MANAGEMENT_KEY = "test-key";
	process.env.CLIPROXYAPI_BASE_URL = "https://proxy.example.test/";
	process.env.PI_CLIPROXY_USAGE_CACHE_PATH = path;
	process.env.CLIPROXY_TEST_FIXTURE = fixturePath;
	process.env.CLIPROXY_TEST_RESETS = join(directory, "resets.json");
	process.env.PATH = `${directory}:${originalEnv.PATH}`;
	writeFileSync(
		fixturePath,
		JSON.stringify({ files: [{ provider: "codex", auth_index: "a" }] }),
	);
	writeFileSync(
		process.env.CLIPROXY_TEST_RESETS,
		JSON.stringify({ a: { status_code: 200, body: '{"available_count":2}' } }),
	);
	await refreshProxyUsage(() => {});
	expect(proxyUsageBadges()).toEqual(["\uF120 (↻2)"]);
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

test("retries an empty account snapshot after one minute instead of five", async () => {
	process.env.CLIPROXYAPI_MANAGEMENT_KEY = "test-key";
	process.env.CLIPROXYAPI_BASE_URL = "https://proxy.example.test/";
	process.env.PI_CLIPROXY_USAGE_CACHE_PATH = path;
	process.env.CLIPROXY_TEST_FIXTURE = fixturePath;
	process.env.PATH = `${directory}:${originalEnv.PATH}`;
	const source = createHash("sha256")
		.update("https://proxy.example.test\0test-key")
		.digest("hex");
	writeFileSync(
		path,
		JSON.stringify({
			source,
			fetchedAt: Date.now() - 30_000,
			accounts: [],
		}),
	);
	writeFileSync(fixturePath, JSON.stringify({ files: [account("a", 47)] }));

	await refreshProxyUsage(() => {});
	expect(JSON.parse(readFileSync(path, "utf8")).accounts).toHaveLength(0);
	writeFileSync(
		path,
		JSON.stringify({
			source,
			fetchedAt: Date.now() - 2 * 60_000,
			accounts: [],
		}),
	);
	resetProxyUsageForTests();
	await refreshProxyUsage(() => {});
	expect(proxyUsageBadges()).toEqual([
		expect.stringMatching(/^\uF120 S20% \(2h\)\/W47% \(2d\)$/),
	]);
	expect(JSON.parse(readFileSync(path, "utf8")).accounts).toHaveLength(1);
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

test.each([
	[5.5, false],
	[7, true],
] as const)(
	"warns after the grace period for a %s-minute proxy snapshot, then hides expired cache",
	(ageMinutes, stale) => {
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
				source,
				fetchedAt: now - ageMinutes * 60_000,
				accounts: [
					{
						provider: "codex",
						identity,
						observedAt: now - ageMinutes * 60_000,
						scope: { weeklyPercentUsed: 90 },
					},
				],
			}),
		);
		expect(proxyUsageBadges()[0]).toMatch(stale ? /90% !$/ : /90%$/);
		writeFileSync(
			path,
			JSON.stringify({
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
	},
);
