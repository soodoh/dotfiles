// Native effective settings and credential-free footer installation.
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	createSessionFixture,
	runSessionWorker,
} from "../../test-support/pi-host.mjs";

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
	let askForModels = false;
	const fixture = await createSessionFixture(hostRoot, {
		paths: [fileURLToPath(new URL("./index.ts", import.meta.url))],
		settings: {
			statusline: { sections: ["context"] },
			compaction: { enabled: false },
			enabledModels: ["fixture/fixture"],
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
		tools: ["review_loop_models"],
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
		respond: () => {
			if (askForModels) {
				askForModels = false;
				return {
					stopReason: "toolUse",
					content: [
						{
							type: "toolCall",
							id: "review-models",
							name: "review_loop_models",
							arguments: {},
						},
					],
				};
			}
			return { content: [{ type: "text", text: "Done" }] };
		},
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
		askForModels = true;
		await fixture.session.prompt("Check the review loop model candidates");
		const modelResult = fixture.session.messages.find(
			(message) =>
				message.role === "toolResult" && message.toolCallId === "review-models",
		);
		assert.ok(
			modelResult,
			`Missing review model result; tools: ${api.getActiveTools().join(", ")}`,
		);
		assert.ok(!modelResult.isError, JSON.stringify(modelResult.content));
		const modelList = JSON.parse(modelResult.content[0].text);
		assert.deepEqual(
			modelList.eligible.map(({ id }) => id),
			["fixture/fixture"],
		);
		assert.equal(
			providerReads,
			1,
			"The review tool should only read the model catalogue",
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
		"PASS statusline: native settings, omitted-provider isolation, and cache-only review model tool",
	);
}
