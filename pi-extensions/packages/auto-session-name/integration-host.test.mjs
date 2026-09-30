// Native runtime title routing/auth and durable ownership across reload.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createSessionFixture,
	runSessionWorker,
} from "../../test-support/session-host.mjs";

if (process.argv[2] !== "worker") {
	runSessionWorker(process.argv[2], new URL(import.meta.url));
} else {
	const configuration = {
		autoSessionName: { titleModel: ["fixture/title-router"] },
	};
	writeFileSync(
		join(process.env.PI_CODING_AGENT_DIR, "settings.json"),
		JSON.stringify(configuration),
	);
	const decoy = join(process.env.HOME, ".pi/agent");
	mkdirSync(decoy, { recursive: true });
	writeFileSync(
		join(decoy, "settings.json"),
		JSON.stringify({ autoSessionName: { enabled: false } }),
	);
	let api;
	const requests = [];
	const routes = [];
	const fixture = await createSessionFixture(process.argv[3], {
		paths: [fileURLToPath(new URL("./auto-session-name.ts", import.meta.url))],
		factories: [
			(extensionApi) => {
				api = extensionApi;
			},
		],
		respond: (model, _context, options) => {
			if (options.maxTokens === 128) {
				requests.push({ model, options });
				return {
					content: [{ type: "text", text: "Repair OB-1234 Login Callback" }],
				};
			}
			return { content: [{ type: "text", text: "Done" }] };
		},
	});
	const physical = fixture.modelRuntime
		.getModels()
		.find((model) => model.provider === "fixture" && model.id === "fixture");
	assert.ok(physical);
	fixture.modelRuntime.registerVirtualModel({
		provider: "fixture",
		id: "title-router",
		name: "Fixture title router",
		input: ["text"],
		maxTokens: 256,
		route: (request) => {
			routes.push({
				reason: request.reason,
				thinkingLevel: request.thinkingLevel,
			});
			return { model: physical, thinkingLevel: request.thinkingLevel };
		},
	});
	// Inject a deterministic auth result at the credential boundary. The *native*
	// stream runtime must propagate its endpoint/headers to the provider adapter.
	const getAuth = fixture.modelRuntime.getAuth.bind(fixture.modelRuntime);
	fixture.modelRuntime.getAuth = async (...args) => {
		const resolved = await getAuth(...args);
		return {
			...resolved,
			auth: {
				...resolved.auth,
				baseUrl: "https://authenticated-endpoint.invalid",
				headers: { "x-fixture-auth": "resolved" },
			},
		};
	};
	try {
		await fixture.session.prompt("Fix the login callback in OB-1234");
		assert.equal(
			fixture.session.sessionManager.getSessionName(),
			"Repair OB-1234 Login Callback",
		);
		assert.equal(requests.length, 1);
		assert.deepEqual(routes, [{ reason: "direct", thinkingLevel: "off" }]);
		assert.equal(requests[0].model.id, "fixture");
		assert.equal(
			requests[0].model.baseUrl,
			"https://authenticated-endpoint.invalid",
		);
		assert.equal(requests[0].options.headers["x-fixture-auth"], "resolved");
		assert.equal(requests[0].options.apiKey, "fixture-key");
		assert.equal(requests[0].options.reasoning, undefined);
		assert.equal(requests[0].options.maxRetries, 0);
		api.setSessionName("User-owned title");
		api.setSessionName("Repair OB-1234 Login Callback");
		await fixture.session.reload();
		const states = fixture.session.sessionManager
			.getBranch()
			.filter(
				(entry) =>
					entry.type === "custom" &&
					entry.customType === "auto-session-name-state",
			);
		assert.equal(states.at(-1).data.ownershipReleased, true);
		await fixture.session.prompt(
			"Actually pivot to a database migration instead",
		);
		assert.equal(
			requests.length,
			1,
			"Reload reclaimed manually surrendered ownership",
		);
		assert.equal(
			fixture.session.sessionManager.getSessionName(),
			"Repair OB-1234 Login Callback",
		);
		assert.deepEqual(fixture.errors, []);
	} finally {
		fixture.session.dispose();
	}
	console.log(
		"PASS auto names: configured agent directory, virtual routing, resolved auth endpoint and durable manual ownership",
	);
}
