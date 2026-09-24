import { expect, test } from "vitest";
import { isUsageCacheFresh, usageSnapshotFreshness } from "./usage-freshness";

test("applies one refresh and stale-value policy to all usage sources", () => {
	const now = Date.now();
	const entry = {
		fetchedAt: now - 6 * 60_000,
		lastAttemptAt: now - 30_000,
		state: "error" as const,
	};
	expect(isUsageCacheFresh(entry, now)).toBe(true);
	expect(isUsageCacheFresh(entry, now + 31_000)).toBe(false);
	expect(usageSnapshotFreshness(entry, now)).toBe("stale");
	expect(usageSnapshotFreshness(entry, now + 10 * 60_000)).toBe("expired");
	expect(
		usageSnapshotFreshness({ ...entry, fetchedAt: now, state: "ready" }, now),
	).toBe("fresh");
});
