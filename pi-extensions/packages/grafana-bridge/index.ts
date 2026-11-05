// Standalone MCP launcher, not a Pi extension entry point.
// The mise-pinned Node runtime executes TypeScript directly without a build.
import { runBridge } from "./bridge.ts";

if (import.meta.main) {
	runBridge().catch(() => {
		process.stderr.write(
			"[grafana-bridge] Could not run the Grafana MCP bridge; check configuration and installed tools.\n",
		);
		process.exitCode = 1;
	});
}
