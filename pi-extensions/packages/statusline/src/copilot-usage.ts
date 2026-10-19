/** Sanitized account data only: never retain identity, organizations, SKU or tokens. */
export type CopilotQuota = {
	unit: "credits" | "requests" | "unknown";
	unlimited?: boolean;
	percentUsed?: number;
	allowance?: number;
	remaining?: number;
	used?: number;
	creditsUsed?: number;
	overagePermitted?: boolean;
	overageUsed?: number;
	resetAt?: number;
};

export type CopilotUsageDetails = {
	plan?: string;
	premium?: CopilotQuota;
};

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function number(value: unknown): number | undefined {
	if (typeof value !== "number" && typeof value !== "string") return undefined;
	if (typeof value === "string" && !value.trim()) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function boolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function percent(value: unknown): number | undefined {
	const parsed = number(value);
	return parsed !== undefined && parsed <= 100 ? parsed : undefined;
}

function date(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	// Date-only resets mean midnight UTC; never interpret a zone-less time locally.
	if (!/^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(value))
		return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function plan(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const plans: Record<string, string> = {
		free: "Free",
		individual: "Pro",
		pro: "Pro",
		individual_pro: "Pro+",
		pro_plus: "Pro+",
		"pro+": "Pro+",
		business: "Business",
		enterprise: "Enterprise",
		student: "Student",
		max: "Max",
	};
	const key = value.toLowerCase();
	return Object.hasOwn(plans, key) ? plans[key] : undefined;
}

/** Parse the existing read-only copilot_internal/user response, in either casing. */
export function parseCopilotUsage(
	value: unknown,
): CopilotUsageDetails | undefined {
	const body = record(value);
	if (!body) return undefined;
	const snapshots = record(body.quota_snapshots ?? body.quotaSnapshots);
	const raw = record(
		snapshots?.premium_interactions ?? snapshots?.premiumInteractions,
	);
	const details: CopilotUsageDetails = {
		plan: plan(body.copilot_plan ?? body.copilotPlan),
	};
	if (raw) {
		const billing =
			boolean(raw.token_based_billing ?? raw.tokenBasedBilling) ??
			boolean(body.token_based_billing ?? body.tokenBasedBilling);
		const unlimited =
			boolean(raw.unlimited) ??
			(Number(raw.entitlement) === -1 ? true : undefined);
		const allowance = unlimited ? undefined : number(raw.entitlement);
		// quota_remaining has the entitlement's basis and more precision than remaining.
		// credits_used is an aggregate with no denominator (microsoft/vscode#319589).
		const remaining = unlimited
			? undefined
			: number(raw.quota_remaining ?? raw.quotaRemaining ?? raw.remaining);
		const reportedUsed = percent(
			raw.percent_used ?? raw.used_percent ?? raw.usedPercentage,
		);
		const reportedRemaining = percent(
			raw.percent_remaining ?? raw.remaining_percent ?? raw.remainingPercentage,
		);
		const percentUsed = unlimited
			? undefined
			: (reportedUsed ??
				(reportedRemaining !== undefined
					? 100 - reportedRemaining
					: undefined));
		const seconds = number(raw.quota_reset_at ?? raw.quotaResetAt);
		const resetAt =
			seconds && Number.isFinite(seconds * 1000)
				? seconds * 1000
				: (date(body.quota_reset_date_utc ?? body.quotaResetDateUtc) ??
					date(body.quota_reset_date ?? body.quotaResetDate));
		details.premium = {
			unit:
				billing === true
					? "credits"
					: billing === false
						? "requests"
						: "unknown",
			unlimited,
			allowance,
			remaining,
			used:
				allowance !== undefined &&
				remaining !== undefined &&
				remaining <= allowance
					? allowance - remaining
					: undefined,
			percentUsed,
			creditsUsed: number(raw.credits_used ?? raw.creditsUsed),
			overagePermitted: boolean(raw.overage_permitted ?? raw.overagePermitted),
			overageUsed: number(raw.overage_count ?? raw.overageCount),
			resetAt,
		};
	}
	if (
		details.premium &&
		details.premium.unit === "unknown" &&
		Object.entries(details.premium).every(
			([key, value]) => key === "unit" || value === undefined,
		)
	) {
		delete details.premium;
	}
	return details.plan || details.premium ? details : undefined;
}

/** Validate the normalized cache independently from the provider's response shape. */
export function parseCachedCopilotUsage(
	value: unknown,
): CopilotUsageDetails | undefined {
	const body = record(value);
	if (!body) return undefined;
	const details: CopilotUsageDetails = {
		plan:
			typeof body.plan === "string" &&
			[
				"Free",
				"Pro",
				"Pro+",
				"Business",
				"Enterprise",
				"Student",
				"Max",
			].includes(body.plan)
				? body.plan
				: undefined,
	};
	const raw = record(body.premium);
	if (raw) {
		details.premium = {
			unit:
				raw.unit === "credits" || raw.unit === "requests"
					? raw.unit
					: "unknown",
			unlimited: boolean(raw.unlimited),
			percentUsed: percent(raw.percentUsed),
			allowance: number(raw.allowance),
			remaining: number(raw.remaining),
			used: number(raw.used),
			creditsUsed: number(raw.creditsUsed),
			overagePermitted: boolean(raw.overagePermitted),
			overageUsed: number(raw.overageUsed),
			resetAt: number(raw.resetAt),
		};
	}
	return details.plan || details.premium ? details : undefined;
}
