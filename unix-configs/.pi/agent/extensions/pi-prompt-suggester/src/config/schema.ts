import { CURRENT_CONFIG_SCHEMA_VERSION } from "./migrations.js";
import type {
	GhostAcceptKey,
	InferenceConfig,
	LoggingConfig,
	PromptSuggesterConfig,
	ReseedConfig,
	SeedConfig,
	SteeringConfig,
	SuggestionConfig,
} from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoolean(value: unknown): value is boolean {
	return typeof value === "boolean";
}

function isPositiveInteger(value: unknown): boolean {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): boolean {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveNumber(value: unknown): boolean {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPercentageInteger(value: unknown): boolean {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

function isPositivePercentageInteger(value: unknown): boolean {
	return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100;
}

function isThinkingLevel(value: unknown): boolean {
	return ["minimal", "low", "medium", "high", "xhigh", "session-default"].includes(String(value));
}

function isModelSetting(value: unknown): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

function isSuggestionStrategy(value: unknown): boolean {
	return ["compact", "transcript-steering"].includes(String(value));
}

function isSuggestionDisplayMode(value: unknown): boolean {
	return ["ghost", "widget"].includes(String(value));
}

function isGhostAcceptKey(value: unknown): value is GhostAcceptKey {
	return ["space", "right", "enter"].includes(String(value));
}

function isGhostAcceptKeys(value: unknown): value is GhostAcceptKey[] {
	return Array.isArray(value) && value.length > 0 && value.every((entry) => isGhostAcceptKey(entry)) && new Set(value).size === value.length;
}

function isSchemaVersion(value: unknown): boolean {
	return typeof value === "number" && Number.isInteger(value) && value === CURRENT_CONFIG_SCHEMA_VERSION;
}

function isLoggingLevel(value: unknown): boolean {
	return ["debug", "info", "warn", "error"].includes(String(value));
}

type ValidatorMap<T> = {
	[K in keyof T]: (value: unknown) => boolean;
};

interface SectionNormalizationResult<T> {
	value: Partial<T>;
	changed: boolean;
	hasAny: boolean;
}

const seedValidators: ValidatorMap<SeedConfig> = {
	maxDiffChars: isPositiveInteger,
};
const seedShape: SeedConfig = { maxDiffChars: 1 };

const reseedValidators: ValidatorMap<ReseedConfig> = {
	enabled: isBoolean,
	checkOnSessionStart: isBoolean,
	checkAfterEveryTurn: isBoolean,
	turnCheckInterval: isNonNegativeInteger,
};
const reseedShape: ReseedConfig = {
	enabled: true,
	checkOnSessionStart: true,
	checkAfterEveryTurn: true,
	turnCheckInterval: 0,
};

const suggestionValidators: ValidatorMap<SuggestionConfig> = {
	noSuggestionToken: (value) => typeof value === "string",
	customInstruction: (value) => typeof value === "string",
	fastPathContinueOnError: isBoolean,
	displayMode: isSuggestionDisplayMode,
	ghostAcceptKeys: isGhostAcceptKeys,
	ghostAcceptAndSendKeys: isGhostAcceptKeys,
	maxAssistantTurnChars: isPositiveInteger,
	maxRecentUserPrompts: isPositiveInteger,
	maxRecentUserPromptChars: isPositiveInteger,
	maxToolSignals: isPositiveInteger,
	maxToolSignalChars: isPositiveInteger,
	maxTouchedFiles: isPositiveInteger,
	maxUnresolvedQuestions: isPositiveInteger,
	maxAbortContextChars: isPositiveInteger,
	maxSuggestionChars: isPositiveInteger,
	prefillOnlyWhenEditorEmpty: isBoolean,
	showUsageInPanel: isBoolean,
	showPanelStatus: isBoolean,
	strategy: isSuggestionStrategy,
	transcriptMaxContextPercent: isPositivePercentageInteger,
	transcriptMaxMessages: isPositiveInteger,
	transcriptMaxChars: isPositiveInteger,
	transcriptRolloutPercent: isPercentageInteger,
};
const suggestionShape: SuggestionConfig = {
	noSuggestionToken: "",
	customInstruction: "",
	fastPathContinueOnError: true,
	displayMode: "ghost",
	ghostAcceptKeys: ["right"],
	ghostAcceptAndSendKeys: ["enter"],
	maxAssistantTurnChars: 1,
	maxRecentUserPrompts: 1,
	maxRecentUserPromptChars: 1,
	maxToolSignals: 1,
	maxToolSignalChars: 1,
	maxTouchedFiles: 1,
	maxUnresolvedQuestions: 1,
	maxAbortContextChars: 1,
	maxSuggestionChars: 1,
	prefillOnlyWhenEditorEmpty: true,
	showUsageInPanel: true,
	showPanelStatus: true,
	strategy: "compact",
	transcriptMaxContextPercent: 1,
	transcriptMaxMessages: 1,
	transcriptMaxChars: 1,
	transcriptRolloutPercent: 0,
};

const steeringValidators: ValidatorMap<SteeringConfig> = {
	historyWindow: isPositiveInteger,
	acceptedThreshold: (value) => typeof value === "number" && isPositiveNumber(value) && value <= 1,
	maxChangedExamples: isPositiveInteger,
};
const steeringShape: SteeringConfig = { historyWindow: 1, acceptedThreshold: 0.5, maxChangedExamples: 1 };

const loggingValidators: ValidatorMap<LoggingConfig> = {
	level: isLoggingLevel,
};
const loggingShape: LoggingConfig = { level: "info" };

const inferenceValidators: ValidatorMap<InferenceConfig> = {
	seederModel: isModelSetting,
	suggesterModel: isModelSetting,
	seederThinking: isThinkingLevel,
	suggesterThinking: isThinkingLevel,
};
const inferenceShape: InferenceConfig = {
	seederModel: "session-default",
	suggesterModel: "session-default",
	seederThinking: "session-default",
	suggesterThinking: "session-default",
};

function normalizeSection<T extends object>(
	input: unknown,
	defaults: T,
	validators: ValidatorMap<T>,
	includeDefaults: boolean,
): SectionNormalizationResult<T> {
	const source = isObject(input) ? input : undefined;
	let changed = input !== undefined && !isObject(input);

	if (source) {
		const supportedKeys = new Set(Object.keys(defaults as Record<string, unknown>));
		for (const key of Object.keys(source)) {
			if (!supportedKeys.has(key)) {
				changed = true;
			}
		}
	}

	const result: Partial<T> = {};
	let hasAny = false;
	const mutableResult = result as Record<string, unknown>;
	const defaultEntries = defaults as Record<string, unknown>;
	for (const key of Object.keys(defaultEntries) as Array<keyof T & string>) {
		const raw = source?.[key];
		if (raw === undefined) {
			if (includeDefaults) {
				mutableResult[key] = defaultEntries[key];
			}
			continue;
		}

		const validator = validators[key];
		if (validator(raw)) {
			mutableResult[key] = raw;
			hasAny = true;
		} else {
			changed = true;
			if (includeDefaults) {
				mutableResult[key] = defaultEntries[key];
			}
		}
	}

	return {
		value: result,
		changed,
		hasAny,
	};
}

function hasUnknownTopLevelKeys(config: Record<string, unknown>, defaults: PromptSuggesterConfig): boolean {
	const supportedKeys = new Set(Object.keys(defaults));
	for (const key of Object.keys(config)) {
		if (!supportedKeys.has(key)) return true;
	}
	return false;
}

function validateSection<T extends object>(
	input: unknown,
	defaults: T,
	validators: ValidatorMap<T>,
): input is T {
	if (!isObject(input)) return false;
	const supportedKeys = new Set(Object.keys(defaults as Record<string, unknown>));
	for (const key of Object.keys(input)) {
		if (!supportedKeys.has(key)) return false;
	}
	for (const key of Object.keys(defaults as Record<string, unknown>) as Array<keyof T & string>) {
		if (!validators[key](input[key])) return false;
	}
	return true;
}

export function normalizeConfig(
	config: unknown,
	defaults: PromptSuggesterConfig,
): { config: PromptSuggesterConfig; changed: boolean } {
	const source = isObject(config) ? config : undefined;
	let changed = config !== undefined && !isObject(config);
	if (source) {
		changed = changed || source.schemaVersion !== defaults.schemaVersion || hasUnknownTopLevelKeys(source, defaults);
	}

	const seed = normalizeSection(source?.seed, defaults.seed, seedValidators, true);
	const reseed = normalizeSection(source?.reseed, defaults.reseed, reseedValidators, true);
	const suggestion = normalizeSection(source?.suggestion, defaults.suggestion, suggestionValidators, true);
	const steering = normalizeSection(source?.steering, defaults.steering, steeringValidators, true);
	const logging = normalizeSection(source?.logging, defaults.logging, loggingValidators, true);
	const inference = normalizeSection(source?.inference, defaults.inference, inferenceValidators, true);

	changed =
		changed ||
		seed.changed ||
		reseed.changed ||
		suggestion.changed ||
		steering.changed ||
		logging.changed ||
		inference.changed;

	return {
		config: {
			schemaVersion: defaults.schemaVersion,
			seed: seed.value as SeedConfig,
			reseed: reseed.value as ReseedConfig,
			suggestion: suggestion.value as SuggestionConfig,
			steering: steering.value as SteeringConfig,
			logging: logging.value as LoggingConfig,
			inference: inference.value as InferenceConfig,
		},
		changed,
	};
}

export function normalizeOverrideConfig(
	config: unknown,
	defaults: PromptSuggesterConfig,
): { config: Record<string, unknown>; changed: boolean } {
	const source = isObject(config) ? config : undefined;
	let changed = !isObject(config);
	if (source) {
		changed = changed || source.schemaVersion !== defaults.schemaVersion || hasUnknownTopLevelKeys(source, defaults);
	}

	const seed = normalizeSection(source?.seed, defaults.seed, seedValidators, false);
	const reseed = normalizeSection(source?.reseed, defaults.reseed, reseedValidators, false);
	const suggestion = normalizeSection(source?.suggestion, defaults.suggestion, suggestionValidators, false);
	const steering = normalizeSection(source?.steering, defaults.steering, steeringValidators, false);
	const logging = normalizeSection(source?.logging, defaults.logging, loggingValidators, false);
	const inference = normalizeSection(source?.inference, defaults.inference, inferenceValidators, false);

	changed =
		changed ||
		seed.changed ||
		reseed.changed ||
		suggestion.changed ||
		steering.changed ||
		logging.changed ||
		inference.changed;

	const normalized: Record<string, unknown> = {
		schemaVersion: defaults.schemaVersion,
	};
	if (seed.hasAny) normalized.seed = seed.value;
	if (reseed.hasAny) normalized.reseed = reseed.value;
	if (suggestion.hasAny) normalized.suggestion = suggestion.value;
	if (steering.hasAny) normalized.steering = steering.value;
	if (logging.hasAny) normalized.logging = logging.value;
	if (inference.hasAny) normalized.inference = inference.value;

	return {
		config: normalized,
		changed,
	};
}

export function validateConfig(config: unknown): config is PromptSuggesterConfig {
	if (!isObject(config)) return false;
	if (!isSchemaVersion(config.schemaVersion)) return false;
	if (hasUnknownTopLevelKeys(config, {
		schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
		seed: seedShape,
		reseed: reseedShape,
		suggestion: suggestionShape,
		steering: steeringShape,
		logging: loggingShape,
		inference: inferenceShape,
	})) return false;

	return (
		validateSection(config.seed, seedShape, seedValidators) &&
		validateSection(config.reseed, reseedShape, reseedValidators) &&
		validateSection(config.suggestion, suggestionShape, suggestionValidators) &&
		validateSection(config.steering, steeringShape, steeringValidators) &&
		validateSection(config.logging, loggingShape, loggingValidators) &&
		validateSection(config.inference, inferenceShape, inferenceValidators)
	);
}
