import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJsonIfExists } from "../infra/storage/json-file";
import { normalizeConfig, validateConfig } from "./schema";
import type { PromptSuggesterConfig } from "./types";

interface ConfigLoader {
	load(): Promise<PromptSuggesterConfig>;
}

type PiSettingsSuggesterOverride = {
	inference?: Partial<PromptSuggesterConfig["inference"]>;
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function deepMerge(base: unknown, override: unknown): unknown {
	if (!isObject(base) || !isObject(override)) {
		return override ?? base;
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
	return result;
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
			`Failed to load required default config ${filePath}: ${errorMessage(error)}`,
		);
	}

	if (!validateConfig(parsed)) {
		throw new Error(`Default config at ${filePath} is invalid.`);
	}
	return parsed;
}

const PACKAGE_DEFAULT_CONFIG_PATH = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../prompt-suggester.config.json",
);

async function readPiSettingsSuggesterOverride(
	settingsPath: string,
): Promise<PiSettingsSuggesterOverride | undefined> {
	let settings: unknown;
	try {
		settings = await readJsonIfExists(settingsPath);
	} catch (error) {
		throw new Error(
			`Failed to load Pi settings ${settingsPath}: ${errorMessage(error)}`,
		);
	}
	if (!isObject(settings)) return undefined;

	const promptSuggester = settings.promptSuggester;
	if (!isObject(promptSuggester)) return undefined;

	const suggesterModel = promptSuggester.suggesterModel;
	if (suggesterModel === undefined) return undefined;
	if (
		!Array.isArray(suggesterModel) ||
		suggesterModel.length === 0 ||
		!suggesterModel.every(
			(entry) => typeof entry === "string" && entry.trim().length > 0,
		)
	) {
		throw new Error(
			`Pi settings ${settingsPath} promptSuggester.suggesterModel must be a non-empty array of non-empty strings.`,
		);
	}

	return {
		inference: {
			suggesterModel,
		},
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
