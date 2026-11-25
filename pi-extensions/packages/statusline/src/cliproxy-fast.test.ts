import { expect, test, vi } from "vitest";
import { getCliproxySpeed, type SpeedReader } from "./cliproxy-fast";

const model = { provider: "cliproxyapi", id: "gpt-fast" };

test("asks the local speed reader about the selected model", () => {
	const readSpeed = vi.fn<SpeedReader>((provider, id) =>
		provider === model.provider && id === model.id ? "ultrafast" : undefined,
	);
	expect(getCliproxySpeed(model, readSpeed)).toBe("ultrafast");
	expect(readSpeed).toHaveBeenCalledWith("cliproxyapi", "gpt-fast");
	expect(
		getCliproxySpeed({ ...model, id: "gpt-other" }, readSpeed),
	).toBeUndefined();
	expect(
		getCliproxySpeed({ ...model, provider: "openai-codex" }, readSpeed),
	).toBeUndefined();
});

test("returns no speed when the reader or model is unavailable", () => {
	const readSpeed = vi.fn<SpeedReader>(() => "fast");
	expect(getCliproxySpeed(model, undefined)).toBeUndefined();
	expect(getCliproxySpeed(undefined, readSpeed)).toBeUndefined();
	expect(getCliproxySpeed({ ...model, id: "" }, readSpeed)).toBeUndefined();
	expect(readSpeed).not.toHaveBeenCalled();
});
