import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";
import { CURRENT_CONFIG_SCHEMA_VERSION } from "./migrations";
import type {
	InferenceConfig,
	LoggingConfig,
	PromptSuggesterConfig,
	ReseedConfig,
	SeedConfig,
	SteeringConfig,
	SuggestionConfig,
} from "./types";

interface SectionNormalizationResult<T> {
	value: T;
	changed: boolean;
}

const recordSchema = Type.Record(Type.String(), Type.Unknown());
const positiveIntegerSchema = Type.Integer({ minimum: 1 });
const nonNegativeIntegerSchema = Type.Integer({ minimum: 0 });
const positiveNumberSchema = Type.Number({ exclusiveMinimum: 0 });
const percentageIntegerSchema = Type.Integer({ minimum: 0, maximum: 100 });
const positivePercentageIntegerSchema = Type.Integer({
	minimum: 1,
	maximum: 100,
});
const nonEmptyStringSchema = Type.Refine(
	Type.String(),
	(value) => value.trim().length > 0,
);
const nonEmptyStringArraySchema = Type.Array(nonEmptyStringSchema, {
	minItems: 1,
});
const thinkingLevelSchema = Type.Union([
	Type.Literal("minimal"),
	Type.Literal("low"),
	Type.Literal("medium"),
	Type.Literal("high"),
	Type.Literal("xhigh"),
	Type.Literal("session-default"),
]);
const suggestionStrategySchema = Type.Union([
	Type.Literal("compact"),
	Type.Literal("transcript-steering"),
]);
const ghostAcceptKeySchema = Type.Union([
	Type.Literal("space"),
	Type.Literal("right"),
	Type.Literal("enter"),
]);
const ghostAcceptKeysSchema = Type.Array(ghostAcceptKeySchema, {
	minItems: 1,
	uniqueItems: true,
});
const loggingLevelSchema = Type.Union([
	Type.Literal("debug"),
	Type.Literal("info"),
	Type.Literal("warn"),
	Type.Literal("error"),
]);

const seedSchema = Type.Object(
	{
		maxDiffChars: positiveIntegerSchema,
	},
	{ additionalProperties: false },
);

const reseedSchema = Type.Object(
	{
		enabled: Type.Boolean(),
		checkOnSessionStart: Type.Boolean(),
		checkAfterEveryTurn: Type.Boolean(),
		turnCheckInterval: nonNegativeIntegerSchema,
	},
	{ additionalProperties: false },
);

const suggestionSchema = Type.Object(
	{
		noSuggestionToken: Type.String(),
		customInstruction: Type.String(),
		fastPathContinueOnError: Type.Boolean(),
		ghostAcceptKeys: ghostAcceptKeysSchema,
		ghostAcceptAndSendKeys: ghostAcceptKeysSchema,
		maxAssistantTurnChars: positiveIntegerSchema,
		maxRecentUserPrompts: positiveIntegerSchema,
		maxRecentUserPromptChars: positiveIntegerSchema,
		maxToolSignals: positiveIntegerSchema,
		maxToolSignalChars: positiveIntegerSchema,
		maxTouchedFiles: positiveIntegerSchema,
		maxUnresolvedQuestions: positiveIntegerSchema,
		maxAbortContextChars: positiveIntegerSchema,
		maxSuggestionChars: positiveIntegerSchema,
		prefillOnlyWhenEditorEmpty: Type.Boolean(),
		showUsageInPanel: Type.Boolean(),
		showPanelStatus: Type.Boolean(),
		strategy: suggestionStrategySchema,
		transcriptMaxContextPercent: positivePercentageIntegerSchema,
		transcriptMaxMessages: positiveIntegerSchema,
		transcriptMaxChars: positiveIntegerSchema,
		transcriptRolloutPercent: percentageIntegerSchema,
	},
	{ additionalProperties: false },
);

const steeringSchema = Type.Object(
	{
		historyWindow: positiveIntegerSchema,
		acceptedThreshold: Type.Intersect([
			positiveNumberSchema,
			Type.Number({ maximum: 1 }),
		]),
		maxChangedExamples: positiveIntegerSchema,
	},
	{ additionalProperties: false },
);

const loggingSchema = Type.Object(
	{
		level: loggingLevelSchema,
	},
	{ additionalProperties: false },
);

const inferenceSchema = Type.Object(
	{
		seederModel: nonEmptyStringSchema,
		suggesterModel: nonEmptyStringArraySchema,
		seederThinking: thinkingLevelSchema,
		suggesterThinking: thinkingLevelSchema,
	},
	{ additionalProperties: false },
);

const promptSuggesterConfigSchema = Type.Object(
	{
		schemaVersion: Type.Literal(CURRENT_CONFIG_SCHEMA_VERSION),
		seed: seedSchema,
		reseed: reseedSchema,
		suggestion: suggestionSchema,
		steering: steeringSchema,
		logging: loggingSchema,
		inference: inferenceSchema,
	},
	{ additionalProperties: false },
);

function hasUnknownKeys(
	source: Record<string, unknown>,
	defaults: object,
): boolean {
	const supportedKeys = new Set(Object.keys(defaults));
	return Object.keys(source).some((key) => !supportedKeys.has(key));
}

function objectSource(
	input: unknown,
	defaults: object,
): { source: Record<string, unknown> | undefined; changed: boolean } {
	const source = Value.Check(recordSchema, input) ? input : undefined;
	return {
		source,
		changed:
			(input !== undefined && !source) ||
			(source ? hasUnknownKeys(source, defaults) : false),
	};
}

function normalizeProperty<const T extends TSchema>(
	schema: T,
	input: unknown,
	fallback: Static<T>,
): { value: Static<T>; changed: boolean } {
	if (input === undefined) return { value: fallback, changed: false };
	return Value.Check(schema, input)
		? { value: input, changed: false }
		: { value: fallback, changed: true };
}

function normalizeSeedConfig(
	input: unknown,
	defaults: SeedConfig,
): SectionNormalizationResult<SeedConfig> {
	const { source, changed } = objectSource(input, defaults);
	const maxDiffChars = normalizeProperty(
		positiveIntegerSchema,
		source?.maxDiffChars,
		defaults.maxDiffChars,
	);
	return {
		value: { maxDiffChars: maxDiffChars.value },
		changed: changed || maxDiffChars.changed,
	};
}

function normalizeReseedConfig(
	input: unknown,
	defaults: ReseedConfig,
): SectionNormalizationResult<ReseedConfig> {
	const { source, changed } = objectSource(input, defaults);
	const enabled = normalizeProperty(
		Type.Boolean(),
		source?.enabled,
		defaults.enabled,
	);
	const checkOnSessionStart = normalizeProperty(
		Type.Boolean(),
		source?.checkOnSessionStart,
		defaults.checkOnSessionStart,
	);
	const checkAfterEveryTurn = normalizeProperty(
		Type.Boolean(),
		source?.checkAfterEveryTurn,
		defaults.checkAfterEveryTurn,
	);
	const turnCheckInterval = normalizeProperty(
		nonNegativeIntegerSchema,
		source?.turnCheckInterval,
		defaults.turnCheckInterval,
	);
	return {
		value: {
			enabled: enabled.value,
			checkOnSessionStart: checkOnSessionStart.value,
			checkAfterEveryTurn: checkAfterEveryTurn.value,
			turnCheckInterval: turnCheckInterval.value,
		},
		changed:
			changed ||
			enabled.changed ||
			checkOnSessionStart.changed ||
			checkAfterEveryTurn.changed ||
			turnCheckInterval.changed,
	};
}

function normalizeSuggestionConfig(
	input: unknown,
	defaults: SuggestionConfig,
): SectionNormalizationResult<SuggestionConfig> {
	const { source, changed } = objectSource(input, defaults);
	const noSuggestionToken = normalizeProperty(
		Type.String(),
		source?.noSuggestionToken,
		defaults.noSuggestionToken,
	);
	const customInstruction = normalizeProperty(
		Type.String(),
		source?.customInstruction,
		defaults.customInstruction,
	);
	const fastPathContinueOnError = normalizeProperty(
		Type.Boolean(),
		source?.fastPathContinueOnError,
		defaults.fastPathContinueOnError,
	);
	const ghostAcceptKeys = normalizeProperty(
		ghostAcceptKeysSchema,
		source?.ghostAcceptKeys,
		defaults.ghostAcceptKeys,
	);
	const ghostAcceptAndSendKeys = normalizeProperty(
		ghostAcceptKeysSchema,
		source?.ghostAcceptAndSendKeys,
		defaults.ghostAcceptAndSendKeys,
	);
	const maxAssistantTurnChars = normalizeProperty(
		positiveIntegerSchema,
		source?.maxAssistantTurnChars,
		defaults.maxAssistantTurnChars,
	);
	const maxRecentUserPrompts = normalizeProperty(
		positiveIntegerSchema,
		source?.maxRecentUserPrompts,
		defaults.maxRecentUserPrompts,
	);
	const maxRecentUserPromptChars = normalizeProperty(
		positiveIntegerSchema,
		source?.maxRecentUserPromptChars,
		defaults.maxRecentUserPromptChars,
	);
	const maxToolSignals = normalizeProperty(
		positiveIntegerSchema,
		source?.maxToolSignals,
		defaults.maxToolSignals,
	);
	const maxToolSignalChars = normalizeProperty(
		positiveIntegerSchema,
		source?.maxToolSignalChars,
		defaults.maxToolSignalChars,
	);
	const maxTouchedFiles = normalizeProperty(
		positiveIntegerSchema,
		source?.maxTouchedFiles,
		defaults.maxTouchedFiles,
	);
	const maxUnresolvedQuestions = normalizeProperty(
		positiveIntegerSchema,
		source?.maxUnresolvedQuestions,
		defaults.maxUnresolvedQuestions,
	);
	const maxAbortContextChars = normalizeProperty(
		positiveIntegerSchema,
		source?.maxAbortContextChars,
		defaults.maxAbortContextChars,
	);
	const maxSuggestionChars = normalizeProperty(
		positiveIntegerSchema,
		source?.maxSuggestionChars,
		defaults.maxSuggestionChars,
	);
	const prefillOnlyWhenEditorEmpty = normalizeProperty(
		Type.Boolean(),
		source?.prefillOnlyWhenEditorEmpty,
		defaults.prefillOnlyWhenEditorEmpty,
	);
	const showUsageInPanel = normalizeProperty(
		Type.Boolean(),
		source?.showUsageInPanel,
		defaults.showUsageInPanel,
	);
	const showPanelStatus = normalizeProperty(
		Type.Boolean(),
		source?.showPanelStatus,
		defaults.showPanelStatus,
	);
	const strategy = normalizeProperty(
		suggestionStrategySchema,
		source?.strategy,
		defaults.strategy,
	);
	const transcriptMaxContextPercent = normalizeProperty(
		positivePercentageIntegerSchema,
		source?.transcriptMaxContextPercent,
		defaults.transcriptMaxContextPercent,
	);
	const transcriptMaxMessages = normalizeProperty(
		positiveIntegerSchema,
		source?.transcriptMaxMessages,
		defaults.transcriptMaxMessages,
	);
	const transcriptMaxChars = normalizeProperty(
		positiveIntegerSchema,
		source?.transcriptMaxChars,
		defaults.transcriptMaxChars,
	);
	const transcriptRolloutPercent = normalizeProperty(
		percentageIntegerSchema,
		source?.transcriptRolloutPercent,
		defaults.transcriptRolloutPercent,
	);
	return {
		value: {
			noSuggestionToken: noSuggestionToken.value,
			customInstruction: customInstruction.value,
			fastPathContinueOnError: fastPathContinueOnError.value,
			ghostAcceptKeys: ghostAcceptKeys.value,
			ghostAcceptAndSendKeys: ghostAcceptAndSendKeys.value,
			maxAssistantTurnChars: maxAssistantTurnChars.value,
			maxRecentUserPrompts: maxRecentUserPrompts.value,
			maxRecentUserPromptChars: maxRecentUserPromptChars.value,
			maxToolSignals: maxToolSignals.value,
			maxToolSignalChars: maxToolSignalChars.value,
			maxTouchedFiles: maxTouchedFiles.value,
			maxUnresolvedQuestions: maxUnresolvedQuestions.value,
			maxAbortContextChars: maxAbortContextChars.value,
			maxSuggestionChars: maxSuggestionChars.value,
			prefillOnlyWhenEditorEmpty: prefillOnlyWhenEditorEmpty.value,
			showUsageInPanel: showUsageInPanel.value,
			showPanelStatus: showPanelStatus.value,
			strategy: strategy.value,
			transcriptMaxContextPercent: transcriptMaxContextPercent.value,
			transcriptMaxMessages: transcriptMaxMessages.value,
			transcriptMaxChars: transcriptMaxChars.value,
			transcriptRolloutPercent: transcriptRolloutPercent.value,
		},
		changed:
			changed ||
			noSuggestionToken.changed ||
			customInstruction.changed ||
			fastPathContinueOnError.changed ||
			ghostAcceptKeys.changed ||
			ghostAcceptAndSendKeys.changed ||
			maxAssistantTurnChars.changed ||
			maxRecentUserPrompts.changed ||
			maxRecentUserPromptChars.changed ||
			maxToolSignals.changed ||
			maxToolSignalChars.changed ||
			maxTouchedFiles.changed ||
			maxUnresolvedQuestions.changed ||
			maxAbortContextChars.changed ||
			maxSuggestionChars.changed ||
			prefillOnlyWhenEditorEmpty.changed ||
			showUsageInPanel.changed ||
			showPanelStatus.changed ||
			strategy.changed ||
			transcriptMaxContextPercent.changed ||
			transcriptMaxMessages.changed ||
			transcriptMaxChars.changed ||
			transcriptRolloutPercent.changed,
	};
}

function normalizeSteeringConfig(
	input: unknown,
	defaults: SteeringConfig,
): SectionNormalizationResult<SteeringConfig> {
	const { source, changed } = objectSource(input, defaults);
	const historyWindow = normalizeProperty(
		positiveIntegerSchema,
		source?.historyWindow,
		defaults.historyWindow,
	);
	const acceptedThreshold = normalizeProperty(
		Type.Intersect([positiveNumberSchema, Type.Number({ maximum: 1 })]),
		source?.acceptedThreshold,
		defaults.acceptedThreshold,
	);
	const maxChangedExamples = normalizeProperty(
		positiveIntegerSchema,
		source?.maxChangedExamples,
		defaults.maxChangedExamples,
	);
	return {
		value: {
			historyWindow: historyWindow.value,
			acceptedThreshold: acceptedThreshold.value,
			maxChangedExamples: maxChangedExamples.value,
		},
		changed:
			changed ||
			historyWindow.changed ||
			acceptedThreshold.changed ||
			maxChangedExamples.changed,
	};
}

function normalizeLoggingConfig(
	input: unknown,
	defaults: LoggingConfig,
): SectionNormalizationResult<LoggingConfig> {
	const { source, changed } = objectSource(input, defaults);
	const level = normalizeProperty(
		loggingLevelSchema,
		source?.level,
		defaults.level,
	);
	return {
		value: { level: level.value },
		changed: changed || level.changed,
	};
}

function normalizeInferenceConfig(
	input: unknown,
	defaults: InferenceConfig,
): SectionNormalizationResult<InferenceConfig> {
	const { source, changed } = objectSource(input, defaults);
	const seederModel = normalizeProperty(
		nonEmptyStringSchema,
		source?.seederModel,
		defaults.seederModel,
	);
	const suggesterModel = normalizeProperty(
		nonEmptyStringArraySchema,
		source?.suggesterModel,
		defaults.suggesterModel,
	);
	const seederThinking = normalizeProperty(
		thinkingLevelSchema,
		source?.seederThinking,
		defaults.seederThinking,
	);
	const suggesterThinking = normalizeProperty(
		thinkingLevelSchema,
		source?.suggesterThinking,
		defaults.suggesterThinking,
	);
	return {
		value: {
			seederModel: seederModel.value,
			suggesterModel: suggesterModel.value,
			seederThinking: seederThinking.value,
			suggesterThinking: suggesterThinking.value,
		},
		changed:
			changed ||
			seederModel.changed ||
			suggesterModel.changed ||
			seederThinking.changed ||
			suggesterThinking.changed,
	};
}

export function normalizeConfig(
	config: unknown,
	defaults: PromptSuggesterConfig,
): { config: PromptSuggesterConfig; changed: boolean } {
	const source = Value.Check(recordSchema, config) ? config : undefined;
	let changed = config !== undefined && !source;
	if (source) {
		changed =
			changed ||
			source.schemaVersion !== defaults.schemaVersion ||
			hasUnknownKeys(source, defaults);
	}

	const seed = normalizeSeedConfig(source?.seed, defaults.seed);
	const reseed = normalizeReseedConfig(source?.reseed, defaults.reseed);
	const suggestion = normalizeSuggestionConfig(
		source?.suggestion,
		defaults.suggestion,
	);
	const steering = normalizeSteeringConfig(source?.steering, defaults.steering);
	const logging = normalizeLoggingConfig(source?.logging, defaults.logging);
	const inference = normalizeInferenceConfig(
		source?.inference,
		defaults.inference,
	);

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
			seed: seed.value,
			reseed: reseed.value,
			suggestion: suggestion.value,
			steering: steering.value,
			logging: logging.value,
			inference: inference.value,
		},
		changed,
	};
}

export function validateConfig(
	config: unknown,
): config is PromptSuggesterConfig {
	return Value.Check(promptSuggesterConfigSchema, config);
}
