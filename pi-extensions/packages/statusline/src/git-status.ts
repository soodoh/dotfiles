import { spawn } from "node:child_process";

export type ReadonlyFooterDataProvider = {
	getGitBranch(): string | null;
	onBranchChange(callback: () => void): () => void;
};

export type GitStatus = {
	branch: string | null;
	staged: number;
	unstaged: number;
	untracked: number;
};

type GitStatusCacheEntry = Omit<GitStatus, "branch"> & { timestamp: number };
type GitBranchCacheEntry = { branch: string | null; timestamp: number };

const STATUS_TTL_MS = 1000;
const BRANCH_TTL_MS = 500;
export const MAX_GIT_STDOUT_BYTES = 64 * 1024;

const cachedStatusByCwd = new Map<string, GitStatusCacheEntry>();
const cachedBranchByCwd = new Map<string, GitBranchCacheEntry>();
const pendingStatusFetchByCwd = new Map<string, Promise<void>>();
const pendingBranchFetchByCwd = new Map<string, Promise<void>>();
let statusInvalidation = 0;
let branchInvalidation = 0;

export function runGit(
	cwd: string,
	args: string[],
	timeoutMs = 200,
	maxStdoutBytes = MAX_GIT_STDOUT_BYTES,
): Promise<string | null> {
	return new Promise((resolve) => {
		const proc = spawn("git", args, {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
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

		proc.stdout.on("data", (data: Buffer | string) => {
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
			finish(code === 0 ? Buffer.concat(chunks).toString("utf8").trim() : null),
		);
		proc.on("error", () => finish(null));
	});
}

export function parseGitStatus(output: string): Omit<GitStatus, "branch"> {
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

function getCurrentBranch(
	cwd: string,
	providerBranch: string | null,
	onUpdate: () => void,
): string | null {
	const now = Date.now();
	const cachedBranch = cachedBranchByCwd.get(cwd);
	if (cachedBranch && now - cachedBranch.timestamp < BRANCH_TTL_MS) {
		return cachedBranch.branch;
	}

	if (!pendingBranchFetchByCwd.has(cwd)) {
		const fetchId = branchInvalidation;
		const pending = fetchGitBranch(cwd).then((result) => {
			if (fetchId === branchInvalidation) {
				cachedBranchByCwd.set(cwd, {
					branch: result,
					timestamp: Date.now(),
				});
				onUpdate();
			}
			pendingBranchFetchByCwd.delete(cwd);
		});
		pendingBranchFetchByCwd.set(cwd, pending);
	}

	return cachedBranch ? cachedBranch.branch : providerBranch;
}

export function getGitStatus(
	cwd: string,
	providerBranch: string | null,
	onUpdate: () => void,
): GitStatus {
	const now = Date.now();
	const branch = getCurrentBranch(cwd, providerBranch, onUpdate);
	const cachedStatus = cachedStatusByCwd.get(cwd);

	if (cachedStatus && now - cachedStatus.timestamp < STATUS_TTL_MS) {
		return { branch, ...cachedStatus };
	}

	if (!pendingStatusFetchByCwd.has(cwd)) {
		const fetchId = statusInvalidation;
		const pending = runGit(cwd, ["status", "--porcelain"], 500).then(
			(output) => {
				if (fetchId === statusInvalidation) {
					const parsed = output
						? parseGitStatus(output)
						: { staged: 0, unstaged: 0, untracked: 0 };
					cachedStatusByCwd.set(cwd, {
						...parsed,
						timestamp: Date.now(),
					});
					onUpdate();
				}
				pendingStatusFetchByCwd.delete(cwd);
			},
		);
		pendingStatusFetchByCwd.set(cwd, pending);
	}

	return cachedStatus
		? { branch, ...cachedStatus }
		: { branch, staged: 0, unstaged: 0, untracked: 0 };
}

export function invalidateGit(): void {
	cachedStatusByCwd.clear();
	cachedBranchByCwd.clear();
	pendingStatusFetchByCwd.clear();
	pendingBranchFetchByCwd.clear();
	statusInvalidation++;
	branchInvalidation++;
}
