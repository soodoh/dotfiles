import { expect, test } from "vitest";
import { isUsageCacheFresh, usageSnapshotFreshness } from "./usage-freshness";

test.each([
	[5 * 60_000, "fresh"],
	[5 * 60_000 + 1, "fresh"],
	[6 * 60_000, "fresh"],
	[6 * 60_000 + 1, "stale"],
] as const)(
	"refreshes without warning until the grace period ends at age %i",
	(age, freshness) => {
		const fetchedAt = 1_000_000;
		const entry = {
			fetchedAt,
			lastAttemptAt: fetchedAt,
			state: "ready" as const,
		};
		const now = fetchedAt + age;
		expect(isUsageCacheFresh(entry, now)).toBe(false);
		expect(usageSnapshotFreshness(entry, now)).toBe(freshness);
	},
);

test.each(["error", "unknown"] as const)(
	"warns immediately after an %s refresh, even with a recent snapshot",
	(state) => {
		const now = 1_000_000;
		expect(
			usageSnapshotFreshness(
				{ fetchedAt: now - 30_000, lastAttemptAt: now, state },
				now,
			),
		).toBe("stale");
	},
);

test("a recent refresh attempt cannot extend the snapshot's display lifetime", () => {
	const now = 1_000_000;
	expect(
		usageSnapshotFreshness(
			{ fetchedAt: now - 15 * 60_000 - 1, lastAttemptAt: now, state: "ready" },
			now,
		),
	).toBe("expired");
});

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
