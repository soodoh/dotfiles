export const CURRENT_SEED_VERSION = 3;
export const CURRENT_GENERATOR_VERSION = "2026-03-11.2";
export const SEEDER_PROMPT_VERSION = "2026-03-11.2";
export const SUGGESTION_PROMPT_VERSION = "2026-03-11.1";

export type ReseedReason =
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

export interface SeedCategoryFinding {
	found: boolean;
	rationale: string;
	files: string[];
}

export type SeedCategoryFindings = Record<"vision" | "architecture" | "principles_guidelines", SeedCategoryFinding>;

export interface SeedKeyFile {
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

export interface StalenessCheckResult {
	stale: boolean;
	trigger?: ReseedTrigger;
}
