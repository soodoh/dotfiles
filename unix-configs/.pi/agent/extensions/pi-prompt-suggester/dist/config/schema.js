import { CURRENT_CONFIG_SCHEMA_VERSION } from "./migrations.js";
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isBoolean(value) {
    return typeof value === "boolean";
}
function isPositiveInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}
function isNonNegativeInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
function isPositiveNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}
function isPercentageInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}
function isPositivePercentageInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100;
}
function isThinkingLevel(value) {
    return ["minimal", "low", "medium", "high", "xhigh", "session-default"].includes(String(value));
}
function isModelSetting(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function isSuggestionStrategy(value) {
    return ["compact", "transcript-steering"].includes(String(value));
}
function isSuggestionDisplayMode(value) {
    return ["ghost", "widget"].includes(String(value));
}
function isGhostAcceptKey(value) {
    return ["space", "right", "enter"].includes(String(value));
}
function isGhostAcceptKeys(value) {
    return Array.isArray(value) && value.length > 0 && value.every((entry) => isGhostAcceptKey(entry)) && new Set(value).size === value.length;
}
function isSchemaVersion(value) {
    return typeof value === "number" && Number.isInteger(value) && value === CURRENT_CONFIG_SCHEMA_VERSION;
}
function isLoggingLevel(value) {
    return ["debug", "info", "warn", "error"].includes(String(value));
}
const seedValidators = {
    maxDiffChars: isPositiveInteger,
};
const seedShape = { maxDiffChars: 1 };
const reseedValidators = {
    enabled: isBoolean,
    checkOnSessionStart: isBoolean,
    checkAfterEveryTurn: isBoolean,
    turnCheckInterval: isNonNegativeInteger,
};
const reseedShape = {
    enabled: true,
    checkOnSessionStart: true,
    checkAfterEveryTurn: true,
    turnCheckInterval: 0,
};
const suggestionValidators = {
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
const suggestionShape = {
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
const steeringValidators = {
    historyWindow: isPositiveInteger,
    acceptedThreshold: (value) => typeof value === "number" && isPositiveNumber(value) && value <= 1,
    maxChangedExamples: isPositiveInteger,
};
const steeringShape = { historyWindow: 1, acceptedThreshold: 0.5, maxChangedExamples: 1 };
const loggingValidators = {
    level: isLoggingLevel,
};
const loggingShape = { level: "info" };
const inferenceValidators = {
    seederModel: isModelSetting,
    suggesterModel: isModelSetting,
    seederThinking: isThinkingLevel,
    suggesterThinking: isThinkingLevel,
};
const inferenceShape = {
    seederModel: "session-default",
    suggesterModel: "session-default",
    seederThinking: "session-default",
    suggesterThinking: "session-default",
};
function normalizeSection(input, defaults, validators, includeDefaults) {
    const source = isObject(input) ? input : undefined;
    let changed = input !== undefined && !isObject(input);
    if (source) {
        const supportedKeys = new Set(Object.keys(defaults));
        for (const key of Object.keys(source)) {
            if (!supportedKeys.has(key)) {
                changed = true;
            }
        }
    }
    const result = {};
    let hasAny = false;
    const mutableResult = result;
    const defaultEntries = defaults;
    for (const key of Object.keys(defaultEntries)) {
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
        }
        else {
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
function hasUnknownTopLevelKeys(config, defaults) {
    const supportedKeys = new Set(Object.keys(defaults));
    for (const key of Object.keys(config)) {
        if (!supportedKeys.has(key))
            return true;
    }
    return false;
}
function validateSection(input, defaults, validators) {
    if (!isObject(input))
        return false;
    const supportedKeys = new Set(Object.keys(defaults));
    for (const key of Object.keys(input)) {
        if (!supportedKeys.has(key))
            return false;
    }
    for (const key of Object.keys(defaults)) {
        if (!validators[key](input[key]))
            return false;
    }
    return true;
}
export function normalizeConfig(config, defaults) {
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
export function normalizeOverrideConfig(config, defaults) {
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
    const normalized = {
        schemaVersion: defaults.schemaVersion,
    };
    if (seed.hasAny)
        normalized.seed = seed.value;
    if (reseed.hasAny)
        normalized.reseed = reseed.value;
    if (suggestion.hasAny)
        normalized.suggestion = suggestion.value;
    if (steering.hasAny)
        normalized.steering = steering.value;
    if (logging.hasAny)
        normalized.logging = logging.value;
    if (inference.hasAny)
        normalized.inference = inference.value;
    return {
        config: normalized,
        changed,
    };
}
export function validateConfig(config) {
    if (!isObject(config))
        return false;
    if (!isSchemaVersion(config.schemaVersion))
        return false;
    if (hasUnknownTopLevelKeys(config, {
        schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
        seed: seedShape,
        reseed: reseedShape,
        suggestion: suggestionShape,
        steering: steeringShape,
        logging: loggingShape,
        inference: inferenceShape,
    }))
        return false;
    return (validateSection(config.seed, seedShape, seedValidators) &&
        validateSection(config.reseed, reseedShape, reseedValidators) &&
        validateSection(config.suggestion, suggestionShape, suggestionValidators) &&
        validateSection(config.steering, steeringShape, steeringValidators) &&
        validateSection(config.logging, loggingShape, loggingValidators) &&
        validateSection(config.inference, inferenceShape, inferenceValidators));
}
