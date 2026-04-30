import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonIfExists } from "../infra/storage/json-file.js";
import { normalizeConfig, validateConfig } from "./schema.js";
import type { PromptSuggesterConfig } from "./types.js";

export interface ConfigLoader {
	load(): Promise<PromptSuggesterConfig>;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: unknown): T {
	if (!isObject(base) || !isObject(override)) {
		return (override as T) ?? base;
	}

	const result: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(override)) {
		const existing = result[key];
		if (isObject(existing) && isObject(value)) {
			result[key] = deepMerge(existing, value);
		} else if (value !== undefined) {
			result[key] = value;
		}
	}
	return result as T;
}

async function readRequiredConfig(
	filePath: string,
): Promise<PromptSuggesterConfig> {
	let parsed: unknown;
	try {
		const raw = await fs.readFile(filePath, "utf8");
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(
			`Failed to load required default config ${filePath}: ${(error as Error).message}`,
		);
	}

	if (!validateConfig(parsed)) {
		throw new Error(`Default config at ${filePath} is invalid.`);
	}
	return parsed;
}

const PACKAGE_DEFAULT_CONFIG_PATH = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../config/prompt-suggester.config.json",
);

async function readPiSettingsSuggesterOverride(
	settingsPath: string,
): Promise<Partial<PromptSuggesterConfig> | undefined> {
	let settings: unknown;
	try {
		settings = await readJsonIfExists(settingsPath);
	} catch (error) {
		throw new Error(
			`Failed to load Pi settings ${settingsPath}: ${(error as Error).message}`,
		);
	}
	if (!isObject(settings)) return undefined;

	const promptSuggester = settings.promptSuggester;
	if (!isObject(promptSuggester)) return undefined;

	const suggesterModel = promptSuggester.suggesterModel;
	if (suggesterModel === undefined) return undefined;
	if (
		typeof suggesterModel !== "string" ||
		suggesterModel.trim().length === 0
	) {
		throw new Error(
			`Pi settings ${settingsPath} promptSuggester.suggesterModel must be a non-empty string.`,
		);
	}

	return {
		inference: {
			suggesterModel,
		} as Partial<
			PromptSuggesterConfig["inference"]
		> as PromptSuggesterConfig["inference"],
	};
}

export class FileConfigLoader implements ConfigLoader {
	public constructor(
		_cwd: string = process.cwd(),
		private readonly homeDir: string = os.homedir(),
	) {}

	public async load(): Promise<PromptSuggesterConfig> {
		const defaultPath = PACKAGE_DEFAULT_CONFIG_PATH;
		const settingsPath = path.join(
			this.homeDir,
			".pi",
			"agent",
			"settings.json",
		);

		const defaultConfig = await readRequiredConfig(defaultPath);
		const settingsOverride =
			await readPiSettingsSuggesterOverride(settingsPath);
		const merged = deepMerge(defaultConfig, settingsOverride);
		const normalized = normalizeConfig(merged, defaultConfig);

		if (!validateConfig(normalized.config)) {
			throw new Error(
				`Failed to normalize suggester config. Base defaults from ${defaultPath}; override from ${settingsPath}.`,
			);
		}
		return normalized.config;
	}
}
