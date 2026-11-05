// Actual pinned Grafana binary, synthetic Azure CLI, local Grafana API only.
import assert from "node:assert/strict";
import { once } from "node:events";
import { rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { connect, initialize, sandbox, work } from "./test-support/client.ts";

assert.ok(
	process.argv[2],
	'Pass the actual binary: "$(mise which mcp-grafana)"',
);

test("official Grafana binary accepts refreshed tokens in the same bridge session", async () => {
	const box = sandbox();
	let expected = "fixture-before";
	const grafana = createServer((request, response) => {
		const authorized = request.headers.authorization === `Bearer ${expected}`;
		response.writeHead(authorized ? 200 : 401, {
			"Content-Type": "application/json",
		});
		response.end(
			JSON.stringify(
				authorized
					? request.url.startsWith("/api/datasources")
						? []
						: { version: "12.0.0", database: "ok" }
					: { message: "expired fixture token" },
			),
		);
	});
	grafana.listen(0, "127.0.0.1");
	await once(grafana, "listening");
	rmSync(join(box.bin, "mcp-grafana"));
	symlinkSync(process.argv[2], join(box.bin, "mcp-grafana"));
	const client = connect(
		{
			...work["grafana-dev"],
			env: {
				...work["grafana-dev"].env,
				GRAFANA_URL: `http://127.0.0.1:${grafana.address().port}`,
			},
		},
		box.env,
	);
	try {
		await initialize(client);
		assert.ok(
			(await client.call("tools/list")).result.tools.some(
				(tool) => tool.name === "list_datasources",
			),
		);
		assert.notEqual(
			(
				await client.call("tools/call", {
					name: "list_datasources",
					arguments: {},
				})
			).result.isError,
			true,
		);
		expected = "fixture-after";
		box.update({ token: expected });
		assert.equal(
			(
				await client.call("tools/call", {
					name: "list_datasources",
					arguments: {},
				})
			).result.isError,
			true,
		);
		assert.notEqual(
			(
				await client.call("tools/call", {
					name: "list_datasources",
					arguments: {},
				})
			).result.isError,
			true,
		);
	} finally {
		await client.close();
		await new Promise((resolve) => grafana.close(resolve));
		box.remove();
	}
});
