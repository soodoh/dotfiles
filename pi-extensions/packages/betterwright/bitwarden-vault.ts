import type { CredentialVault } from "betterwright";

const itemId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
type CliRunner = (args: string[]) => Promise<string>;
const totpPrefix = "totp:";

/** Internal selector for the stock worker's trusted secret-fill channel. */
export function totpCredentialId(id: string): string {
	if (typeof id !== "string" || !itemId.test(id))
		throw new Error("Invalid Bitwarden credential id.");
	return `${totpPrefix}${id}`;
}

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

function supportsOriginOnlyMatching(value: unknown): boolean {
	if (!Array.isArray(value) || !value.length) return false;
	let hasSupportedUri = false;
	for (const entry of value) {
		const uri = object(entry);
		if (!uri || typeof uri.uri !== "string" || !uri.uri.trim()) return false;
		if (uri.match == null || uri.match === 0 || uri.match === 1) {
			// Default / Base domain / Host: trust bw --url for the supplied origin.
			// Default inherits the CLI's strategy; do not assume Base domain or
			// claim full-page URL matching when the SDK supplies only an origin.
			hasSupportedUri = true;
		} else if (uri.match !== 5) {
			// The CLI returns items, not the URI that matched. Reject the whole
			// item if any URI has an explicit URL-based or unknown rule.
			return false;
		}
		// Never cannot authorize an item, but another supported URI can.
	}
	return hasSupportedUri;
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
		!supportsOriginOnlyMatching(login.uris)
	)
		return null;
	return {
		id: item.id,
		origin,
		// Bind delivery to this request's origin, not the saved URI's host.
		matchMode: "exact-origin",
		category: "login",
		username: typeof login.username === "string" ? login.username : "",
		label: typeof item.name === "string" ? item.name : null,
		hasTotp: typeof login.totp === "string" && Boolean(login.totp.trim()),
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
			// bw --url is authoritative for Default/domain/host matching. Never replace it
			// with an unscoped list or get-by-id. Decrypted stdout stays here;
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

			const selector = optionalText(input.id);
			const isTotp = selector?.startsWith(totpPrefix) === true;
			const id = isTotp ? selector?.slice(totpPrefix.length) : selector;
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
					"No matching Bitwarden login is available for this origin. This adapter supports Default, Base domain and Host URI rules (plus Never); explicit Exact, Regular expression and Starts with rules are unsupported.",
				);
			if (isTotp) {
				if (!matches[0].hasTotp)
					throw new Error(
						"The selected Bitwarden login has no authenticator configured.",
					);
				let code: string;
				try {
					// Only after current-origin authorization. Bitwarden generates the
					// code and enforces its own TOTP access/premium policy; no seed
					// parsing, local generator, clipboard, cache, or CLI retry.
					const output = await run([
						"get",
						"totp",
						matches[0].id,
						"--nointeraction",
					]);
					if (typeof output !== "string") throw new Error();
					code = output.trim();
					if (!/^(?:\d{6}|\d{8})$/.test(code)) throw new Error();
				} catch {
					throw new Error(
						"Bitwarden could not supply a numeric TOTP code. Check authenticator configuration, CLI access and TOTP entitlement.",
					);
				}
				// The stock worker tracks/redacts this code before filling the
				// explicitly selected OTP field. Never return the seed or password.
				return { ...matches[0], username: "", secret: code };
			}
			// Only this internal fill response carries a secret. BetterWright
			// consumes it in the worker and redacts it from model-visible output.
			return matches[0];
		},
	};
}
