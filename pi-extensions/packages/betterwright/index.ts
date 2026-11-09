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
