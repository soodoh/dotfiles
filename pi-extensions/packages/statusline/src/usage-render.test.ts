import { describe, expect, test } from "vitest";
import type { ProxyUsageAccount } from "./cliproxy-usage";
import { USAGE_STALE_GRACE_MS, USAGE_SUCCESS_TTL_MS } from "./usage-cache";
import {
	buildProviderUsageCliSnapshot,
	type ProviderUsageRenderSnapshot,
	type ProxyUsageView,
	renderProviderUsageLine,
} from "./usage-render";

const styledTheme = {
	fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
};

function proxyView(
	accounts: ProxyUsageAccount[],
	links: Record<string, string> = {},
): ProxyUsageView {
	return {
		targetQuotaState(targetKey) {
			return links[targetKey] ? "fresh" : "unlinked";
		},
		linkedAccountKey(targetKey) {
			return links[targetKey];
		},
		resolveAccounts() {
			return accounts;
		},
	};
}

const FIXED_NOW = 1_700_000_000_000;

describe("usage-render", () => {
	test("orders direct badges by provider family, marks stale entries, and highlights active family overrides", () => {
		const snapshot: ProviderUsageRenderSnapshot = {
			now: FIXED_NOW,
			targets: [
				{
					providerId: "anthropic",
					authKind: "oauth",
					active: false,
					family: "anthropic",
					targetKey: "anthropic:oauth",
					supported: true,
					status: {
						state: "ready",
						scope: { percentUsed: 12 },
						fetchedAt: FIXED_NOW,
					},
				},
				{
					providerId: "llm-hub",
					authKind: "api_key",
					active: false,
					family: "llm-hub",
					targetKey: "llm-hub:api_key",
					supported: true,
					status: {
						state: "ready",
						scope: { balanceUsd: 4.5 },
						fetchedAt:
							FIXED_NOW - (USAGE_SUCCESS_TTL_MS + USAGE_STALE_GRACE_MS + 1000),
					},
				},
			],
		};

		expect(
			renderProviderUsageLine(snapshot, {
				theme: styledTheme,
				activeOnly: false,
				renderActive: (text) => `<active>${text}</active>`,
				activeFamilyOverride: "anthropic",
			}),
		).toBe(
			"<dim>LLMHub $4.50 !</dim><dim> · </dim><active>Anthropic 12%</active>",
		);

		expect(
			renderProviderUsageLine(snapshot, {
				theme: styledTheme,
				activeOnly: true,
				renderActive: (text) => `<active>${text}</active>`,
				activeFamilyOverride: "anthropic",
			}),
		).toBe("<active>Anthropic 12%</active>");
	});

	test("builds CLI snapshot with compact +N proxy overflow and separates Copilot from directText", () => {
		const accounts: ProxyUsageAccount[] = [
			{
				key: "k1",
				summary: "10%",
				scope: { percentUsed: 10 },
				disabled: false,
				stale: false,
				quotaLookupFailed: false,
				resetLookupFailed: false,
				fetchedAt: FIXED_NOW,
				observedAt: FIXED_NOW,
			},
			{
				key: "k2",
				summary: "20%",
				scope: { percentUsed: 20 },
				disabled: false,
				stale: true,
				quotaLookupFailed: false,
				resetLookupFailed: false,
				fetchedAt: FIXED_NOW,
				observedAt: FIXED_NOW,
			},
			{
				key: "k3",
				summary: "30%",
				scope: { percentUsed: 30 },
				disabled: false,
				stale: false,
				quotaLookupFailed: false,
				resetLookupFailed: false,
				fetchedAt: FIXED_NOW,
				observedAt: FIXED_NOW,
			},
		];
		const snapshot: ProviderUsageRenderSnapshot = {
			now: FIXED_NOW,
			targets: [
				{
					providerId: "github-copilot",
					authKind: "oauth",
					active: false,
					family: "github-copilot",
					targetKey: "github-copilot:oauth",
					supported: true,
					status: {
						state: "ready",
						scope: { percentUsed: 40 },
						copilot: { plan: "pro", premium: { unit: "requests", used: 40 } },
						fetchedAt: FIXED_NOW,
					},
				},
				{
					providerId: "anthropic",
					authKind: "oauth",
					active: false,
					family: "anthropic",
					targetKey: "anthropic:oauth",
					supported: true,
					status: {
						state: "ready",
						scope: { percentUsed: 15 },
						fetchedAt: FIXED_NOW,
					},
				},
			],
			proxySnapshot: proxyView(accounts),
		};

		const cli = buildProviderUsageCliSnapshot(snapshot);
		expect(cli.directText).toBe("Anthropic 15%");
		expect(cli.copilot).toMatchObject({
			summary: "40%",
			state: "ready",
			stale: false,
			details: { plan: "pro" },
		});
		expect(cli.proxyAccounts).toHaveLength(3);
		expect(cli.text).toContain("+1 !");
	});
});
