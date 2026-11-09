import { createPiExtension } from "betterwright/pi-extension";

// Bitwarden owns secrets; BetterWright owns only browser state and automation.
export default createPiExtension({
	guardrails: {
		extraRules: [
			"In Pi, use the native browser tools; the browser skill’s CLI commands are for other hosts.",
			"Bitwarden is the only credential store. Use its unlocked extension or human login; BetterWright vault and generated-password workflows are disabled.",
			"During human credential entry, pause browser actions, observations, screenshots, and recordings until the user confirms completion.",
		],
	},
	browserOptions: {
		vault: false,
		credentialCapture: false,
		liveView: { host: "127.0.0.1", publicHost: "127.0.0.1" },
	},
});
