export const PROVIDER_BADGE_SEPARATOR = " · ";

export type ProviderUsageScope = {
	sessionPercentUsed?: number;
	sessionResetAt?: number;
	weeklyPercentUsed?: number;
	weeklyResetAt?: number;
	monthlyPercentUsed?: number;
	monthlyResetAt?: number;
	percentUsed?: number;
	resetAt?: number;
	/** Reported duration of an unclassified quota window; never inferred from plan. */
	windowSeconds?: number;
	availableResets?: number;
	balanceUsd?: number;
	creditsUsd?: number;
	spendUsd?: number;
};

export function hasQuota(scope: ProviderUsageScope | undefined): boolean {
	return (
		scope?.sessionPercentUsed !== undefined ||
		scope?.weeklyPercentUsed !== undefined ||
		scope?.monthlyPercentUsed !== undefined ||
		scope?.percentUsed !== undefined
	);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function nestedRecord(
	value: Record<string, unknown>,
	key: string,
): Record<string, unknown> | undefined {
	const child = value[key];
	return isRecord(child) ? child : undefined;
}

export function numericField(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string" || !value.trim()) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function timestampMillis(value: unknown): number | undefined {
	const numeric = numericField(value);
	if (numeric !== undefined) {
		const timestamp =
			Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1000 : numeric;
		return timestamp > 0 ? timestamp : undefined;
	}
	if (typeof value !== "string") return undefined;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined;
}

function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}

export function parseUtilization(value: unknown): number | undefined {
	const numeric = numericField(value);
	return numeric === undefined ? undefined : clampPercent(numeric);
}

type OpenAiUsageWindowKind = "session" | "weekly" | "monthly" | "unknown";

function openAiWindowPercent(
	window: Record<string, unknown> | undefined,
): number | undefined {
	return window
		? parseUtilization(
				window.used_percent ?? window.used_percentage ?? window.utilization,
			)
		: undefined;
}

function openAiWindowResetAt(
	window: Record<string, unknown> | undefined,
): number | undefined {
	return window
		? timestampMillis(window.reset_at ?? window.resets_at ?? window.resetAt)
		: undefined;
}

function openAiWindowKind(
	window: Record<string, unknown> | undefined,
	fallback: OpenAiUsageWindowKind,
): OpenAiUsageWindowKind {
	const durationSeconds = window
		? numericField(window.limit_window_seconds)
		: undefined;
	if (durationSeconds === undefined) return fallback;

	const daySeconds = 24 * 60 * 60;
	if (durationSeconds === 5 * 60 * 60) return "session";
	if (durationSeconds === 7 * daySeconds) return "weekly";
	const days = durationSeconds / daySeconds;
	if (Number.isInteger(days) && days >= 28 && days <= 31) return "monthly";
	return "unknown";
}

export function parseOpenAiUsageBody(
	body: unknown,
): ProviderUsageScope | undefined {
	if (!isRecord(body)) return undefined;

	const rateLimit = nestedRecord(body, "rate_limit");
	const primary = rateLimit
		? nestedRecord(rateLimit, "primary_window")
		: undefined;
	const secondary = rateLimit
		? nestedRecord(rateLimit, "secondary_window")
		: undefined;
	const credits = nestedRecord(body, "credits");
	const scope: ProviderUsageScope = {};
	for (const [window, fallbackKind] of [
		[primary, "session"],
		[secondary, "weekly"],
	] satisfies [Record<string, unknown> | undefined, OpenAiUsageWindowKind][]) {
		const percentUsed = openAiWindowPercent(window);
		if (percentUsed === undefined) continue;
		const kind = openAiWindowKind(window, fallbackKind);
		const percentKey =
			kind === "unknown" ? "percentUsed" : (`${kind}PercentUsed` as const);
		const resetKey =
			kind === "unknown" ? "resetAt" : (`${kind}ResetAt` as const);
		// Preserve the most restrictive observation and its corresponding reset.
		if (scope[percentKey] !== undefined && percentUsed < scope[percentKey])
			continue;
		scope[percentKey] = percentUsed;
		scope[resetKey] = openAiWindowResetAt(window);
		if (kind === "unknown")
			scope.windowSeconds = numericField(window?.limit_window_seconds);
	}
	const balanceUsd =
		credits?.has_credits === true
			? numericField(
					credits.balance ?? credits.remaining ?? credits.remaining_credits,
				)
			: undefined;

	if (balanceUsd !== undefined) scope.balanceUsd = balanceUsd;
	return Object.keys(scope).length > 0 ? scope : undefined;
}

function formatPercentValue(percent: number): string {
	return Math.round(percent).toString();
}

function formatPercent(percent: number): string {
	return `${formatPercentValue(percent)}%`;
}

function formatMoney(value: number): string {
	return `$${value.toFixed(2)}`;
}

function formatLabeledPercent(label: string, percent: number): string {
	return `${label}${formatPercent(percent)}`;
}

function formatResetCountdown(timestamp: number): string {
	const remainingMinutes = Math.max(
		0,
		Math.ceil((timestamp - Date.now()) / 60_000),
	);
	if (remainingMinutes < 60) return `${remainingMinutes}m`;
	if (remainingMinutes < 24 * 60) return `${Math.ceil(remainingMinutes / 60)}h`;
	return `${Math.ceil(remainingMinutes / (24 * 60))}d`;
}

function formatWindowDuration(seconds: number | undefined): string | undefined {
	if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0)
		return undefined;
	for (const [unit, size] of [
		["d", 86400],
		["h", 3600],
		["m", 60],
		["s", 1],
	] as const) {
		if (seconds % size === 0) return `${seconds / size}${unit}`;
	}
	return `${seconds}s`;
}

export function formatProviderScope(
	scope: ProviderUsageScope | undefined,
): string | undefined {
	if (!scope) return undefined;
	const percentageCandidates: {
		label?: string;
		value: number | undefined;
		resetAt?: number;
		duration?: string;
	}[] = [
		{
			label: "S",
			value: scope.sessionPercentUsed,
			resetAt: scope.sessionResetAt,
		},
		{
			label: "W",
			value: scope.weeklyPercentUsed,
			resetAt: scope.weeklyResetAt,
		},
		{
			label: "M",
			value: scope.monthlyPercentUsed,
			resetAt: scope.monthlyResetAt,
		},
		{
			value: scope.percentUsed,
			resetAt: scope.resetAt,
			duration: formatWindowDuration(scope.windowSeconds),
		},
	];
	const percentages = percentageCandidates.filter(
		(
			entry,
		): entry is {
			label?: string;
			value: number;
			resetAt?: number;
			duration?: string;
		} =>
			entry.value !== undefined &&
			Number.isFinite(entry.value) &&
			(entry.resetAt === undefined || entry.resetAt > Date.now()),
	);
	const resets =
		scope.availableResets !== undefined && scope.availableResets > 0
			? `↻${Math.floor(scope.availableResets)}`
			: undefined;
	let scopeText: string | undefined;
	if (percentages.length > 0) {
		const showScopeLabels = percentages.length > 1;
		scopeText = percentages
			.map(({ label, value, resetAt, duration }, index) => {
				const percentage = duration
					? `${duration} ${formatPercent(value)}`
					: showScopeLabels && label
						? formatLabeledPercent(label, value)
						: formatPercent(value);
				const details: string[] = [];
				if (resetAt !== undefined) details.push(formatResetCountdown(resetAt));
				if (index === percentages.length - 1 && resets) details.push(resets);
				return details.length > 0
					? `${percentage} (${details.join(" ")})`
					: percentage;
			})
			.join("/");
	} else if (scope.balanceUsd !== undefined) {
		scopeText = formatMoney(scope.balanceUsd);
	} else if (scope.creditsUsd !== undefined) {
		scopeText = formatMoney(scope.creditsUsd);
	} else if (scope.spendUsd !== undefined) {
		scopeText = formatMoney(scope.spendUsd);
	}

	if (resets && percentages.length === 0) {
		return scopeText ? `${scopeText} (${resets})` : `(${resets})`;
	}
	return scopeText;
}
