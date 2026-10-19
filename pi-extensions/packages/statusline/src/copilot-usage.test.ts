import { expect, test } from "vitest";
import { parseCachedCopilotUsage, parseCopilotUsage } from "./copilot-usage";

// Synthetic values using the live endpoint's field shapes; no account identity.
function response(
	premium: Record<string, unknown>,
	account: Record<string, unknown> = {},
) {
	return {
		copilot_plan: "business",
		token_based_billing: true,
		quota_reset_date: "2035-02-01",
		quota_reset_date_utc: "2035-02-01T00:00:00.000Z",
		quota_snapshots: { premium_interactions: premium },
		...account,
	};
}

test("keeps entitlement-basis usage separate from aggregate credits and rounded percentages", () => {
	const result = parseCopilotUsage(
		response({
			entitlement: 1000,
			quota_remaining: 749.25,
			remaining: 749,
			percent_remaining: 75,
			credits_used: 4000,
			overage_count: 0,
			overage_permitted: true,
			quota_reset_at: 0,
		}),
	);
	expect(result).toMatchObject({
		plan: "Business",
		premium: {
			unit: "credits",
			allowance: 1000,
			remaining: 749.25,
			used: 250.75,
			percentUsed: 25,
			creditsUsed: 4000,
			overagePermitted: true,
			overageUsed: 0,
			resetAt: Date.parse("2035-02-01T00:00:00Z"),
		},
	});
});

test("accepts legacy requests and camel-cased responses without assuming plan allowances", () => {
	expect(
		parseCopilotUsage({
			copilotPlan: "individual_pro",
			tokenBasedBilling: false,
			quotaResetDate: "2035-03-01",
			quotaSnapshots: {
				premiumInteractions: {
					entitlement: "300",
					remaining: "0",
					usedPercentage: 100,
					overagePermitted: false,
					overageCount: 2.5,
				},
			},
		}),
	).toMatchObject({
		plan: "Pro+",
		premium: {
			unit: "requests",
			allowance: 300,
			remaining: 0,
			used: 300,
			percentUsed: 100,
			overagePermitted: false,
			overageUsed: 2.5,
			resetAt: Date.parse("2035-03-01T00:00:00Z"),
		},
	});
	expect(parseCopilotUsage({ copilot_plan: "pro" })).toEqual({ plan: "Pro" });
});

test("prefers per-quota reset seconds, then UTC time, then date-only UTC", () => {
	const seconds = Date.parse("2035-02-02T04:00:00Z") / 1000;
	expect(
		parseCopilotUsage(response({ quota_reset_at: seconds }))?.premium?.resetAt,
	).toBe(seconds * 1000);
	expect(
		parseCopilotUsage(
			response(
				{ percent_remaining: 100 },
				{ quota_reset_date_utc: "2035-02-03T12:00:00Z" },
			),
		)?.premium?.resetAt,
	).toBe(Date.parse("2035-02-03T12:00:00Z"));
	expect(
		parseCopilotUsage(
			response({ percent_remaining: 100 }, { quota_reset_date_utc: "invalid" }),
		)?.premium?.resetAt,
	).toBe(Date.parse("2035-02-01T00:00:00Z"));
	expect(
		parseCopilotUsage({
			quota_snapshots: { premium_interactions: { percent_remaining: 100 } },
		})?.premium?.resetAt,
	).toBeUndefined();
});

test.each([
	{ unlimited: true, entitlement: 0, remaining: 0 },
	{ entitlement: -1, remaining: -1 },
])(
	"does not render unlimited sentinel values as zero usage or an allowance: %j",
	(quota) => {
		const premium = parseCopilotUsage(
			response({ ...quota, percent_remaining: 100, credits_used: 12.5 }),
		)?.premium;
		expect(premium).toMatchObject({ unlimited: true, creditsUsed: 12.5 });
		expect(premium?.percentUsed).toBeUndefined();
		expect(premium?.allowance).toBeUndefined();
		expect(premium?.remaining).toBeUndefined();
		expect(premium?.used).toBeUndefined();
	},
);

test.each([
	null,
	false,
	"",
	" ",
	"invalid",
	-5,
	Number.NaN,
	Number.POSITIVE_INFINITY,
	{},
])("invalid numeric fields stay unavailable, not zero: %j", (value) => {
	const premium = parseCopilotUsage(
		response({
			entitlement: value,
			remaining: value,
			percent_remaining: value,
			overage_count: value,
			credits_used: value,
		}),
	)?.premium;
	for (const key of [
		"allowance",
		"remaining",
		"used",
		"percentUsed",
		"overageUsed",
		"creditsUsed",
	] as const) {
		expect(premium?.[key]).toBeUndefined();
	}
});

test("missing or inconsistent data does not invent units, counts, quota or a plan", () => {
	expect(parseCopilotUsage(null)).toBeUndefined();
	expect(
		parseCopilotUsage({ quota_snapshots: { premium_interactions: {} } }),
	).toBeUndefined();
	expect(parseCopilotUsage({ copilot_plan: "constructor" })).toBeUndefined();
	const premium = parseCopilotUsage({
		quota_snapshots: {
			premium_interactions: {
				entitlement: 100,
				remaining: 110,
				percent_remaining: 101,
				overage_permitted: "false",
			},
		},
	})?.premium;
	expect(premium).toMatchObject({
		unit: "unknown",
		allowance: 100,
		remaining: 110,
	});
	expect(premium?.used).toBeUndefined();
	expect(premium?.percentUsed).toBeUndefined();
	expect(premium?.overagePermitted).toBeUndefined();
});

test("cache round trips sanitized details and rejects malformed numeric data", () => {
	const details = parseCopilotUsage(
		response({
			entitlement: 100,
			remaining: 0,
			percent_remaining: 0,
			overage_permitted: false,
		}),
	);
	const serialized = JSON.stringify(details);
	expect(parseCachedCopilotUsage(JSON.parse(serialized))).toEqual(details);
	expect(
		parseCachedCopilotUsage({
			plan: "private-name",
			premium: {
				unit: "bad",
				used: -1,
				allowance: "",
				remaining: null,
				percentUsed: 150,
			},
		}),
	).toMatchObject({ premium: { unit: "unknown" } });
	expect(parseCachedCopilotUsage([])).toBeUndefined();
});
