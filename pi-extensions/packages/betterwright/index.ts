import { createPiExtension } from "betterwright/pi-extension";

// Bitwarden owns secrets; BetterWright owns only browser state and automation.
export default createPiExtension({
	browserOptions: {
		vault: false,
		credentialCapture: false,
		liveView: { host: "127.0.0.1", publicHost: "127.0.0.1" },
	},
});
