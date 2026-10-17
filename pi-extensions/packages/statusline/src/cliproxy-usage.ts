import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { formatProviderScope, type ProviderUsageScope } from "./provider-usage";
import { isUsageCacheFresh, usageSnapshotFreshness } from "./usage-freshness";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const CODEX_PROXY_LOGO = "\uF120"; // nf-fa-terminal

type Account = {
	provider: string;
	identity: string;
	scope: ProviderUsageScope;
	observedAt: number;
};
// Request-only metadata: never written to the shared usage cache.
type AccountEntry = {
	account: Account;
	authIndex: string;
	accountId?: string;
};
type Snapshot = {
	source: string;
	fetchedAt: number;
	accounts: Account[];
};
let snapshot: Snapshot | undefined;
let pending: Promise<void> | undefined;
let lastAttemptAt = 0;
let lastAttemptSource: string | undefined;
let lastAttemptFailed = false;

function cachePath(): string {
	return (
		process.env.PI_CLIPROXY_USAGE_CACHE_PATH ??
		join(
			process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"),
			"pi",
			"cliproxy-usage.json",
		)
	);
}

function sourceKey(): string | undefined {
	const url = process.env.CLIPROXYAPI_BASE_URL;
	const key = process.env.CLIPROXYAPI_MANAGEMENT_KEY;
	if (!url || !key || /[\r\n"\\]/.test(key)) return undefined;
	try {
		const parsed = new URL(url);
		if (
			parsed.protocol !== "https:" &&
			!(
				parsed.protocol === "http:" &&
				["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
			)
		)
			return undefined;
		if (parsed.username || parsed.password || parsed.search || parsed.hash)
			return undefined;
		return createHash("sha256")
			.update(`${parsed.origin}\0${key}`)
			.digest("hex");
	} catch {
		return undefined;
	}
}

function readSnapshot(source: string): Snapshot | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(cachePath(), "utf8"));
		if (
			typeof value !== "object" ||
			!value ||
			!("source" in value) ||
			value.source !== source ||
			!("accounts" in value) ||
			!Array.isArray(value.accounts) ||
			!("fetchedAt" in value) ||
			typeof value.fetchedAt !== "number" ||
			!Number.isFinite(value.fetchedAt)
		)
			return undefined;
		return value as Snapshot;
	} catch {
		return undefined;
	}
}

function currentSnapshot(source: string): Snapshot | undefined {
	const disk = readSnapshot(source);
	if (
		disk &&
		(!snapshot ||
			snapshot.source !== source ||
			disk.fetchedAt > snapshot.fetchedAt)
	)
		snapshot = disk;
	return snapshot?.source === source ? snapshot : undefined;
}

function isProxySnapshotFresh(data: Snapshot | undefined): boolean {
	return isUsageCacheFresh({
		lastAttemptAt: data?.fetchedAt,
		state: data?.accounts.length === 0 ? "unknown" : "ready",
	});
}

function numeric(value: unknown): number | undefined {
	const number =
		typeof value === "number" || (typeof value === "string" && value.trim())
			? Number(value)
			: NaN;
	return Number.isFinite(number) ? number : undefined;
}

function codexScope(
	value: unknown,
	now: number,
): { scope: ProviderUsageScope; observedAt: number } | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	const signals = record.signals;
	if (!signals || typeof signals !== "object") return undefined;
	const headers = signals as Record<string, unknown>;
	const observedAt =
		typeof record.observed_at === "string"
			? Date.parse(record.observed_at)
			: NaN;
	if (!Number.isFinite(observedAt) || observedAt > now + 60_000)
		return undefined;
	const scope: ProviderUsageScope = {};
	for (const [name, fallback] of [
		["Primary", "session"],
		["Secondary", "weekly"],
	] as const) {
		const used = numeric(headers[`X-Codex-${name}-Used-Percent`]);
		if (used === undefined) continue;
		const resetAt = numeric(headers[`X-Codex-${name}-Reset-At`]);
		const after = numeric(headers[`X-Codex-${name}-Reset-After-Seconds`]);
		const resetTimestamp =
			resetAt !== undefined && resetAt > 0
				? resetAt * (resetAt < 1e12 ? 1000 : 1)
				: after !== undefined && after >= 0
					? observedAt + after * 1000
					: undefined;
		if (resetTimestamp !== undefined && resetTimestamp <= now) continue;
		if (
			resetTimestamp === undefined &&
			usageSnapshotFreshness({ fetchedAt: observedAt, state: "ready" }, now) ===
				"expired"
		)
			continue;
		const timestamp = resetTimestamp;
		const minutes = numeric(headers[`X-Codex-${name}-Window-Minutes`]);
		const weekly =
			minutes === undefined ? fallback === "weekly" : minutes >= 6 * 24 * 60;
		const percent = Math.min(100, Math.max(0, used));
		if (weekly) {
			if (
				scope.weeklyPercentUsed === undefined ||
				percent >= scope.weeklyPercentUsed
			) {
				scope.weeklyPercentUsed = percent;
				scope.weeklyResetAt = timestamp;
			}
		} else if (
			scope.sessionPercentUsed === undefined ||
			percent >= scope.sessionPercentUsed
		) {
			scope.sessionPercentUsed = percent;
			scope.sessionResetAt = timestamp;
		}
	}
	return scope.sessionPercentUsed !== undefined ||
		scope.weeklyPercentUsed !== undefined
		? { scope, observedAt }
		: undefined;
}

function parseAccountEntries(body: unknown, now = Date.now()): AccountEntry[] {
	if (
		!body ||
		typeof body !== "object" ||
		!Array.isArray((body as { files?: unknown }).files)
	)
		throw new Error("Invalid credentials response");
	const accounts: AccountEntry[] = [];
	for (const value of (body as { files: unknown[] }).files) {
		if (!value || typeof value !== "object") continue;
		const file = value as Record<string, unknown>;
		if (file.disabled === true || file.provider !== "codex") continue;
		const identity = file.auth_index;
		if (typeof identity !== "string" || !identity) continue;
		let usage = codexScope(file.quota, now);
		if (!usage && file.model_quotas && typeof file.model_quotas === "object") {
			for (const candidate of Object.values(file.model_quotas)) {
				const parsed = codexScope(candidate, now);
				if (parsed && (!usage || parsed.observedAt > usage.observedAt))
					usage = parsed;
			}
		}
		const accountId =
			file.id_token && typeof file.id_token === "object"
				? (file.id_token as Record<string, unknown>).chatgpt_account_id
				: undefined;
		accounts.push({
			account: {
				provider: "codex",
				identity: createHash("sha256").update(identity).digest("hex"),
				...(usage ?? { scope: {}, observedAt: now }),
			},
			authIndex: identity,
			accountId:
				typeof accountId === "string" && accountId ? accountId : undefined,
		});
	}
	return accounts.sort(
		(a, b) =>
			a.account.provider.localeCompare(b.account.provider) ||
			a.account.identity.localeCompare(b.account.identity),
	);
}

/** Only verified provider-specific quota signals are interpreted. Never retain raw auth-file data. */
export function parseProxyAccounts(body: unknown, now = Date.now()): Account[] {
	return parseAccountEntries(body, now)
		.map(({ account }) => account)
		.filter((account) => usableScope(account, now) !== undefined);
}

function requestManagement(
	url: string,
	key: string,
	path: string,
	data?: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
	return new Promise((resolve, reject) => {
		const endpoint = new URL(
			path,
			`${url.replace(/\/+$/, "").replace(/\/(?:v1|backend-api)$/, "")}/`,
		).toString();
		// curl honors the work profile's HTTPS_PROXY, HTTP_PROXY and NO_PROXY. The key
		// travels on stdin, not argv, and neither stderr nor the raw body is logged.
		const child = spawn(
			"curl",
			[
				"-q",
				"--config",
				"-",
				"--silent",
				"--max-time",
				"10",
				"--write-out",
				"\n%{http_code}",
				endpoint,
			],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
		let output = "";
		let bytes = 0;
		child.stdout.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > MAX_RESPONSE_BYTES) {
				child.kill();
				return;
			}
			output += chunk.toString("utf8");
		});
		child.stderr.resume();
		child.stdin.on("error", () => {
			/* curl can exit before consuming its config */
		});
		child.on("error", () =>
			reject(new Error("CLIProxyAPI transport unavailable")),
		);
		child.on("close", (code) => {
			if (code !== 0 || bytes > MAX_RESPONSE_BYTES) {
				reject(new Error("CLIProxyAPI request failed"));
				return;
			}
			const boundary = output.lastIndexOf("\n");
			const status = Number(output.slice(boundary + 1));
			if (
				boundary < 0 ||
				!Number.isInteger(status) ||
				status < 100 ||
				status > 599
			) {
				reject(new Error("CLIProxyAPI returned an invalid HTTP status"));
				return;
			}
			try {
				resolve({
					status,
					body:
						status === 200 ? JSON.parse(output.slice(0, boundary)) : undefined,
				});
			} catch {
				reject(new Error("CLIProxyAPI returned invalid JSON"));
			}
		});
		let config = `header = "Authorization: Bearer ${key}"\n`;
		if (data !== undefined) {
			config += `request = "POST"\nheader = "Content-Type: application/json"\ndata = ${JSON.stringify(JSON.stringify(data))}\n`;
		}
		child.stdin.end(config);
	});
}

async function fetchResetCredits(
	url: string,
	key: string,
	entry: AccountEntry,
): Promise<number | undefined> {
	try {
		const header: Record<string, string> = {
			Authorization: "Bearer $TOKEN$",
			Accept: "application/json",
			"OpenAI-Beta": "codex-1",
			originator: "Codex Desktop",
		};
		if (entry.accountId) header["chatgpt-account-id"] = entry.accountId;
		const response = await requestManagement(
			url,
			key,
			"v8/management/requests/api-call",
			{
				auth_index: entry.authIndex,
				method: "GET",
				url: "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
				header,
			},
		);
		if (
			response.status !== 200 ||
			!response.body ||
			typeof response.body !== "object"
		)
			return undefined;
		const upstream = response.body as Record<string, unknown>;
		if (upstream.status_code !== 200 || typeof upstream.body !== "string")
			return undefined;
		const body: unknown = JSON.parse(upstream.body);
		if (!body || typeof body !== "object") return undefined;
		const credits = body as Record<string, unknown>;
		const count = numeric(credits.available_count ?? credits.availableCount);
		return count === undefined ? undefined : Math.max(0, Math.floor(count));
	} catch {
		// Reset credits are optional; an unsupported endpoint or failed account
		// lookup must not hide its observed quota or other accounts' credits.
		return undefined;
	}
}

async function fetchProxyAccounts(
	url: string,
	key: string,
): Promise<Account[]> {
	const response = await requestManagement(
		url,
		key,
		"v8/management/credentials",
	);
	if (response.status !== 200)
		throw new Error("CLIProxyAPI returned a non-OK response");
	const entries = parseAccountEntries(response.body);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(4, entries.length) }, async () => {
			while (next < entries.length) {
				const entry = entries[next++];
				const count = await fetchResetCredits(url, key, entry);
				if (count !== undefined) entry.account.scope.availableResets = count;
			}
		}),
	);
	return entries
		.map(({ account }) => account)
		.filter((account) => usableScope(account, Date.now()) !== undefined);
}

async function update(source: string): Promise<boolean> {
	const key = process.env.CLIPROXYAPI_MANAGEMENT_KEY;
	const url = process.env.CLIPROXYAPI_BASE_URL;
	if (!key || !url) return false;
	const path = cachePath();
	mkdirSync(dirname(path), { recursive: true });
	let release: (() => Promise<void>) | undefined;
	try {
		release = await lockfile.lock(`${path}.refresh`, {
			realpath: false,
			stale: 20_000,
			retries: { retries: 10, minTimeout: 100, maxTimeout: 100, factor: 1 },
		});
		const cached = currentSnapshot(source);
		if (isProxySnapshotFresh(cached)) return false;
		const accounts = await fetchProxyAccounts(url, key);
		const updated: Snapshot = {
			source,
			fetchedAt: Date.now(),
			accounts,
		};
		const temporary = `${path}.${process.pid}.tmp`;
		try {
			writeFileSync(temporary, `${JSON.stringify(updated)}\n`, { mode: 0o600 });
			renameSync(temporary, path);
		} finally {
			try {
				unlinkSync(temporary);
			} catch {
				/* renamed */
			}
		}
		snapshot = updated;
		return true;
	} catch {
		// A failing read never erases a recent, usable snapshot.
		return false;
	} finally {
		if (release) await release().catch(() => {});
	}
}

export function refreshProxyUsage(onUpdate: () => void): Promise<void> {
	const source = sourceKey();
	if (!source) return Promise.resolve();
	if (isProxySnapshotFresh(currentSnapshot(source))) return Promise.resolve();
	if (
		lastAttemptSource === source &&
		isUsageCacheFresh({
			lastAttemptAt,
			state: lastAttemptFailed ? "error" : "ready",
		})
	)
		return pending ?? Promise.resolve();
	if (!pending) {
		lastAttemptSource = source;
		lastAttemptAt = Date.now();
		pending = update(source)
			.then((changed) => {
				lastAttemptFailed = !changed;
				if (changed) onUpdate();
			})
			.finally(() => {
				pending = undefined;
			});
	}
	return pending;
}

function usableScope(
	account: Account,
	now: number,
): ProviderUsageScope | undefined {
	if (!account.scope || typeof account.scope !== "object") return undefined;
	const scope: ProviderUsageScope = {};
	for (const kind of ["session", "weekly"] as const) {
		const used = account.scope[`${kind}PercentUsed`];
		const resetAt = account.scope[`${kind}ResetAt`];
		if (typeof used !== "number" || !Number.isFinite(used)) continue;
		if (
			typeof resetAt === "number"
				? resetAt <= now
				: usageSnapshotFreshness(
						{ fetchedAt: account.observedAt, state: "ready" },
						now,
					) === "expired"
		)
			continue;
		scope[`${kind}PercentUsed`] = used;
		if (typeof resetAt === "number") scope[`${kind}ResetAt`] = resetAt;
	}
	const resets = account.scope.availableResets;
	if (typeof resets === "number" && Number.isFinite(resets) && resets >= 0)
		scope.availableResets = Math.floor(resets);
	return scope.sessionPercentUsed !== undefined ||
		scope.weeklyPercentUsed !== undefined ||
		(scope.availableResets ?? 0) > 0
		? scope
		: undefined;
}

export function proxyUsageBadges(compact = false): string[] {
	const source = sourceKey();
	if (!source) return [];
	const data = currentSnapshot(source);
	const freshness = usageSnapshotFreshness(
		data && {
			fetchedAt: data.fetchedAt,
			lastAttemptAt,
			state:
				lastAttemptSource === source &&
				lastAttemptFailed &&
				lastAttemptAt > data.fetchedAt
					? "error"
					: "ready",
		},
	);
	if (freshness === "expired" || !data || !Array.isArray(data.accounts))
		return [];
	const valid = data.accounts.flatMap((account) => {
		if (
			account?.provider !== "codex" ||
			typeof account.identity !== "string" ||
			typeof account.observedAt !== "number"
		)
			return [];
		const scope = usableScope(account, Date.now());
		return scope ? [{ ...account, scope }] : [];
	});
	const visible = compact ? valid.slice(0, 2) : valid;
	const scopes = visible.flatMap((account) => {
		const scope = formatProviderScope(account.scope);
		return scope ? [scope] : [];
	});
	if (scopes.length === 0) return [];
	if (compact && valid.length > visible.length)
		scopes.push(`+${valid.length - visible.length}`);
	return [
		`${CODEX_PROXY_LOGO} ${scopes.join(", ")}${freshness === "stale" ? " !" : ""}`,
	];
}

export function resetProxyUsageForTests(): void {
	snapshot = undefined;
	pending = undefined;
	lastAttemptAt = 0;
	lastAttemptSource = undefined;
	lastAttemptFailed = false;
}
