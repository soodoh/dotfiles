import { expect, test, vi } from "vitest";
import type { SuggestionUsageStats } from "../../../src/domain/state";
import {
	PiSuggestionSink,
	refreshSuggesterUi,
} from "../../../src/infra/pi/ui-adapter";
import type { UiContextLike } from "../../../src/infra/pi/ui-context";

function usageStats(): SuggestionUsageStats {
	return {
		calls: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		costTotal: 0,
	};
}

function inactiveRuntime(
	overrides: Partial<UiContextLike> = {},
): UiContextLike {
	return {
		getContext: () => undefined,
		getEpoch: () => 1,
		getSuggestion: () => undefined,
		setSuggestion: vi.fn(),
		getPanelSuggestionStatus: () => "status",
		setPanelSuggestionStatus: vi.fn(),
		getPanelUsageStatus: () => "usage",
		setPanelUsageStatus: vi.fn(),
		getPanelLogStatus: () => undefined,
		setPanelLogStatus: vi.fn(),
		getSuggesterModelDisplay: () => undefined,
		ghostAcceptKeys: [],
		ghostAcceptAndSendKeys: [],
		prefillOnlyWhenEditorEmpty: false,
		showUsageInPanel: false,
		showPanelStatus: false,
		...overrides,
	};
}

test("refreshSuggesterUi safely ignores missing UI contexts", () => {
	expect(() => refreshSuggesterUi(inactiveRuntime())).not.toThrow();
});

test("PiSuggestionSink ignores stale generation suggestions before touching runtime state", async () => {
	const runtime = inactiveRuntime({ getEpoch: () => 2 });
	const sink = new PiSuggestionSink(runtime);

	await expect(
		sink.showSuggestion("Continue", { generationId: 1 }),
	).resolves.toBe(false);
	expect(runtime.setSuggestion).not.toHaveBeenCalled();
	expect(runtime.setPanelSuggestionStatus).not.toHaveBeenCalled();
});

test("PiSuggestionSink returns false when no active UI context exists", async () => {
	const runtime = inactiveRuntime();
	const sink = new PiSuggestionSink(runtime);

	await expect(sink.showSuggestion("Continue")).resolves.toBe(false);
	expect(runtime.setSuggestion).not.toHaveBeenCalled();
});

test("PiSuggestionSink clears inactive suggestions and usage panel state", async () => {
	const setSuggestion = vi.fn();
	const setPanelSuggestionStatus = vi.fn();
	const setPanelUsageStatus = vi.fn();
	const runtime = inactiveRuntime({
		setSuggestion,
		setPanelSuggestionStatus,
		setPanelUsageStatus,
	});
	const sink = new PiSuggestionSink(runtime);

	await expect(sink.clearSuggestion({ generationId: 1 })).resolves.toBe(true);
	await sink.setUsage({ suggester: usageStats(), seeder: usageStats() });

	expect(setSuggestion).toHaveBeenCalledWith(undefined);
	expect(setPanelSuggestionStatus).toHaveBeenCalledWith(undefined);
	expect(setPanelUsageStatus).toHaveBeenCalledWith(undefined);
});
