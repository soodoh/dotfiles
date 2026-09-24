export const USAGE_SUCCESS_TTL_MS = 5 * 60_000;
export const USAGE_FAILURE_TTL_MS = 60_000;
export const USAGE_STALE_MAX_MS = 15 * 60_000;

export type UsageCacheTiming = {
	fetchedAt?: number;
	lastAttemptAt?: number;
	state?: "ready" | "unknown" | "error" | "unsupported";
};

/** Failed attempts retry sooner; a successful value's age is measured from its fetch. */
export function isUsageCacheFresh(
	entry: UsageCacheTiming | undefined,
	now = Date.now(),
): boolean {
	if (!entry?.lastAttemptAt) return false;
	const ttl =
		entry.state === "unknown" || entry.state === "error"
			? USAGE_FAILURE_TTL_MS
			: USAGE_SUCCESS_TTL_MS;
	return now - entry.lastAttemptAt < ttl;
}

/** A last-known value has the same display lifetime regardless of its source. */
export function usageSnapshotFreshness(
	entry: UsageCacheTiming | undefined,
	now = Date.now(),
): "fresh" | "stale" | "expired" {
	const fetchedAt =
		entry?.fetchedAt ??
		(entry?.state === "ready" ? entry.lastAttemptAt : undefined);
	if (!fetchedAt || now - fetchedAt > USAGE_STALE_MAX_MS) return "expired";
	if (
		entry?.state === "error" ||
		entry?.state === "unknown" ||
		now - fetchedAt > USAGE_SUCCESS_TTL_MS
	)
		return "stale";
	return "fresh";
}
