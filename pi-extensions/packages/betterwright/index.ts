import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiExtension } from "betterwright/pi-extension";
import { registerBitwardenCommands } from "./bitwarden-commands.ts";
import { createBitwardenSession } from "./bitwarden-session.ts";
import { createBitwardenVault } from "./bitwarden-vault.ts";

export default function extension(pi: ExtensionAPI) {
	// One private session per Pi extension instance, not per browser restart.
	const session = createBitwardenSession();
	registerBitwardenCommands(pi, session);
	createPiExtension({
		guardrails: {
			extraRules: [
				"Tool routing takes precedence over generic instructions to use browser for live-web navigation or research. Choose the specialized tool for the requested capability; a URL alone does not require browser use.",
				"Use web_search for public-web research, fetch_content/get_search_content for retrieved content, and Context7 or the designated documentation service for library/API documentation.",
				"For service data or operations, use the designated MCP tools or service skill. If the tool is not loaded, discover it with tool_search before considering browser fallback; not loaded does not mean unavailable.",
				"Use BetterWright when the requested outcome requires UI interaction, visual verification, or content unavailable through an appropriate specialized tool. This includes UI testing of services that also have MCP tools. Before a browser fallback, briefly state the capability gap or observed failure that requires it.",
				"Handle failures by cause: refine empty searches, use bounded retries for transient read failures, and resolve or report authentication/authorization failures rather than switching credentials or access paths. An unsupported capability may justify an authorized browser fallback; preserve the selected account, environment, and read-only limits.",
				"In Pi, use the native browser tools; the browser skill’s CLI commands are for other hosts.",
				"Bitwarden is the only credential store. Use browser_login or credentials.list()/fill() through the read-only bw adapter; BetterWright's local vault, credential writes, and generated-password workflows are disabled.",
				"Never run bw list/get/export through agent-visible shell tools or inspect passwords or session keys. Only the human may invoke /bw unlock, /bw lock, and /bw status; never attempt to invoke these commands through a tool.",
				"During human credential entry, pause browser actions, observations, screenshots, and recordings until the user confirms completion.",
			],
		},
		browserOptions: {
			vault: createBitwardenVault(session.run),
			credentialCapture: false,
			liveView: { host: "127.0.0.1", publicHost: "127.0.0.1" },
		},
	})(pi);
}
