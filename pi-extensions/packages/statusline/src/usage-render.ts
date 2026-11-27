import type {
	DirectProxyFallback,
	ProxySnapshotView,
	ProxyUsageAccount,
} from "./cliproxy-usage";
import { usageSnapshotFreshness } from "./usage-cache";
import {
	formatProviderScope,
	PROVIDER_BADGE_SEPARATOR,
	type ProviderUsageScope,
} from "./usage-quota";

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

export type ThemeLike = {
	fg(color: string, text: string): string;
};

export type ProviderUsageRenderOptions = {
	theme: ThemeLike;
	activeOnly: boolean;
	renderActive?: (text: string) => string;
	activeFamilyOverride?: string;
	activeProxy?: boolean;
};

export type ProviderUsageAuthKind = "oauth" | "api_key" | "unknown";
export type ProviderUsageState = "ready" | "unknown" | "error" | "unsupported";

export type ProviderUsageStatusView = {
	state: ProviderUsageState;
	scope?: ProviderUsageScope;
	copilot?: CopilotUsageDetails;
	fetchedAt?: number;
	lastAttemptAt?: number;
};

export type ProviderUsageRenderTarget = {
	providerId: string;
	authKind: ProviderUsageAuthKind;
	active: boolean;
	family: string;
	targetKey: string;
	supported: boolean;
	proxyOnly?: boolean;
	proxyFallback?: boolean;
	status?: ProviderUsageStatusView;
};

export type ProxyUsageView = Pick<
	ProxySnapshotView,
	"targetQuotaState" | "linkedAccountKey" | "resolveAccounts"
>;

export type ProviderUsageRenderSnapshot = {
	targets: ProviderUsageRenderTarget[];
	proxySnapshot?: ProxyUsageView;
	now?: number;
};

export type CopilotUsageAccount = {
	summary: string;
	details?: CopilotUsageDetails;
	state: ProviderUsageState;
	fetchedAt?: number;
	lastAttemptAt?: number;
	stale: boolean;
};

export type ProviderUsageCliSnapshot = {
	text: string;
	directText: string;
	copilot?: CopilotUsageAccount;
	proxyAccounts: ProxyUsageAccount[];
};

export const LLMHUB_USAGE_PROVIDER_ID = "llm-hub";

export const PROVIDER_FAMILY_ORDER = [
	LLMHUB_USAGE_PROVIDER_ID,
	"github-copilot",
	"openai",
	"openrouter",
];

const OPENAI_LOGO = "\u{F0004}";
const CODEX_PROXY_LOGO = "\uF120"; // nf-fa-terminal
const OPENROUTER_LOGO = "\u{F0469}";
const GITHUB_LOGO = "\uF09B";

export function compareProviderFamilies(
	aFamily: string,
	bFamily: string,
): number {
	const aIndex = PROVIDER_FAMILY_ORDER.indexOf(aFamily);
	const bIndex = PROVIDER_FAMILY_ORDER.indexOf(bFamily);
	const aOrder = aIndex === -1 ? PROVIDER_FAMILY_ORDER.length : aIndex;
	const bOrder = bIndex === -1 ? PROVIDER_FAMILY_ORDER.length : bIndex;
	return aOrder - bOrder || aFamily.localeCompare(bFamily);
}

function providerDisplayLabel(family: string, providerId: string): string {
	switch (family) {
		case LLMHUB_USAGE_PROVIDER_ID:
			return "LLMHub";
		case "anthropic":
			return "Anthropic";
		case "openai":
			return OPENAI_LOGO;
		case "openrouter":
			return OPENROUTER_LOGO;
		case "github-copilot":
			return GITHUB_LOGO;
		default:
			return providerId;
	}
}

function providerUsageLabelsForTarget(
	target: ProviderUsageRenderTarget,
	now: number,
): string[] {
	if (target.proxyOnly) {
		return [`${providerDisplayLabel(target.family, target.providerId)} ?`];
	}
	const status = target.status;
	const freshness = usageSnapshotFreshness(status, now);
	const scopeText =
		freshness === "expired" ? undefined : formatProviderScope(status?.scope);
	if (!scopeText && !target.active) return [];
	return [
		`${providerDisplayLabel(target.family, target.providerId)} ${scopeText ? `${scopeText}${freshness === "stale" ? " !" : ""}` : "?"}`,
	];
}

function isTargetActive(
	target: ProviderUsageRenderTarget,
	activeFamilyOverride?: string,
): boolean {
	return (
		target.active ||
		(activeFamilyOverride !== undefined &&
			target.family === activeFamilyOverride)
	);
}

function directProviderUsageBadges(
	targets: ProviderUsageRenderTarget[],
	activeOnly: boolean,
	activeFamilyOverride: string | undefined,
	proxySnapshot: ProxyUsageView | undefined,
	now: number,
): { active: boolean; text: string }[] {
	return targets
		.filter(
			(target) =>
				target.supported &&
				(proxySnapshot?.targetQuotaState(target.targetKey) ?? "unlinked") ===
					"unlinked",
		)
		.map((target) => ({
			...target,
			active: isTargetActive(target, activeFamilyOverride),
		}))
		.filter((target) => !activeOnly || target.active)
		.sort((a, b) => compareProviderFamilies(a.family, b.family))
		.flatMap((target) =>
			providerUsageLabelsForTarget(target, now).map((text) => ({
				active: target.active,
				text,
			})),
		);
}

function buildCopilotUsageAccount(
	targets: ProviderUsageRenderTarget[],
	now: number,
): CopilotUsageAccount | undefined {
	const target = targets.find(
		(candidate) =>
			candidate.providerId === "github-copilot" &&
			candidate.authKind === "oauth",
	);
	if (!target) return undefined;
	const status = target.status;
	const freshness = usageSnapshotFreshness(status, now);
	return {
		summary:
			freshness === "expired"
				? "?"
				: (formatProviderScope(status?.scope) ?? "?"),
		details: freshness === "expired" ? undefined : status?.copilot,
		state: status?.state ?? "unknown",
		fetchedAt: status?.fetchedAt,
		lastAttemptAt: status?.lastAttemptAt,
		stale: freshness === "stale",
	};
}

function directProxyFallbacks(
	targets: ProviderUsageRenderTarget[],
	now: number,
): Map<string, DirectProxyFallback> {
	const fallbacks = new Map<string, DirectProxyFallback>();
	for (const target of targets) {
		if (!target.proxyFallback) continue;
		const status = target.status;
		if (!status?.scope) continue;
		const freshness = usageSnapshotFreshness(status, now);
		if (freshness === "expired") continue;
		fallbacks.set(target.targetKey, {
			scope: status.scope,
			freshness,
			state: status.state,
			fetchedAt: status.fetchedAt,
			lastAttemptAt: status.lastAttemptAt,
		});
	}
	return fallbacks;
}

function resolveProxyAccounts(
	targets: ProviderUsageRenderTarget[],
	proxySnapshot: ProxyUsageView | undefined,
	now: number,
): ProxyUsageAccount[] {
	if (!proxySnapshot) return [];
	return proxySnapshot.resolveAccounts(directProxyFallbacks(targets, now));
}

function renderProxyUsageBadges(
	targets: ProviderUsageRenderTarget[],
	proxySnapshot: ProxyUsageView | undefined,
	options: {
		compact: boolean;
		activeOnly: boolean;
		activeFamilyOverride?: string;
		activeProxy: boolean;
		now: number;
		resolvedProxyAccounts?: ProxyUsageAccount[];
	},
	renderPart: (text: string, active: boolean) => string,
): string[] {
	if (!proxySnapshot) return [];
	const linked = new Map<string, boolean>();
	for (const target of targets) {
		const accountKey = proxySnapshot.linkedAccountKey(target.targetKey);
		if (!accountKey) continue;
		linked.set(
			accountKey,
			!!linked.get(accountKey) ||
				isTargetActive(target, options.activeFamilyOverride),
		);
	}
	const accounts =
		options.resolvedProxyAccounts ??
		resolveProxyAccounts(targets, proxySnapshot, options.now);
	const valid = accounts.filter(
		(account) =>
			!options.activeOnly || options.activeProxy || linked.get(account.key),
	);
	const visible = options.compact ? valid.slice(0, 2) : valid;
	const scopes = visible.map((account) => {
		const proxyActive = options.activeProxy && !account.disabled;
		if (linked.has(account.key)) {
			const directActive = linked.get(account.key) === true;
			return `${renderPart(OPENAI_LOGO, directActive)} ${renderPart(CODEX_PROXY_LOGO, proxyActive)} ${renderPart(account.summary, directActive || proxyActive)}`;
		}
		return renderPart(`${CODEX_PROXY_LOGO} ${account.summary}`, proxyActive);
	});
	if (scopes.length === 0) return [];
	if (options.compact && valid.length > visible.length) {
		scopes.push(renderPart(`+${valid.length - visible.length}`, false));
	}
	return [
		`${scopes.join(renderPart(PROVIDER_BADGE_SEPARATOR, false))}${valid.some((account) => account.stale) ? renderPart(" !", false) : ""}`,
	];
}

function renderUsageLine(
	snapshot: ProviderUsageRenderSnapshot,
	options: {
		activeOnly: boolean;
		activeFamilyOverride?: string;
		compact: boolean;
		activeProxy: boolean;
		now: number;
		resolvedProxyAccounts?: ProxyUsageAccount[];
	},
	renderPart: (text: string, active: boolean) => string,
): string | undefined {
	const directBadges = directProviderUsageBadges(
		snapshot.targets,
		options.activeOnly,
		options.activeFamilyOverride,
		snapshot.proxySnapshot,
		options.now,
	).map(({ active, text }) => renderPart(text, active));
	const proxyBadges = renderProxyUsageBadges(
		snapshot.targets,
		snapshot.proxySnapshot,
		options,
		renderPart,
	);
	const parts = [...directBadges, ...proxyBadges];
	return parts.length > 0
		? parts.join(renderPart(PROVIDER_BADGE_SEPARATOR, false))
		: undefined;
}

export function renderProviderUsageLine(
	snapshot: ProviderUsageRenderSnapshot,
	options: ProviderUsageRenderOptions,
): string | undefined {
	const now = snapshot.now ?? Date.now();
	const renderActive =
		options.renderActive ?? ((text: string) => options.theme.fg("dim", text));
	return renderUsageLine(
		snapshot,
		{
			activeOnly: options.activeOnly,
			activeFamilyOverride: options.activeFamilyOverride,
			compact: false,
			activeProxy: options.activeProxy ?? false,
			now,
		},
		(text, active) =>
			active ? renderActive(text) : options.theme.fg("dim", text),
	);
}

export function buildProviderUsageCliSnapshot(
	snapshot: ProviderUsageRenderSnapshot,
): ProviderUsageCliSnapshot {
	const now = snapshot.now ?? Date.now();
	const nonCopilotTargets = snapshot.targets.filter(
		(target) => target.providerId !== "github-copilot",
	);
	const proxyAccounts = resolveProxyAccounts(
		snapshot.targets,
		snapshot.proxySnapshot,
		now,
	);
	return {
		text:
			renderUsageLine(
				snapshot,
				{
					activeOnly: false,
					compact: true,
					activeProxy: false,
					now,
					resolvedProxyAccounts: proxyAccounts,
				},
				(text) => text,
			) ?? "",
		directText: directProviderUsageBadges(
			nonCopilotTargets,
			false,
			undefined,
			snapshot.proxySnapshot,
			now,
		)
			.map(({ text }) => text)
			.join(PROVIDER_BADGE_SEPARATOR),
		copilot: buildCopilotUsageAccount(snapshot.targets, now),
		proxyAccounts,
	};
}
