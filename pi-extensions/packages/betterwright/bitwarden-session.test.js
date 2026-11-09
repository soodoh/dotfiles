import { existsSync, readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { createBitwardenSession } from "./bitwarden-session.ts";
import { fakeBw } from "./test-support/fake-bw.js";

const sessions = [];
const fixtures = [];
function session(options) {
	const value = createBitwardenSession(options);
	sessions.push(value);
	return value;
}
function deferred() {
	let resolve;
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

afterEach(() => {
	for (const value of sessions.splice(0)) value.dispose();
	for (const fixture of fixtures.splice(0)) fixture.dispose();
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

test("starts locked and does not import an inherited CLI session", async () => {
	vi.stubEnv("BW_SESSION", "fixture-outer-key");
	let calls = 0;
	const value = session({
		execute: async () => {
			calls++;
			return "unused";
		},
	});
	expect(value.status()).toBe("locked");
	await expect(value.run(["list", "items"])).rejects.toThrow("/bw unlock");
	expect(calls).toBe(0);
	expect(process.env.BW_SESSION).toBe("fixture-outer-key");
});

test("password and session use separate child-only environments and never argv", async () => {
	vi.stubEnv("BW_SESSION", "fixture-outer-key");
	vi.stubEnv("BW_PASSWORD", "fixture-legacy-password");
	const calls = [];
	const environments = [];
	const value = session({
		execute: async (args, { env }) => {
			calls.push({
				args,
				password: env.BW_PI_UNLOCK_PASSWORD,
				key: env.BW_SESSION,
				legacy: env.BW_PASSWORD,
			});
			environments.push(env);
			return args[0] === "unlock" ? "fixture-private-key\n" : "[]";
		},
	});
	await expect(value.unlock("fixture-master")).resolves.toBeUndefined();
	expect(value.status()).toBe("unlocked");
	await expect(value.run(["list", "items"])).resolves.toBe("[]");
	expect(calls).toEqual([
		{
			args: [
				"unlock",
				"--raw",
				"--passwordenv",
				"BW_PI_UNLOCK_PASSWORD",
				"--nointeraction",
			],
			password: "fixture-master",
			key: undefined,
			legacy: undefined,
		},
		{
			args: ["list", "items"],
			password: undefined,
			key: "fixture-private-key",
			legacy: undefined,
		},
	]);
	expect(environments[0].BW_PI_UNLOCK_PASSWORD).toBeUndefined();
	expect(environments[1].BW_SESSION).toBeUndefined();
	expect(process.env.BW_SESSION).toBe("fixture-outer-key");
	expect(process.env.BW_PASSWORD).toBe("fixture-legacy-password");
});

test("idle timeout is fifteen minutes and status checks do not renew it", async () => {
	vi.useFakeTimers();
	const value = session({ execute: async () => "fixture-key" });
	await value.unlock("fixture-master");
	await vi.advanceTimersByTimeAsync(14 * 60_000);
	expect(value.status()).toBe("unlocked");
	await vi.advanceTimersByTimeAsync(60_000);
	expect(value.status()).toBe("locked");
	await expect(value.run(["list", "items"])).rejects.toThrow("locked");
});

test("successful credential activity renews the idle timeout", async () => {
	vi.useFakeTimers();
	const value = session({
		execute: async () => "fixture-key",
		idleTimeoutMs: 1000,
	});
	await value.unlock("fixture-master");
	await vi.advanceTimersByTimeAsync(900);
	await value.run(["list", "items"]);
	await vi.advanceTimersByTimeAsync(900);
	expect(value.status()).toBe("unlocked");
	await vi.advanceTimersByTimeAsync(100);
	expect(value.status()).toBe("locked");
});

test("lock aborts pending reads and refuses late output even from an uncooperative runner", async () => {
	const read = deferred();
	let signal;
	const value = session({
		execute: async (args, options) => {
			if (args[0] === "unlock") return "fixture-key";
			signal = options.signal;
			return read.promise;
		},
	});
	await value.unlock("fixture-master");
	const result = value.run(["list", "items"]);
	value.lock();
	expect(signal.aborted).toBe(true);
	read.resolve("fixture-private-item-must-not-be-returned");
	await expect(result).rejects.toThrow("cancelled");
	expect(value.status()).toBe("locked");
});

test("shutdown cannot be undone by a late unlock", async () => {
	vi.useFakeTimers();
	const unlock = deferred();
	let signal;
	const value = session({
		execute: async (_args, options) => {
			signal = options.signal;
			return unlock.promise;
		},
	});
	const result = value.unlock("fixture-master");
	value.dispose();
	expect(signal.aborted).toBe(true);
	unlock.resolve("fixture-late-key");
	await expect(result).rejects.toThrow("cancelled");
	expect(value.status()).toBe("locked");
	expect(vi.getTimerCount()).toBe(0);
	await expect(value.unlock("fixture-master")).rejects.toThrow("closed");
});

test("disposing an unlocked session clears its idle timer and stops further access", async () => {
	vi.useFakeTimers();
	let calls = 0;
	const value = session({
		execute: async () => {
			calls++;
			return "fixture-key";
		},
	});
	await value.unlock("fixture-master");
	expect(vi.getTimerCount()).toBe(1);
	value.dispose();
	expect(vi.getTimerCount()).toBe(0);
	expect(value.status()).toBe("locked");
	await expect(value.run(["list", "items"])).rejects.toThrow("locked");
	expect(calls).toBe(1);
});

test("an older unlock cannot replace a newer session", async () => {
	const first = deferred();
	let attempts = 0;
	let usedKey;
	const value = session({
		execute: async (args, { env }) => {
			if (args[0] !== "unlock") {
				usedKey = env.BW_SESSION;
				return "[]";
			}
			return ++attempts === 1 ? first.promise : "fixture-new-key";
		},
	});
	const old = value.unlock("fixture-first-master");
	await value.unlock("fixture-second-master");
	first.resolve("fixture-old-key");
	await expect(old).rejects.toThrow("cancelled");
	await value.run(["list", "items"]);
	expect(usedKey).toBe("fixture-new-key");
});

test("credential failures clear the local session without leaking process errors", async () => {
	const value = session({
		execute: async (args) => {
			if (args[0] === "unlock") return "fixture-key";
			throw Object.assign(new Error("fixture-secret-error"), {
				stdout: "fixture-private-data",
				stderr: "fixture-key",
			});
		},
	});
	await value.unlock("fixture-master");
	await expect(value.run(["list", "items"])).rejects.toThrow(
		/^Bitwarden credential access failed or was cancelled\./,
	);
	expect(value.status()).toBe("locked");
});

test.each([
	"",
	"multiple words are not a session",
	"fixture\x00key",
	"fixture\x1bkey",
	"x".repeat(8193),
])("rejects an invalid unlock response", async (output) => {
	const value = session({ execute: async () => output });
	await expect(value.unlock("fixture-master")).rejects.toThrow(
		/^Bitwarden unlock failed or was cancelled\./,
	);
	expect(value.status()).toBe("locked");
});

test("unlock failures and their causes cannot reach callers", async () => {
	const value = session({
		execute: async () => {
			throw Object.assign(new Error("fixture-password-in-error"), {
				stdout: "fixture-key",
				stderr: "fixture-master",
				cause: "fixture-private-cause",
			});
		},
	});
	try {
		await value.unlock("fixture-master");
		throw new Error("Expected unlock to fail");
	} catch (error) {
		expect(error.message).toMatch(
			/^Bitwarden unlock failed or was cancelled\./,
		);
		expect(error.stdout).toBeUndefined();
		expect(error.stderr).toBeUndefined();
		expect(error.cause).toBeUndefined();
	}
});

test("the real subprocess path unlocks and reads with separate environments", async () => {
	const fixture = fakeBw('[{"fixture":"metadata"}]');
	fixtures.push(fixture);
	const value = session();
	expect(existsSync(fixture.argsFile)).toBe(false);
	await value.unlock("fixture-master");
	await expect(value.run(["list", "items", "--nointeraction"])).resolves.toBe(
		'[{"fixture":"metadata"}]',
	);
	const args = readFileSync(fixture.argsFile, "utf8");
	expect(args).not.toContain("fixture-master");
	expect(args).not.toContain("fixture-session-key");
	expect(readFileSync(fixture.envFile, "utf8").trim().split("\n")).toEqual([
		"|fixture-master",
		"fixture-session-key|",
	]);
	expect(process.env.BW_SESSION).toBe(
		"fixture-inherited-session-must-be-ignored",
	);
	value.lock();
	await expect(value.run(["list", "items"])).rejects.toThrow("locked");
	// Local lock does not run a CLI command that would invalidate other clients.
	expect(readFileSync(fixture.argsFile, "utf8")).toBe(args);
});

test("a real subprocess failure is sanitized and leaves the adapter locked", async () => {
	const fixture = fakeBw();
	fixtures.push(fixture);
	vi.stubEnv("BW_TEST_EXIT", "1");
	vi.stubEnv("BW_TEST_ERROR", "fixture-private-cli-error");
	const value = session();
	await expect(value.unlock("fixture-master")).rejects.toThrow(
		/^Bitwarden unlock failed or was cancelled\./,
	);
	expect(value.status()).toBe("locked");
});
