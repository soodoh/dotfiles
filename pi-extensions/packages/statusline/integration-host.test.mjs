// Native effective settings and credential-free footer installation.
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	createSessionFixture,
	runSessionWorker,
} from "../../test-support/session-host.mjs";

if (process.argv[2] !== "worker") {
	runSessionWorker(process.argv[2], new URL(import.meta.url));
} else {
	const hostRoot = process.argv[3];
	const pi = await import(pathToFileURL(join(hostRoot, "dist/index.js")).href);
	pi.initTheme("dark");
	const { theme } = await import(
		pathToFileURL(join(hostRoot, "dist/modes/interactive/theme/theme.js")).href
	);
	let footer;
	let api;
	let providerReads = 0;
	const fixture = await createSessionFixture(hostRoot, {
		paths: [fileURLToPath(new URL("./index.ts", import.meta.url))],
		settings: {
			statusline: { sections: ["context"] },
			compaction: { enabled: false },
		},
		factories: [
			(extensionApi) => {
				api = extensionApi;
				api.on("session_start", (_event, ctx) => {
					for (const method of ["getAvailable", "getProviderAuth"]) {
						const original = ctx.modelRegistry[method].bind(ctx.modelRegistry);
						ctx.modelRegistry[method] = (...args) => {
							providerReads++;
							return original(...args);
						};
					}
				});
			},
		],
		mode: "tui",
		uiContext: {
			setFooter(factory) {
				footer?.dispose?.();
				footer = factory?.({ requestRender() {} }, theme, {
					getGitBranch: () => undefined,
					getExtensionStatuses: () => new Map(),
					getAvailableProviderCount: () => 0,
					onBranchChange: () => () => {},
				});
			},
		},
		respond: () => ({ content: [{ type: "text", text: "Done" }] }),
	});
	try {
		assert.ok(footer);
		const render = () => footer.render(120).join("\n");
		assert.match(render(), /128k/);
		assert.doesNotMatch(render(), /Fixture|off|\u{F0068}/u);
		await fixture.session.prompt("Check native statusline settings");
		assert.equal(
			providerReads,
			0,
			"Omitted provider_usage performed auth/discovery",
		);
		assert.equal(api.getSettings().compaction.enabled, false);
		fixture.session.settingsManager.setCompactionEnabled(true);
		assert.match(render(), /\u{F0068}/u);
		assert.deepEqual(fixture.errors, []);
	} finally {
		footer?.dispose?.();
		fixture.session.dispose();
	}
	console.log(
		"PASS statusline: native effective layout/compaction settings and omitted-provider isolation",
	);
}
