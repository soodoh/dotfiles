import { expect, test } from "vitest";
import browserGuidance from "./index.ts";

test("browser routing appends to host and work-environment guidance", async () => {
	const hooks = [];
	browserGuidance({
		on: (event, handler) => {
			if (event === "before_agent_start") hooks.push(handler);
		},
	});
	let systemPrompt = "Host account/environment instructions.";
	for (const hook of hooks)
		systemPrompt = (await hook({ systemPrompt }))?.systemPrompt ?? systemPrompt;
	expect(systemPrompt).toMatch(/^Host account\/environment instructions\./);
	const guardrails = systemPrompt.split("## Guardrails for this session")[1];
	for (const capability of [
		"web_search",
		"fetch_content",
		"Context7",
		"tool_search",
		"UI interaction",
		"authentication/authorization",
		"playwright-browser",
		"Bitwarden",
		"human credential entry",
	])
		expect(guardrails).toContain(capability);
});
