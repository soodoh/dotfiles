import { spawn } from "node:child_process";

export type GitStatus = {
	branch: string | null;
	staged: number;
	unstaged: number;
	untracked: number;
};

export type GitStatusStore = {
	getStatus(
		cwd: string,
		providerBranch: string | null,
		onUpdate: () => void,
	): GitStatus;
	invalidate(): void;
};

type GitStatusCounts = Omit<GitStatus, "branch">;
type CacheEntry<T> = { value: T; timestamp: number };

export const GIT_REFRESH_INTERVAL_MS = 5000;
const STATUS_TTL_MS = GIT_REFRESH_INTERVAL_MS;
const BRANCH_TTL_MS = GIT_REFRESH_INTERVAL_MS;
const MAX_GIT_STDOUT_BYTES = 64 * 1024;

function runGit(
	cwd: string,
	args: string[],
	timeoutMs = 200,
	maxStdoutBytes = MAX_GIT_STDOUT_BYTES,
): Promise<string | null> {
	return new Promise((resolve) => {
		let proc: ReturnType<typeof spawn>;
		try {
			proc = spawn("git", args, {
				cwd,
				stdio: ["ignore", "pipe", "ignore"],
			});
		} catch {
			resolve(null);
			return;
		}
		const chunks: Buffer[] = [];
		let stdoutBytes = 0;
		let resolved = false;

		const timeout = setTimeout(() => {
			proc.kill();
			finish(null);
		}, timeoutMs);

		function finish(result: string | null): void {
			if (resolved) return;
			resolved = true;
			clearTimeout(timeout);
			resolve(result);
		}

		proc.stdout?.on("data", (data: Buffer | string) => {
			const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
			stdoutBytes += chunk.byteLength;
			if (stdoutBytes > maxStdoutBytes) {
				proc.kill();
				finish(null);
				return;
			}
			chunks.push(chunk);
		});
		proc.on("close", (code) =>
			finish(
				code === 0 ? Buffer.concat(chunks).toString("utf8").trimEnd() : null,
			),
		);
		proc.on("error", () => finish(null));
	});
}

function parseGitStatus(output: string): Omit<GitStatus, "branch"> {
	let staged = 0;
	let unstaged = 0;
	let untracked = 0;

	for (const line of output.split("\n")) {
		if (!line) continue;
		const x = line[0];
		const y = line[1];

		if (x === "?" && y === "?") {
			untracked++;
			continue;
		}
		if (x && x !== " " && x !== "?") staged++;
		if (y && y !== " ") unstaged++;
	}

	return { staged, unstaged, untracked };
}

async function fetchGitBranch(cwd: string): Promise<string | null> {
	const branch = await runGit(cwd, ["branch", "--show-current"]);
	if (branch === null) return null;
	if (branch) return branch;

	const sha = await runGit(cwd, ["rev-parse", "--short", "HEAD"]);
	return sha ? `${sha} (detached)` : "detached";
}

const EMPTY_COUNTS: GitStatusCounts = {
	staged: 0,
	unstaged: 0,
	untracked: 0,
};

function notifyListeners(listeners: Iterable<() => void>): void {
	for (const listener of listeners) {
		try {
			listener();
		} catch {
			// Isolate throwing listeners so remaining callers still receive updates.
		}
	}
}

function createCoalescedCache<T>(ttlMs: number) {
	const cachedByKey = new Map<string, CacheEntry<T>>();
	const pendingByKey = new Map<string, Set<() => void>>();
	let invalidation = 0;

	return {
		read(
			key: string,
			fallback: T,
			onUpdate: () => void,
			load: (previous: T | undefined) => Promise<T>,
		): T {
			const now = Date.now();
			const cached = cachedByKey.get(key);
			if (cached && now - cached.timestamp < ttlMs) {
				return cached.value;
			}

			const existing = pendingByKey.get(key);
			if (existing) {
				existing.add(onUpdate);
			} else {
				const fetchId = invalidation;
				const listeners = new Set<() => void>([onUpdate]);
				pendingByKey.set(key, listeners);
				void Promise.resolve().then(async () => {
					if (fetchId !== invalidation) {
						if (pendingByKey.get(key) === listeners) {
							pendingByKey.delete(key);
						}
						return;
					}
					let value: T;
					try {
						value = await load(cached?.value);
					} catch {
						value = cached ? cached.value : fallback;
					} finally {
						if (pendingByKey.get(key) === listeners) {
							pendingByKey.delete(key);
						}
					}
					if (fetchId !== invalidation) return;
					cachedByKey.set(key, { value, timestamp: Date.now() });
					notifyListeners(listeners);
				});
			}

			return cached ? cached.value : fallback;
		},
		invalidate(): void {
			cachedByKey.clear();
			pendingByKey.clear();
			invalidation++;
		},
	};
}

export function createGitStatusStore(): GitStatusStore {
	const branchCache = createCoalescedCache<string | null>(BRANCH_TTL_MS);
	const statusCache = createCoalescedCache<GitStatusCounts>(STATUS_TTL_MS);

	return {
		getStatus(cwd, providerBranch, onUpdate) {
			const branch = branchCache.read(cwd, providerBranch, onUpdate, () =>
				fetchGitBranch(cwd),
			);
			const counts = statusCache.read(cwd, EMPTY_COUNTS, onUpdate, (previous) =>
				runGit(cwd, ["--no-optional-locks", "status", "--porcelain"], 500).then(
					(output) =>
						output !== null
							? parseGitStatus(output)
							: (previous ?? EMPTY_COUNTS),
				),
			);

			return {
				branch,
				staged: counts.staged,
				unstaged: counts.unstaged,
				untracked: counts.untracked,
			};
		},
		invalidate() {
			statusCache.invalidate();
			branchCache.invalidate();
		},
	};
}

export const defaultGitStatusStore = createGitStatusStore();
