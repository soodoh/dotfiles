import { promises as fs } from "node:fs";
import path from "node:path";
import { readJsonIfExists, writeJson } from "../storage/json-file.js";
const DEFAULT_VARIANT_NAME = "default";
const DEFAULT_FILE = {
    activeVariant: DEFAULT_VARIANT_NAME,
    variants: {
        [DEFAULT_VARIANT_NAME]: {},
    },
};
function isThinkingValue(value) {
    return ["minimal", "low", "medium", "high", "xhigh", "session-default"].includes(String(value));
}
function isPositiveInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}
function isPercentageInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}
function isPositivePercentageInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100;
}
function isStrategy(value) {
    return value === "compact" || value === "transcript-steering";
}
function normalizeVariant(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return {};
    const raw = value;
    const next = {};
    if (isStrategy(raw.strategy))
        next.strategy = raw.strategy;
    if (typeof raw.suggesterModel === "string" && raw.suggesterModel.trim())
        next.suggesterModel = raw.suggesterModel.trim();
    if (isThinkingValue(raw.suggesterThinking))
        next.suggesterThinking = raw.suggesterThinking;
    if (isPositiveInteger(raw.maxSuggestionChars))
        next.maxSuggestionChars = raw.maxSuggestionChars;
    if (isPositiveInteger(raw.maxRecentUserPrompts))
        next.maxRecentUserPrompts = raw.maxRecentUserPrompts;
    if (isPositiveInteger(raw.maxRecentUserPromptChars))
        next.maxRecentUserPromptChars = raw.maxRecentUserPromptChars;
    if (isPositiveInteger(raw.maxChangedExamples))
        next.maxChangedExamples = raw.maxChangedExamples;
    if (isPositivePercentageInteger(raw.transcriptMaxContextPercent)) {
        next.transcriptMaxContextPercent = raw.transcriptMaxContextPercent;
    }
    if (isPositiveInteger(raw.transcriptMaxMessages))
        next.transcriptMaxMessages = raw.transcriptMaxMessages;
    if (isPositiveInteger(raw.transcriptMaxChars))
        next.transcriptMaxChars = raw.transcriptMaxChars;
    if (isPercentageInteger(raw.transcriptRolloutPercent))
        next.transcriptRolloutPercent = raw.transcriptRolloutPercent;
    return next;
}
function normalizeFile(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { value: DEFAULT_FILE, changed: true };
    }
    const input = raw;
    const normalizedVariants = {};
    let changed = false;
    const rawVariants = input.variants;
    if (rawVariants && typeof rawVariants === "object" && !Array.isArray(rawVariants)) {
        for (const [name, value] of Object.entries(rawVariants)) {
            const trimmed = name.trim();
            if (!trimmed) {
                changed = true;
                continue;
            }
            const normalized = normalizeVariant(value);
            normalizedVariants[trimmed] = normalized;
            if (JSON.stringify(normalized) !== JSON.stringify(value))
                changed = true;
        }
    }
    else if (rawVariants !== undefined) {
        changed = true;
    }
    if (!normalizedVariants[DEFAULT_VARIANT_NAME]) {
        normalizedVariants[DEFAULT_VARIANT_NAME] = {};
        changed = true;
    }
    const activeVariant = typeof input.activeVariant === "string" && normalizedVariants[input.activeVariant]
        ? input.activeVariant
        : DEFAULT_VARIANT_NAME;
    if (activeVariant !== input.activeVariant)
        changed = true;
    const value = {
        activeVariant,
        variants: normalizedVariants,
    };
    if (JSON.stringify(value) !== JSON.stringify(raw))
        changed = true;
    return { value, changed };
}
function cloneConfig(config) {
    return JSON.parse(JSON.stringify(config));
}
function createEmptyStats() {
    return {
        compared: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        bothBad: 0,
    };
}
export class SuggesterVariantStore {
    stateDir;
    filePath;
    resultsPath;
    state = DEFAULT_FILE;
    constructor(stateDir) {
        this.stateDir = stateDir;
        this.filePath = path.join(this.stateDir, "variants.json");
        this.resultsPath = path.join(this.stateDir, "ab-results.ndjson");
    }
    async init() {
        const raw = await readJsonIfExists(this.filePath);
        if (raw === undefined) {
            this.state = DEFAULT_FILE;
            return;
        }
        const normalized = normalizeFile(raw);
        this.state = normalized.value;
        if (normalized.changed)
            await this.persist();
    }
    getActiveVariantName() {
        return this.state.activeVariant;
    }
    listVariants() {
        return Object.keys(this.state.variants)
            .sort((a, b) => a.localeCompare(b))
            .map((name) => ({
            name,
            variant: this.state.variants[name],
            active: name === this.state.activeVariant,
        }));
    }
    getVariant(name) {
        return this.state.variants[name];
    }
    getEffectiveConfig(baseConfig, variantName = this.state.activeVariant) {
        const config = cloneConfig(baseConfig);
        const variant = this.state.variants[variantName];
        if (!variant)
            return config;
        if (variant.strategy !== undefined)
            config.suggestion.strategy = variant.strategy;
        if (variant.suggesterModel !== undefined)
            config.inference.suggesterModel = variant.suggesterModel;
        if (variant.suggesterThinking !== undefined)
            config.inference.suggesterThinking = variant.suggesterThinking;
        if (variant.maxSuggestionChars !== undefined)
            config.suggestion.maxSuggestionChars = variant.maxSuggestionChars;
        if (variant.maxRecentUserPrompts !== undefined)
            config.suggestion.maxRecentUserPrompts = variant.maxRecentUserPrompts;
        if (variant.maxRecentUserPromptChars !== undefined) {
            config.suggestion.maxRecentUserPromptChars = variant.maxRecentUserPromptChars;
        }
        if (variant.maxChangedExamples !== undefined)
            config.steering.maxChangedExamples = variant.maxChangedExamples;
        if (variant.transcriptMaxContextPercent !== undefined) {
            config.suggestion.transcriptMaxContextPercent = variant.transcriptMaxContextPercent;
        }
        if (variant.transcriptMaxMessages !== undefined)
            config.suggestion.transcriptMaxMessages = variant.transcriptMaxMessages;
        if (variant.transcriptMaxChars !== undefined)
            config.suggestion.transcriptMaxChars = variant.transcriptMaxChars;
        if (variant.transcriptRolloutPercent !== undefined) {
            config.suggestion.transcriptRolloutPercent = variant.transcriptRolloutPercent;
        }
        return config;
    }
    async createVariant(name, sourceName) {
        const trimmed = name.trim();
        if (!trimmed)
            throw new Error("Variant name is required.");
        if (this.state.variants[trimmed])
            throw new Error(`Variant already exists: ${trimmed}`);
        const source = sourceName ? this.state.variants[sourceName] : this.state.variants[this.state.activeVariant];
        this.state = {
            ...this.state,
            variants: {
                ...this.state.variants,
                [trimmed]: source ? JSON.parse(JSON.stringify(source)) : {},
            },
        };
        await this.persist();
    }
    async updateVariant(name, variant) {
        if (!this.state.variants[name])
            throw new Error(`Unknown variant: ${name}`);
        this.state = {
            ...this.state,
            variants: {
                ...this.state.variants,
                [name]: normalizeVariant(variant),
            },
        };
        await this.persist();
    }
    async renameVariant(from, to) {
        if (!this.state.variants[from])
            throw new Error(`Unknown variant: ${from}`);
        const trimmed = to.trim();
        if (!trimmed)
            throw new Error("New variant name is required.");
        if (this.state.variants[trimmed])
            throw new Error(`Variant already exists: ${trimmed}`);
        const variants = { ...this.state.variants };
        variants[trimmed] = variants[from];
        delete variants[from];
        this.state = {
            activeVariant: this.state.activeVariant === from ? trimmed : this.state.activeVariant,
            variants,
        };
        await this.persist();
    }
    async duplicateVariant(sourceName, newName) {
        if (!this.state.variants[sourceName])
            throw new Error(`Unknown variant: ${sourceName}`);
        await this.createVariant(newName, sourceName);
    }
    async deleteVariant(name) {
        if (name === DEFAULT_VARIANT_NAME)
            throw new Error("The default variant cannot be deleted.");
        if (!this.state.variants[name])
            throw new Error(`Unknown variant: ${name}`);
        const variants = { ...this.state.variants };
        delete variants[name];
        this.state = {
            activeVariant: this.state.activeVariant === name ? DEFAULT_VARIANT_NAME : this.state.activeVariant,
            variants,
        };
        await this.persist();
    }
    async setActiveVariant(name) {
        if (!this.state.variants[name])
            throw new Error(`Unknown variant: ${name}`);
        this.state = {
            ...this.state,
            activeVariant: name,
        };
        await this.persist();
    }
    async recordResult(record) {
        await fs.mkdir(path.dirname(this.resultsPath), { recursive: true });
        await fs.appendFile(this.resultsPath, `${JSON.stringify(record)}\n`, "utf8");
    }
    async getStats() {
        let raw = "";
        try {
            raw = await fs.readFile(this.resultsPath, "utf8");
        }
        catch (error) {
            if (error.code === "ENOENT")
                return {};
            throw error;
        }
        const stats = {};
        for (const line of raw.split(/\r?\n/)) {
            if (!line.trim())
                continue;
            let parsed;
            try {
                parsed = JSON.parse(line);
            }
            catch {
                continue;
            }
            const a = stats[parsed.variantA] ?? (stats[parsed.variantA] = createEmptyStats());
            const b = stats[parsed.variantB] ?? (stats[parsed.variantB] = createEmptyStats());
            a.compared += 1;
            b.compared += 1;
            if (parsed.winner === "A") {
                a.wins += 1;
                b.losses += 1;
            }
            else if (parsed.winner === "B") {
                b.wins += 1;
                a.losses += 1;
            }
            else if (parsed.winner === "tie") {
                a.ties += 1;
                b.ties += 1;
            }
            else {
                a.bothBad += 1;
                b.bothBad += 1;
            }
        }
        return stats;
    }
    async persist() {
        await writeJson(this.filePath, this.state);
    }
}
