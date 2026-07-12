export const CURRENT_SEED_VERSION = 3;
export const CURRENT_GENERATOR_VERSION = "2026-03-11.2";
export const SEEDER_PROMPT_VERSION = "2026-03-11.2";
export const SUGGESTION_PROMPT_VERSION = "2026-03-11.1";

type ReseedReason =
	| "initial_missing"
	| "manual"
	| "key_file_changed"
	| "config_changed"
	| "generator_changed";

export type SeedKeyFileCategory =
	| "vision"
	| "architecture"
	| "principles_guidelines"
	| "code_entrypoint"
	| "other";

export const REQUIRED_SEED_CATEGORIES: SeedKeyFileCategory[] = [
	"vision",
	"architecture",
	"principles_guidelines",
];

interface SeedCategoryFinding {
	found: boolean;
	rationale: string;
	files: string[];
}

export type SeedCategoryFindings = Record<
	"vision" | "architecture" | "principles_guidelines",
	SeedCategoryFinding
>;

interface SeedKeyFile {
	path: string;
	hash: string;
	whyImportant: string;
	category: SeedKeyFileCategory;
}

export interface SeedArtifact {
	seedVersion: number;
	generatedAt: string;
	sourceCommit?: string;
	generatorVersion: string;
	seederPromptVersion: string;
	suggestionPromptVersion: string;
	configFingerprint: string;
	modelId?: string;

	projectIntentSummary: string;
	objectivesSummary: string;
	constraintsSummary: string;
	principlesGuidelinesSummary: string;
	implementationStatusSummary: string;

	// Backward-compatible structured slices retained for prompt shaping.
	topObjectives: string[];
	constraints: string[];

	keyFiles: SeedKeyFile[];
	categoryFindings?: SeedCategoryFindings;
	openQuestions: string[];
	reseedNotes?: string;
	lastReseedReason?: ReseedReason;
	lastChangedFiles?: string[];
}

export interface SeedDraft {
	projectIntentSummary: string;
	objectivesSummary: string;
	constraintsSummary: string;
	principlesGuidelinesSummary: string;
	implementationStatusSummary: string;
	topObjectives: string[];
	constraints: string[];
	keyFiles: Array<Pick<SeedKeyFile, "path" | "whyImportant" | "category">>;
	categoryFindings?: SeedCategoryFindings;
	openQuestions: string[];
	reseedNotes?: string;
}

export interface ReseedTrigger {
	reason: ReseedReason;
	changedFiles: string[];
	gitDiffSummary?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((entry) => typeof entry === "string")
	);
}

function isSeedKeyFileCategory(value: unknown): value is SeedKeyFileCategory {
	return (
		value === "vision" ||
		value === "architecture" ||
		value === "principles_guidelines" ||
		value === "code_entrypoint" ||
		value === "other"
	);
}

function isSeedKeyFile(value: unknown): value is SeedKeyFile {
	if (!isRecord(value)) return false;
	return (
		typeof value.path === "string" &&
		typeof value.hash === "string" &&
		typeof value.whyImportant === "string" &&
		isSeedKeyFileCategory(value.category)
	);
}

function isSeedCategoryFinding(value: unknown): value is SeedCategoryFinding {
	if (!isRecord(value)) return false;
	return (
		typeof value.found === "boolean" &&
		typeof value.rationale === "string" &&
		isStringArray(value.files)
	);
}

function isSeedCategoryFindings(value: unknown): value is SeedCategoryFindings {
	if (!isRecord(value)) return false;
	return REQUIRED_SEED_CATEGORIES.every((category) =>
		isSeedCategoryFinding(value[category]),
	);
}

export function isSeedArtifact(value: unknown): value is SeedArtifact {
	if (!isRecord(value)) return false;
	return (
		typeof value.seedVersion === "number" &&
		typeof value.generatedAt === "string" &&
		(value.sourceCommit === undefined ||
			typeof value.sourceCommit === "string") &&
		typeof value.generatorVersion === "string" &&
		typeof value.seederPromptVersion === "string" &&
		typeof value.suggestionPromptVersion === "string" &&
		typeof value.configFingerprint === "string" &&
		(value.modelId === undefined || typeof value.modelId === "string") &&
		typeof value.projectIntentSummary === "string" &&
		typeof value.objectivesSummary === "string" &&
		typeof value.constraintsSummary === "string" &&
		typeof value.principlesGuidelinesSummary === "string" &&
		typeof value.implementationStatusSummary === "string" &&
		isStringArray(value.topObjectives) &&
		isStringArray(value.constraints) &&
		Array.isArray(value.keyFiles) &&
		value.keyFiles.every(isSeedKeyFile) &&
		(value.categoryFindings === undefined ||
			isSeedCategoryFindings(value.categoryFindings)) &&
		isStringArray(value.openQuestions) &&
		(value.reseedNotes === undefined ||
			typeof value.reseedNotes === "string") &&
		(value.lastReseedReason === undefined ||
			value.lastReseedReason === "initial_missing" ||
			value.lastReseedReason === "manual" ||
			value.lastReseedReason === "key_file_changed" ||
			value.lastReseedReason === "config_changed" ||
			value.lastReseedReason === "generator_changed") &&
		(value.lastChangedFiles === undefined ||
			isStringArray(value.lastChangedFiles))
	);
}

export interface StalenessCheckResult {
	stale: boolean;
	trigger?: ReseedTrigger;
}
