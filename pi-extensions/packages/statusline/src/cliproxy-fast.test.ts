import { expect, test, vi } from "vitest";
import { isCliproxyFast } from "./cliproxy-fast";

const model = { provider: "cliproxyapi", id: "gpt-fast" };

test("asks the local session's Fast reader about the selected model", () => {
	const isFast = vi.fn(
		(provider: string, id: string) =>
			provider === model.provider && id === model.id,
	);
	expect(isCliproxyFast(model, isFast)).toBe(true);
	expect(isFast).toHaveBeenCalledWith("cliproxyapi", "gpt-fast");
	expect(isCliproxyFast({ ...model, id: "gpt-other" }, isFast)).toBe(false);
	expect(isCliproxyFast({ ...model, provider: "openai-codex" }, isFast)).toBe(
		false,
	);
});

test("hides the bolt when the reader or model is unavailable", () => {
	const isFast = vi.fn(() => true);
	expect(isCliproxyFast(model, undefined)).toBe(false);
	expect(isCliproxyFast(undefined, isFast)).toBe(false);
	expect(isCliproxyFast({ ...model, id: "" }, isFast)).toBe(false);
	expect(isFast).not.toHaveBeenCalled();
});
