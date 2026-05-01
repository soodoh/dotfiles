export type ThinkingLevel =
	| "inherit"
	| "auto"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh";

export interface ModelPolicy {
	model?: string;
	models?: string[];
	autoSelectModel?: boolean;
	thinking?: ThinkingLevel;
}

export interface WorkflowDefinition {
	name: string;
	description: string;
	modelPolicy?: Record<string, ModelPolicy> & { default?: ModelPolicy };
	nodes: WorkflowNode[];
	sourcePath?: string;
}

export interface WorkflowNode {
	id: string;
	depends_on?: string[];
	when?: string;
	trigger_rule?: "all_success" | "one_success" | "none_failed_min_one_success";
	command?: string;
	prompt?: string;
	bash?: string;
	script?: string;
	context?: "fresh" | "newSession" | "inherit";
	model?: string;
	thinking?: ThinkingLevel;
	modelPolicy?: ModelPolicy;
	output_format?: unknown;
	output_artifact?: string;
	timeout?: number;
	loop?: WorkflowLoop;
	approval?: WorkflowApproval;
	plannotator_review?: PlannotatorReviewNode;
	handoff?: HandoffNode;
	subagent?: SubagentNode;
	workerReviewLoop?: WorkerReviewLoopNode;
	worktreeWave?: WorktreeWaveNode;
}

export interface WorkflowLoop {
	prompt?: string;
	command?: string;
	until: string;
	max_iterations: number;
	fresh_context?: boolean;
	until_bash?: string;
}

export interface WorkflowApproval {
	message: string;
	capture_response?: boolean;
	on_reject?: { prompt: string; max_attempts?: number };
}

export interface PlannotatorReviewNode {
	artifact?: string;
	filePath?: string;
	loopOnDenied?: boolean;
}

export interface HandoffNode {
	mode: "newSession";
	seed: "approvedPlanOnly" | "planOnly";
	artifacts?: string[];
	required?: boolean;
}

export interface SubagentNode {
	agent?: string;
	task?: string;
	tasks?: Array<{
		agent: string;
		task: string;
		model?: string;
		thinking?: ThinkingLevel;
		output?: string | boolean;
	}>;
	context?: "fresh" | "fork";
	concurrency?: number;
	worktree?: boolean;
}

export interface WorkerReviewLoopNode {
	worker?: string;
	reviewer?: string;
	maxRounds: number;
	scope?: "plan" | "task" | "diff";
}

export interface WorktreeWaveNode {
	worker?: string;
	reviewer?: string;
	maxRounds?: number;
	parallelWorkers?: boolean;
}

export interface WorkflowCommand {
	name: string;
	description?: string;
	argumentHint?: string;
	content: string;
	sourcePath: string;
}

export type RunPhase =
	| "created"
	| "planning"
	| "reviewing-plan"
	| "approved"
	| "executing"
	| "paused"
	| "completed"
	| "failed";

export interface WorkflowRunRecord {
	id: string;
	workflowName: string;
	phase: RunPhase;
	cwd: string;
	createdAt: string;
	updatedAt: string;
	request?: string;
	planPath?: string;
	planContentHash?: string;
	approvedPlanContent?: string;
	approvalNotes?: string;
	planningSessionPath?: string;
	executionSessionPath?: string;
	selectedCommandPath?: string;
	selectedComplexity?: "simple" | "medium" | "complex";
	logs: string[];
}

export interface LoadedConfig {
	workflows: WorkflowDefinition[];
	commands: WorkflowCommand[];
	diagnostics: string[];
}
