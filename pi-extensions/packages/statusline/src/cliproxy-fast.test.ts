import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	resolveEndpoints,
	saveModelsCache,
} from "@router-for-me/pi-cliproxyapi-provider/extensions/lib";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isCliproxyFast } from "./cliproxy-fast";

let agentDir: string;
const baseUrl = "https://proxy.example.test";
const model = { provider: "cliproxyapi", id: "gpt-fast" };

beforeEach(async () => {
	agentDir = await mkdtemp(join(tmpdir(), "pi-cliproxy-fast-"));
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("CLIPROXYAPI_BASE_URL", baseUrl);
	vi.stubEnv("CLIPROXYAPI_API_KEY", "test-key");
	vi.stubEnv("CLIPROXYAPI_FAST", undefined);
	const { inferenceBaseUrl, modelsUrl } = resolveEndpoints(baseUrl);
	saveModelsCache(agentDir, {
		models: [],
		fastModelIds: [model.id],
		inferenceBaseUrl,
		modelsUrl,
	});
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(agentDir, { recursive: true, force: true });
});

test("only marks supported CLIProxyAPI models when the provider's Fast preference is on", async () => {
	expect(isCliproxyFast(model)).toBe(false);
	await writeFile(join(agentDir, "cliproxyapi.json"), '{"fast":true}');
	expect(isCliproxyFast(model)).toBe(true);
	expect(isCliproxyFast({ provider: "cliproxyapi", id: "gpt-other" })).toBe(
		false,
	);
	expect(isCliproxyFast({ provider: "openai-codex", id: model.id })).toBe(
		false,
	);
	await writeFile(join(agentDir, "cliproxyapi.json"), '{"fast":false}');
	expect(isCliproxyFast(model)).toBe(false);
});

test("requires a matching catalog and honors the provider's configured identity", async () => {
	await writeFile(
		join(agentDir, "cliproxyapi.json"),
		'{"fast":true,"providerId":"custom-proxy"}',
	);
	expect(isCliproxyFast(model)).toBe(false);
	expect(isCliproxyFast({ ...model, provider: "custom-proxy" })).toBe(true);
	vi.stubEnv("CLIPROXYAPI_BASE_URL", "https://different.example.test");
	expect(isCliproxyFast({ ...model, provider: "custom-proxy" })).toBe(false);
});

test("handles missing or invalid provider state without claiming Fast", async () => {
	vi.stubEnv("CLIPROXYAPI_API_KEY", undefined);
	vi.stubEnv("CLIPROXYAPI_FAST", "true");
	expect(isCliproxyFast(model)).toBe(false);
	vi.stubEnv("CLIPROXYAPI_API_KEY", "test-key");
	expect(isCliproxyFast(model)).toBe(true);
	vi.stubEnv("CLIPROXYAPI_FAST", "invalid");
	expect(isCliproxyFast(model)).toBe(false);
});
