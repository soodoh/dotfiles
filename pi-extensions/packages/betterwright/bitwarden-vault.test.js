import { expect, test, vi } from "vitest";
import { createBitwardenVault } from "./bitwarden-vault.ts";

const origin = "https://app.example.com";
const id = "11111111-1111-1111-1111-111111111111";
const otherId = "22222222-2222-2222-2222-222222222222";
const password = "fixture-password-not-a-real-secret";

function login(overrides = {}) {
	return {
		id,
		type: 1,
		name: "Personal account",
		reprompt: 0,
		notes: "fixture-private-note",
		fields: [{ name: "private", value: "fixture-custom-secret" }],
		login: {
			username: "person@example.com",
			password,
			totp: "fixture-totp-secret",
			uris: [{ uri: `${origin}/login`, match: null }],
		},
		...overrides,
	};
}

function backend(items) {
	const run = vi.fn(async () => JSON.stringify(items));
	return { vault: createBitwardenVault(run), run };
}

test("list exposes only site-scoped login metadata", async () => {
	const { vault, run } = backend([login()]);
	const result = await vault.handleRequest("list", {}, origin);
	expect(result.credentials).toEqual([
		{
			id,
			origin,
			matchMode: "exact-origin",
			category: "login",
			username: "person@example.com",
			label: "Personal account",
		},
	]);
	for (const secret of [
		password,
		"fixture-private-note",
		"fixture-custom-secret",
		"fixture-totp-secret",
	])
		expect(JSON.stringify(result)).not.toContain(secret);
	expect(run).toHaveBeenCalledWith([
		"list",
		"items",
		"--url",
		origin,
		"--nointeraction",
	]);
});

test("metadata search ignores secrets and filters by account label or username", async () => {
	const { vault } = backend([login()]);
	expect(
		(await vault.handleRequest("list", { text: "PERSONAL" }, origin))
			.credentials,
	).toHaveLength(1);
	expect(
		(await vault.handleRequest("list", { text: "person@example.com" }, origin))
			.credentials,
	).toHaveLength(1);
	expect(
		(await vault.handleRequest("list", { text: password }, origin)).credentials,
	).toEqual([]);
});

test.each([
	"http://app.example.com/login",
	"https://other.example.com/login",
	"https://app.example.com:8443/login",
	"https://app.example.com.evil.test/login",
	"https://attacker@app.example.com/login",
	"file:///tmp/login",
	"not a URL",
])(
	"CLI URL filtering is independently narrowed before fill: %s",
	async (uri) => {
		const item = login();
		item.login.uris = [{ uri, match: null }];
		const { vault } = backend([item]);
		expect((await vault.handleRequest("list", {}, origin)).credentials).toEqual(
			[],
		);
		await expect(vault.handleRequest("fill", { id }, origin)).rejects.toThrow(
			"No matching",
		);
	},
);

test("URI matching normalizes hostnames and effective ports without using paths as domains", async () => {
	const item = login();
	item.login.uris = [{ uri: "https://APP.example.com:443/sign-in", match: 1 }];
	const { vault } = backend([item]);
	expect(
		(await vault.handleRequest("list", {}, origin)).credentials,
	).toHaveLength(1);
});

test("an explicit HTTP localhost URI supports a password-only development login", async () => {
	const localOrigin = "http://localhost:3000";
	const item = login();
	item.login.username = null;
	item.login.uris = [{ uri: `${localOrigin}/login`, match: 0 }];
	const { vault } = backend([item]);
	await expect(
		vault.handleRequest("fill", { id }, localOrigin),
	).resolves.toMatchObject({
		origin: localOrigin,
		username: "",
		secret: password,
	});
});

test("an item can match through a second eligible URI", async () => {
	const item = login();
	item.login.uris = [
		{ uri: origin, match: 5 },
		{ uri: "https://other.example.com", match: 0 },
		{ uri: `${origin}/login`, match: 0 },
	];
	const { vault } = backend([item]);
	await expect(
		vault.handleRequest("fill", { id }, origin),
	).resolves.toMatchObject({ id });
});

test.each([2, 3, 4, 5, 99])(
	"does not broaden URI match rule %s",
	async (match) => {
		const item = login();
		item.login.uris = [{ uri: origin, match }];
		const { vault } = backend([item]);
		expect((await vault.handleRequest("list", {}, origin)).credentials).toEqual(
			[],
		);
	},
);

test.each([
	{ reprompt: 1 },
	{ deletedDate: "2026-01-01T00:00:00Z" },
	{ type: 2 },
	{ id: "not-an-item-id" },
	{ login: { password: "", uris: [{ uri: origin }] } },
	{ login: null },
])(
	"does not offer unusable or access-restricted items: %j",
	async (overrides) => {
		const { vault } = backend([login(overrides)]);
		expect((await vault.handleRequest("list", {}, origin)).credentials).toEqual(
			[],
		);
	},
);

test("fill returns the selected password only through the internal response", async () => {
	const { vault } = backend([
		login(),
		login({ id: otherId, name: "Work account" }),
	]);
	await expect(
		vault.handleRequest("fill", { id }, origin),
	).resolves.toMatchObject({
		id,
		username: "person@example.com",
		secret: password,
	});
	await expect(vault.handleRequest("fill", {}, origin)).rejects.toThrow(
		"Multiple credentials",
	);
	await expect(
		vault.handleRequest("fill", { id, username: "wrong-account" }, origin),
	).rejects.toThrow("No matching");
});

test("a unique login can be selected automatically or by username", async () => {
	const { vault } = backend([login()]);
	await expect(vault.handleRequest("fill", {}, origin)).resolves.toMatchObject({
		id,
		secret: password,
	});
	await expect(
		vault.handleRequest("fill", { username: "person@example.com" }, origin),
	).resolves.toMatchObject({ id });
});

test("fill revalidates an item moved to another site after listing", async () => {
	const moved = login();
	moved.login.uris = [{ uri: "https://unrelated.test", match: null }];
	const run = vi
		.fn()
		.mockResolvedValueOnce(JSON.stringify([login()]))
		.mockResolvedValueOnce(JSON.stringify([moved]));
	const vault = createBitwardenVault(run);
	expect(
		(await vault.handleRequest("list", {}, origin)).credentials,
	).toHaveLength(1);
	await expect(vault.handleRequest("fill", { id }, origin)).rejects.toThrow(
		"No matching",
	);
	expect(run).toHaveBeenCalledTimes(2);
});

test.each([
	"save",
	"update",
	"remove",
	"generate",
	"commit",
	"discard",
	"ownerReveal",
])("refuses %s without invoking bw", async (action) => {
	const { vault, run } = backend([login()]);
	await expect(vault.handleRequest(action, {}, origin)).rejects.toThrow(
		"read-only",
	);
	expect(run).not.toHaveBeenCalled();
});

test.each([
	"about:blank",
	"file:///tmp/test",
	`${origin}/path`,
	`${origin}?code=fixture`,
	"https://user:pass@app.example.com",
])(
	"rejects an invalid current origin before accessing bw: %s",
	async (current) => {
		const { vault, run } = backend([login()]);
		await expect(vault.handleRequest("fill", { id }, current)).rejects.toThrow(
			"HTTP(S) origin",
		);
		expect(run).not.toHaveBeenCalled();
	},
);

test("rejects malformed payloads and command-like identifiers before accessing bw", async () => {
	const { vault, run } = backend([login()]);
	await expect(vault.handleRequest("list", null, origin)).rejects.toThrow(
		"Invalid",
	);
	await expect(
		vault.handleRequest("list", { text: {} }, origin),
	).rejects.toThrow("Invalid");
	await expect(
		vault.handleRequest("fill", { id: "--session=fixture" }, origin),
	).rejects.toThrow("Invalid");
	expect(run).not.toHaveBeenCalled();
});

test("unsupported categories and pending generations expose no records", async () => {
	const { vault, run } = backend([login()]);
	await expect(
		vault.handleRequest("list", { category: "credit-card" }, origin),
	).resolves.toEqual({ credentials: [] });
	await expect(
		vault.handleRequest("list-pending", {}, origin),
	).resolves.toEqual({ pendingCredentials: [] });
	expect(run).not.toHaveBeenCalled();
});

test.each([
	"not-json-fixture-private-data",
	'{"password":"fixture-private-data"}',
])("malformed CLI responses never appear in errors", async (output) => {
	const vault = createBitwardenVault(vi.fn(async () => output));
	await expect(vault.handleRequest("list", {}, origin)).rejects.toThrow(
		"Bitwarden CLI returned an invalid response.",
	);
});

test("subprocess failures cannot expose stdout, stderr, or a session token", async () => {
	const run = vi.fn(async () => {
		throw Object.assign(new Error("fixture-secret-in-stderr"), {
			stdout: password,
			stderr: "BW_SESSION=fixture-token",
		});
	});
	const vault = createBitwardenVault(run);
	try {
		await vault.handleRequest("list", {}, origin);
		throw new Error("Expected the CLI failure to reject");
	} catch (error) {
		expect(error.message).toMatch(/^Bitwarden CLI unavailable or locked\./);
		expect(error).not.toHaveProperty("stdout");
		expect(error).not.toHaveProperty("stderr");
		expect(error).not.toHaveProperty("cause");
	}
});
