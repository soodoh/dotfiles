import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	parseWorkflowScript,
	runWorkflow,
} from "@quintinshaw/pi-dynamic-workflows";

const workflowPath = fileURLToPath(
	new URL(
		"../dotfiles/work/pi/workflows/saved/review-loop.json",
		import.meta.url,
	),
);
const workflow = JSON.parse(readFileSync(workflowPath, "utf8"));

test("saved review loop parses and executes through the public runtime", async () => {
	const parsed = parseWorkflowScript(workflow.script);
	assert.equal(parsed.meta.name, "review_loop");
	assert.equal(parsed.meta.phases.length, 4);
	assert.ok(parsed.body.length > 0);

	let calls = 0;
	const execution = await runWorkflow(workflow.script, {
		args: { maxRounds: "1" },
		agent: {
			async run() {
				calls++;
			},
		},
		agentRegistry: new Map(),
		persistLogs: false,
	});
	assert.equal(execution.result.terminationReason, "unknown-arguments");
	assert.equal(execution.agentCount, 0);
	assert.equal(calls, 0);
});

test("public parser rejects invalid metadata and prohibited nondeterminism", () => {
	assert.throws(() => parseWorkflowScript("const meta = {}\nreturn null"));
	assert.throws(() =>
		parseWorkflowScript(
			"export const meta = { name: 'invalid', description: 'invalid' }\nreturn Date.now()",
		),
	);
});
