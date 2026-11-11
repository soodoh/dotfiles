import { expect, test, vi } from "vitest";
import { createCredentialFill } from "../../node_modules/betterwright/dist/src/credential-fill.js";
import { registerBitwardenTotpTool } from "./bitwarden-totp.ts";
import { createBitwardenVault, totpCredentialId } from "./bitwarden-vault.ts";

const id = "11111111-1111-1111-1111-111111111111";
const origin = "https://app.example.com";
const code = "000123"; // Synthetic, including leading zeros.
const seed = "fixture-authenticator-seed-not-a-real-secret";
const password = "fixture-password-not-a-real-secret";
function item(overrides = {}) {
	return {
		id,
		type: 1,
		reprompt: 0,
		login: {
			username: "fixture-user",
			password,
			totp: seed,
			uris: [{ uri: "https://example.com", match: null }],
		},
		...overrides,
	};
}
function backend(items = [item()], output = code) {
	const run = vi.fn(async (args) =>
		args[0] === "list" ? JSON.stringify(items) : output,
	);
	return { vault: createBitwardenVault(run), run };
}
function tool(execute = vi.fn(async () => loginResult())) {
	let registered;
	registerBitwardenTotpTool(
		{
			registerTool: (value) => {
				registered = value;
			},
		},
		{ execute },
	);
	return { registered, execute };
}
function loginResult(submitted = false, extra = {}) {
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify({
					ok: true,
					result: { id, filled: ["password"], submitted, ...extra },
				}),
			},
		],
		details: { ok: true },
	};
}

test.each(["000123", "01234567"])(
	"TOTP is generated only after site-scoped authorization, preserving zeros: %s",
	async (output) => {
		const { vault, run } = backend([item()], `${output}\n`);
		const metadata = await vault.handleRequest("list", {}, origin);
		expect(metadata.credentials[0]).toMatchObject({ id, hasTotp: true });
		expect(JSON.stringify(metadata)).not.toContain(seed);
		expect(JSON.stringify(metadata)).not.toContain(output);
		const result = await vault.handleRequest(
			"fill",
			{ id: totpCredentialId(id) },
			origin,
		);
		expect(result).toMatchObject({ id, origin, username: "", secret: output });
		expect(JSON.stringify(result)).not.toContain(password);
		expect(JSON.stringify(result)).not.toContain(seed);
		expect(run.mock.calls).toEqual([
			[["list", "items", "--url", origin, "--nointeraction"]],
			[["list", "items", "--url", origin, "--nointeraction"]],
			[["get", "totp", id, "--nointeraction"]],
		]);
	},
);

test.each(
	[
		[],
		[item({ reprompt: 1 })],
		[item({ deletedDate: "2026-01-01" })],
		[
			item({
				login: { password, totp: seed, uris: [{ uri: origin, match: 5 }] },
			}),
		],
		[
			item({
				login: { password, totp: seed, uris: [{ uri: origin, match: 3 }] },
			}),
		],
	].map((items) => ({ items })),
)("TOTP cannot bypass origin or access restrictions: %j", async ({ items }) => {
	const { vault, run } = backend(items);
	await expect(
		vault.handleRequest("fill", { id: totpCredentialId(id) }, origin),
	).rejects.toThrow("No matching");
	expect(run).toHaveBeenCalledTimes(1);
	expect(run.mock.calls[0][0][0]).toBe("list");
});

test("TOTP authorization is not retained from an earlier metadata listing", async () => {
	const run = vi
		.fn()
		.mockResolvedValueOnce(JSON.stringify([item()]))
		.mockResolvedValueOnce("[]");
	const vault = createBitwardenVault(run);
	await vault.handleRequest("list", {}, origin);
	await expect(
		vault.handleRequest("fill", { id: totpCredentialId(id) }, origin),
	).rejects.toThrow("No matching");
	expect(run).toHaveBeenCalledTimes(2);
	expect(run.mock.calls.every(([args]) => args[0] === "list")).toBe(true);
});

test("a missing authenticator never falls back to filling the password", async () => {
	const missing = item();
	delete missing.login.totp;
	const { vault, run } = backend([missing]);
	expect(
		(await vault.handleRequest("list", {}, origin)).credentials[0].hasTotp,
	).toBe(false);
	await expect(
		vault.handleRequest("fill", { id: totpCredentialId(id) }, origin),
	).rejects.toThrow("no authenticator");
	expect(run.mock.calls.every(([args]) => args[0] === "list")).toBe(true);
});

test.each([
	"",
	"12345",
	"1234567",
	"123456789",
	seed,
	'{"code":"000123"}',
	"AB12C",
])(
	"malformed/unsupported TOTP output is not exposed or retried: %s",
	async (output) => {
		const { vault, run } = backend([item()], output);
		await expect(
			vault.handleRequest("fill", { id: totpCredentialId(id) }, origin),
		).rejects.toThrow(/^Bitwarden could not supply a numeric TOTP code\./);
		expect(run).toHaveBeenCalledTimes(2);
	},
);

test("CLI failures cannot leak secret bodies or causes", async () => {
	const run = vi
		.fn()
		.mockResolvedValueOnce(JSON.stringify([item()]))
		.mockRejectedValueOnce(
			Object.assign(new Error(seed), { stdout: code, stderr: password }),
		);
	try {
		await createBitwardenVault(run).handleRequest(
			"fill",
			{ id: totpCredentialId(id) },
			origin,
		);
		throw new Error("Expected rejection");
	} catch (error) {
		expect(error.message).toMatch(
			/^Bitwarden could not supply a numeric TOTP code\./,
		);
		expect(error).not.toHaveProperty("cause");
		expect(error).not.toHaveProperty("stdout");
		expect(error).not.toHaveProperty("stderr");
	}
	expect(run).toHaveBeenCalledTimes(2);
});

test("each TOTP fill reauthorizes and obtains a new code, with no code cache", async () => {
	const run = vi
		.fn()
		.mockResolvedValueOnce(JSON.stringify([item()]))
		.mockResolvedValueOnce("000123")
		.mockResolvedValueOnce(JSON.stringify([item()]))
		.mockResolvedValueOnce("000456");
	const vault = createBitwardenVault(run);
	const request = { id: totpCredentialId(id) };
	expect((await vault.handleRequest("fill", request, origin)).secret).toBe(
		"000123",
	);
	expect((await vault.handleRequest("fill", request, origin)).secret).toBe(
		"000456",
	);
	expect(run).toHaveBeenCalledTimes(4);
});

test.each(["--session=fixture", "totp:", `totp:${id}`, "not-a-uuid"])(
	"dedicated TOTP tool accepts only plain metadata UUIDs: %s",
	async (badId) => {
		const { registered, execute } = tool();
		await expect(
			registered.execute("t", { id: badId, selector: "aria-ref=e22" }),
		).rejects.toThrow("Invalid Bitwarden");
		expect(execute).not.toHaveBeenCalled();
	},
);

test.each([undefined, "", "   ", 42])(
	"an explicit OTP input is required, never password autodetection: %s",
	async (selector) => {
		const { registered, execute } = tool();
		await expect(registered.execute("t", { id, selector })).rejects.toThrow(
			"Explicit TOTP",
		);
		expect(execute).not.toHaveBeenCalled();
	},
);

test.each([false, true])(
	"the tool forwards only trusted-fill options; explicit submission=%s",
	async (submit) => {
		const execute = vi.fn(async () =>
			loginResult(submit, { secret: code, seed, password }),
		);
		const { registered } = tool(execute);
		const signal = new AbortController().signal;
		const ctx = {};
		const progress = vi.fn();
		const result = await registered.execute(
			"t",
			{
				id,
				selector: "aria-ref=e22",
				...(submit ? { submitSelector: "aria-ref=e23" } : {}),
				generate: true,
				usernameSelector: "#other",
			},
			signal,
			progress,
			ctx,
		);
		expect(execute).toHaveBeenCalledWith(
			"t",
			{
				id: totpCredentialId(id),
				passwordSelector: "aria-ref=e22",
				...(submit ? { submitSelector: "aria-ref=e23" } : {}),
			},
			signal,
			undefined,
			ctx,
		);
		expect(result.details).toEqual({
			ok: true,
			id,
			filled: ["totp"],
			submitted: submit,
		});
		for (const secret of [code, seed, password])
			expect(JSON.stringify(result)).not.toContain(secret);
		expect(progress).not.toHaveBeenCalled();
	},
);

test.each([
	async () => {
		throw Object.assign(new Error(seed), { stdout: code });
	},
	async () => ({ content: [{ type: "text", text: code }], details: {} }),
	async () => ({
		content: [
			{ type: "text", text: JSON.stringify({ ok: false, error: seed }) },
		],
	}),
	async () => loginResult(false, { id: "another-id" }),
	async () => loginResult(false, { filled: [] }),
])(
	"failed or malformed downstream results produce only a static outcome warning",
	async (execute) => {
		const { registered } = tool(execute);
		await expect(
			registered.execute("t", { id, selector: "#otp" }),
		).rejects.toThrow(/^TOTP fill failed or its outcome is unknown\./);
	},
);

test("cancellation is checked before dispatch and after a late fill", async () => {
	const controller = new AbortController();
	controller.abort();
	const { registered, execute } = tool();
	await expect(
		registered.execute("t", { id, selector: "#otp" }, controller.signal),
	).rejects.toThrow("cancelled");
	expect(execute).not.toHaveBeenCalled();
	const late = new AbortController();
	const second = tool(
		vi.fn(async () => {
			late.abort();
			return loginResult(true);
		}),
	);
	await expect(
		second.registered.execute("t", { id, selector: "#otp" }, late.signal),
	).rejects.toThrow("outcome is unknown");
});

// Actual stock worker fill implementation; DOM handles and CLI are synthetic.
// This verifies explicit non-password targets, target-origin scoping, secret
// tracking before input, and metadata-only return without launching a browser.
test.each([false, true])(
	"stock worker uses explicit TOTP targets; submission=%s",
	async (submit) => {
		const { vault, run } = backend();
		const events = [];
		const frame = {
			isDetached: () => false,
			parentFrame: () => null,
			url: () => origin,
			evaluate: async () => `${origin}/mfa`,
		};
		const target = {
			ownerFrame: async () => frame,
			dispose: vi.fn(async () => {}),
			waitForElementState: vi.fn(async () => {}),
			fill: vi.fn(async (value) => {
				events.push(["fill", value]);
			}),
			press: vi.fn(async () => {}),
		};
		const submitTarget = { dispose: vi.fn(async () => {}) };
		const locator = (selector) => ({
			first: () => ({
				elementHandle: async () =>
					selector === "#verify" ? submitTarget : target,
			}),
		});
		frame.locator = locator;
		const page = { mainFrame: () => frame, locator };
		const click = vi.fn();
		const worker = createCredentialFill({
			rpc: async (_method, request) =>
				vault.handleRequest(request.action, request.payload, request.origin),
			trackSecret: (value) => events.push(["track", value]),
			redactDeep: (value) => value,
			ensureSessionPage: async () => page,
			humanClickTarget: click,
			actionTimeoutMs: 100,
		});
		const result = await worker.performCredentialFill(
			{ id: "fixture", execution: {} },
			{
				action: "fill",
				record: { id: totpCredentialId(id) },
				fields: {
					passwordSelector: "#otp",
					...(submit ? { submitSelector: "#verify" } : {}),
				},
			},
		);
		expect(target.fill).toHaveBeenCalledWith(code, expect.any(Object));
		expect(events.findIndex(([kind]) => kind === "track")).toBeLessThan(
			events.findIndex(([kind]) => kind === "fill"),
		);
		expect(run.mock.calls[0][0]).toEqual([
			"list",
			"items",
			"--url",
			origin,
			"--nointeraction",
		]);
		for (const secret of [code, seed, password])
			expect(JSON.stringify(result)).not.toContain(secret);
		expect(result).toMatchObject({
			id,
			submitted: submit,
			filled: ["password"],
		});
		expect(events).toContainEqual(["track", code]);
		expect(click).toHaveBeenCalledTimes(submit ? 2 : 1);
		if (submit) expect(click.mock.calls.at(-1)[2]).toBe(submitTarget);
		expect(target.dispose).toHaveBeenCalledOnce();
	},
);

test.each(["missing", "detached", "changed-origin"])(
	"stock worker rejects %s OTP targets before any vault access",
	async (mode) => {
		const rpc = vi.fn();
		const frame = {
			isDetached: () => mode === "detached",
			parentFrame: () => null,
			url: () => origin,
			evaluate: async () => "https://other.example.net/mfa",
		};
		const target = {
			ownerFrame: async () => frame,
			dispose: vi.fn(async () => {}),
		};
		const page = {
			mainFrame: () => frame,
			locator: () => ({
				first: () => ({
					elementHandle: async () => (mode === "missing" ? null : target),
				}),
			}),
		};
		const worker = createCredentialFill({
			rpc,
			trackSecret: vi.fn(),
			redactDeep: (value) => value,
			ensureSessionPage: async () => page,
			humanClickTarget: vi.fn(),
			actionTimeoutMs: 100,
		});
		await expect(
			worker.performCredentialFill(
				{ id: "fixture", execution: {} },
				{
					action: "fill",
					record: { id: totpCredentialId(id) },
					fields: { passwordSelector: "#otp" },
				},
			),
		).rejects.toThrow(/explicit credential/);
		expect(rpc).not.toHaveBeenCalled();
	},
);
