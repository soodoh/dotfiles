import { expect, test } from "vitest";
import { RuntimeRef } from "../../../src/infra/pi/runtime-ref";

test("RuntimeRef trims suggestion and tracks revisions", () => {
	const runtime = new RuntimeRef();

	expect(runtime.getSuggestionRevision()).toBe(0);
	runtime.setSuggestion("  Continue with tests.  ");
	expect(runtime.getSuggestion()).toBe("Continue with tests.");
	expect(runtime.getSuggestionRevision()).toBe(1);
	runtime.setSuggestion("   ");
	expect(runtime.getSuggestion()).toBeUndefined();
	expect(runtime.getSuggestionRevision()).toBe(2);
});

test("RuntimeRef bumps epoch on explicit bump and context clear", () => {
	const runtime = new RuntimeRef();

	expect(runtime.getEpoch()).toBe(0);
	expect(runtime.bumpEpoch()).toBe(1);
	runtime.clearContext();
	expect(runtime.getContext()).toBeUndefined();
	expect(runtime.getEpoch()).toBe(2);
});

test("RuntimeRef stores defensive editor history copies", () => {
	const runtime = new RuntimeRef();
	const entries = [" first ", "", "second"];

	runtime.setEditorHistoryState({ entries, index: 10 });
	entries[0] = "mutated";

	const first = runtime.getEditorHistoryState();
	expect(first).toEqual({ entries: ["first", "second"], index: 1 });
	first.entries.push("external");
	expect(runtime.getEditorHistoryState()).toEqual({
		entries: ["first", "second"],
		index: 1,
	});
});
