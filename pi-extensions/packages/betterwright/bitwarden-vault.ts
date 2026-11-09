import type { CredentialVault } from "betterwright";

const itemId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type CliRunner = (args: string[]) => Promise<string>;

function object(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function httpUrl(value: unknown): URL | null {
	if (typeof value !== "string") return null;
	try {
		const url = new URL(value);
		return (url.protocol === "https:" || url.protocol === "http:") &&
			!url.username &&
			!url.password
			? url
			: null;
	} catch {
		return null;
	}
}

function matchesOrigin(value: unknown, origin: string): boolean {
	const uri = object(value);
	// BetterWright supplies only the origin. Do not broaden Never, exact-URL,
	// starts-with, or regex rules that may restrict a particular path.
	if (!uri || (uri.match != null && uri.match !== 0 && uri.match !== 1))
		return false;
	return httpUrl(uri.uri)?.origin === origin;
}

function matchingLogin(value: unknown, origin: string) {
	const item = object(value);
	const login = object(item?.login);
	if (
		item?.type !== 1 ||
		item.deletedDate != null ||
		(item.reprompt != null && item.reprompt !== 0) ||
		typeof item.id !== "string" ||
		!itemId.test(item.id) ||
		!login ||
		typeof login.password !== "string" ||
		!login.password ||
		!Array.isArray(login.uris) ||
		!login.uris.some((uri) => matchesOrigin(uri, origin))
	)
		return null;
	return {
		id: item.id,
		origin,
		matchMode: "exact-origin",
		category: "login",
		username: typeof login.username === "string" ? login.username : "",
		label: typeof item.name === "string" ? item.name : null,
		secret: login.password,
	};
}

function optionalText(value: unknown): string | undefined {
	if (value == null) return undefined;
	if (typeof value !== "string" || value.length > 1024)
		throw new Error("Invalid Bitwarden credential selector.");
	return value;
}

/** Read-only Bitwarden CLI backend for BetterWright's trusted credential seam. */
export function createBitwardenVault(run: CliRunner): CredentialVault {
	async function matchingLogins(origin: string) {
		let output: string;
		try {
			// bw returns decrypted items. Keep stdout inside this trusted adapter;
			// never include subprocess errors, stderr, or raw JSON in tool results.
			output = await run(["list", "items", "--url", origin, "--nointeraction"]);
		} catch {
			throw new Error(
				"Bitwarden CLI unavailable or locked. Use /bw status or /bw unlock in Pi; configure and log in to bw manually if needed.",
			);
		}
		let items: unknown;
		try {
			items = JSON.parse(output);
		} catch {
			throw new Error("Bitwarden CLI returned an invalid response.");
		}
		if (!Array.isArray(items))
			throw new Error("Bitwarden CLI returned an invalid response.");
		return items
			.map((item) => matchingLogin(item, origin))
			.filter((item) => item !== null);
	}

	return {
		async handleRequest(action, payload, origin) {
			if (action !== "list" && action !== "fill" && action !== "list-pending")
				throw new Error(
					"The Bitwarden CLI adapter is read-only; use Bitwarden directly to manage credentials.",
				);
			const url = httpUrl(origin);
			if (!url || url.origin !== origin)
				throw new Error("Credentials require a canonical HTTP(S) origin.");
			const input = object(payload);
			if (!input) throw new Error("Invalid Bitwarden credential request.");
			if (action === "list-pending") return { pendingCredentials: [] };
			if (action === "list") {
				if (input.category != null && input.category !== "login")
					return { credentials: [] };
				const text = optionalText(input.text)?.trim().toLocaleLowerCase() ?? "";
				const matches = await matchingLogins(origin);
				return {
					credentials: matches
						.filter((item) =>
							`${item.username} ${item.label ?? ""}`
								.toLocaleLowerCase()
								.includes(text),
						)
						.map(({ secret: _secret, ...metadata }) => metadata),
				};
			}

			const id = optionalText(input.id);
			const username = optionalText(input.username);
			if (id !== undefined && !itemId.test(id))
				throw new Error("Invalid Bitwarden credential id.");
			// Re-query on every fill: a previous list does not authorize an item
			// whose URI, reprompt, trash status, or credentials have since changed.
			const matches = (await matchingLogins(origin)).filter(
				(item) =>
					(id === undefined || item.id === id) &&
					(username === undefined || item.username === username),
			);
			if (matches.length > 1)
				throw new Error(
					"Multiple credentials match this site. List credentials and choose one by id.",
				);
			if (!matches[0])
				throw new Error(
					"No matching Bitwarden login is available for this origin.",
				);
			// Only this internal fill response carries a secret. BetterWright
			// consumes it in the worker and redacts it from model-visible output.
			return matches[0];
		},
	};
}
