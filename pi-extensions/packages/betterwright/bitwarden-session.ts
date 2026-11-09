import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const passwordVariable = "BW_PI_UNLOCK_PASSWORD";
export const BITWARDEN_IDLE_TIMEOUT_MS = 15 * 60_000;

type ExecuteBw = (
	args: string[],
	options: { env: NodeJS.ProcessEnv; signal: AbortSignal },
) => Promise<string>;

const executeBw: ExecuteBw = async (args, options) => {
	const { stdout } = await execFileAsync("bw", args, {
		...options,
		encoding: "utf8",
		timeout: args[0] === "unlock" ? 60_000 : 20_000,
		maxBuffer: 8 * 1024 * 1024,
		windowsHide: true,
	});
	return stdout;
};

function childEnvironment(): NodeJS.ProcessEnv {
	const env = { ...process.env };
	// Never import an externally unlocked session or implicit login secrets.
	for (const key of [
		"BW_SESSION",
		"BW_PASSWORD",
		"BW_CLIENTID",
		"BW_CLIENTSECRET",
		"BITWARDENCLI_DEBUG",
		passwordVariable,
	])
		delete env[key];
	return env;
}

/** Host-only session owner. No method returns the key or modifies process.env. */
export function createBitwardenSession({
	execute = executeBw,
	idleTimeoutMs = BITWARDEN_IDLE_TIMEOUT_MS,
}: {
	execute?: ExecuteBw;
	idleTimeoutMs?: number;
} = {}) {
	if (!Number.isFinite(idleTimeoutMs) || idleTimeoutMs <= 0)
		throw new Error("Bitwarden idle timeout must be positive.");
	let key: string | undefined;
	let revision = 0;
	let disposed = false;
	let expiresAt = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const pending = new Set<AbortController>();

	function lock() {
		key = undefined;
		expiresAt = 0;
		revision++;
		clearTimeout(timer);
		timer = undefined;
		for (const controller of pending) controller.abort();
	}

	function status(): "locked" | "unlocked" {
		if (key && Date.now() >= expiresAt) lock();
		return key ? "unlocked" : "locked";
	}

	function touch() {
		clearTimeout(timer);
		expiresAt = Date.now() + idleTimeoutMs;
		const current = revision;
		timer = setTimeout(() => {
			if (revision === current && Date.now() >= expiresAt) lock();
		}, idleTimeoutMs);
		timer.unref?.();
	}

	return {
		status,
		lock,
		async unlock(password: string) {
			if (disposed) throw new Error("Bitwarden session is closed.");
			if (!password || password.length > 4096)
				throw new Error("A valid master password is required.");
			lock();
			const current = revision;
			const controller = new AbortController();
			pending.add(controller);
			const env = childEnvironment();
			env[passwordVariable] = password;
			try {
				const output = await execute(
					[
						"unlock",
						"--raw",
						"--passwordenv",
						passwordVariable,
						"--nointeraction",
					],
					{ env, signal: controller.signal },
				);
				if (disposed || current !== revision || controller.signal.aborted)
					throw new Error("Unlock cancelled.");
				const nextKey = output.trim();
				if (nextKey.length > 8192 || !/^[A-Za-z0-9+/_-]+={0,2}$/u.test(nextKey))
					throw new Error("Invalid unlock response.");
				key = nextKey;
				touch();
			} catch {
				// Error objects may contain the child's argv, stdout, stderr, or env.
				throw new Error(
					"Bitwarden unlock failed or was cancelled. Check that bw is installed and logged in, then retry /bw unlock.",
				);
			} finally {
				delete env[passwordVariable];
				password = "";
				pending.delete(controller);
			}
		},
		async run(args: string[]) {
			if (status() !== "unlocked" || disposed)
				throw new Error("Bitwarden is locked. Use /bw unlock.");
			const current = revision;
			const controller = new AbortController();
			pending.add(controller);
			const env = childEnvironment();
			env.BW_SESSION = key;
			touch();
			try {
				const output = await execute(args, { env, signal: controller.signal });
				if (disposed || current !== revision || controller.signal.aborted)
					throw new Error("Credential operation cancelled.");
				touch();
				return output;
			} catch {
				if (current === revision) lock();
				throw new Error(
					"Bitwarden credential access failed or was cancelled. Use /bw unlock and check the CLI configuration.",
				);
			} finally {
				delete env.BW_SESSION;
				pending.delete(controller);
			}
		},
		dispose() {
			disposed = true;
			lock();
		},
	};
}

export type BitwardenSession = ReturnType<typeof createBitwardenSession>;
