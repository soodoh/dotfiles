import { WorkflowRunner } from "./src/runner.ts";
import { getRun, listRuns, workflowRunStorePath } from "./src/store.ts";
import type { WorkflowRunRecord } from "./src/workflow-types.ts";

type NotifyLevel = "info" | "error" | string;
type WorkflowUi = {
	notify(text: string, level?: NotifyLevel): void;
	setStatus?: (name: string, status: string) => void;
	setWidget?: (name: string, widget: () => { render: () => string[] }) => void;
};
type WorkflowContext = {
	cwd: string;
	hasUI?: boolean;
	ui: WorkflowUi;
};
type WorkflowToolResult = {
	content: Array<{ type: "text"; text: string }>;
	details?: unknown;
};
type WorkflowTool = {
	name: string;
	label: string;
	description: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters: JsonSchema;
	execute: (
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: WorkflowContext,
	) => Promise<WorkflowToolResult>;
};
type WorkflowCommand = {
	description: string;
	handler: (args: string | undefined, ctx: WorkflowContext) => Promise<void>;
};
type PiApi = {
	on(
		event: "session_start",
		handler: (event: unknown, ctx: WorkflowContext) => void | Promise<void>,
	): void;
	registerCommand(name: string, command: WorkflowCommand): void;
	registerTool(tool: WorkflowTool): void;
};
type JsonSchema = {
	type: string;
	description?: string;
	properties?: Record<string, JsonSchema>;
	required?: string[];
	additionalProperties?: boolean;
	enum?: string[];
};
type PlanToolInput = {
	runId: string;
	filePath: string;
	approvalNotes?: string;
};
type CompleteRunInput = {
	runId: string;
	status: "completed" | "failed";
	summary?: string;
};

const approvePlanParameters: JsonSchema = {
	type: "object",
	properties: {
		runId: {
			type: "string",
			description: "Pi workflow run id, e.g. pwf-1234abcd",
		},
		filePath: {
			type: "string",
			description: "Markdown plan path relative to workflow cwd",
		},
		approvalNotes: {
			type: "string",
			description: "Optional user approval notes or constraints",
		},
	},
	required: ["runId", "filePath"],
	additionalProperties: false,
};

const submitPlanParameters: JsonSchema = {
	type: "object",
	properties: {
		runId: {
			type: "string",
			description: "Pi workflow run id, e.g. pwf-1234abcd",
		},
		filePath: {
			type: "string",
			description: "Markdown plan path relative to workflow cwd",
		},
	},
	required: ["runId", "filePath"],
	additionalProperties: false,
};

const completeRunParameters: JsonSchema = {
	type: "object",
	properties: {
		runId: {
			type: "string",
			description: "Pi workflow run id, e.g. pwf-1234abcd",
		},
		status: {
			type: "string",
			description: "Final workflow status",
			enum: ["completed", "failed"],
		},
		summary: {
			type: "string",
			description: "Brief execution and validation summary",
		},
	},
	required: ["runId", "status"],
	additionalProperties: false,
};

export default function piWorkflows(pi: PiApi) {
	const runner = new WorkflowRunner(pi, import.meta.url);
	let lastStatus = "idle";

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus?.("workflow", lastStatus);
			ctx.ui.setWidget?.("workflow", () => ({
				render: () =>
					lastStatus === "idle" ? [] : [`pi-workflows: ${lastStatus}`],
			}));
		}
	});

	pi.registerCommand("workflows", {
		description:
			"List Pi workflows discovered from built-in, global, and project YAML files",
		handler: async (_args, ctx) => {
			const text = await runner.list(ctx.cwd);
			ctx.ui.notify(text, "info");
			return;
		},
	});

	pi.registerCommand("workflow", {
		description: "Run a Pi workflow: /workflow <name> [arguments]",
		handler: async (args, ctx) => {
			const [name, ...rest] = (args || "").trim().split(/\s+/).filter(Boolean);
			if (!name) {
				ctx.ui.notify(await runner.list(ctx.cwd), "info");
				return;
			}
			lastStatus = `starting ${name}`;
			ctx.ui.setStatus?.("workflow", lastStatus);
			await runner.startWorkflow(name, rest.join(" "), ctx);
		},
	});

	pi.registerCommand("workflow-status", {
		description: "Show Pi workflow run status",
		handler: async (args, ctx) => {
			const id = args?.trim();
			if (id) {
				const run = await getRun(id);
				ctx.ui.notify(
					run ? formatRun(run) : `No workflow run found for ${id}`,
					run ? "info" : "error",
				);
				return;
			}
			const runs = (await listRuns()).slice(0, 10);
			ctx.ui.notify(
				runs.length
					? runs.map(formatRun).join("\n\n")
					: `No workflow runs. Store: ${workflowRunStorePath}`,
				"info",
			);
		},
	});

	pi.registerCommand("workflow-continue", {
		description: "Continue a Pi workflow run after plan approval",
		handler: async (args, ctx) => {
			const runId = args?.trim();
			if (!runId) {
				ctx.ui.notify("Usage: /workflow-continue <runId>", "error");
				return;
			}
			lastStatus = `${runId} handoff`;
			ctx.ui.setStatus?.("workflow", lastStatus);
			await runner.continueExecution(runId, ctx);
		},
	});

	pi.registerCommand("workflow-resume", {
		description: "Resume a Pi workflow run from its persisted plan artifact",
		handler: async (args, ctx) => {
			const runId = args?.trim();
			if (!runId) {
				ctx.ui.notify("Usage: /workflow-resume <runId>", "error");
				return;
			}
			await runner.continueExecution(runId, ctx);
		},
	});

	pi.registerTool({
		name: "workflow_approve_plan",
		label: "Workflow Approve Plan",
		description:
			"Approve a workflow plan artifact without Plannotator browser review. Used by prompt-only planning workflows.",
		promptSnippet:
			"Approve a pi-workflows plan artifact without Plannotator review",
		promptGuidelines: [
			"Use workflow_approve_plan only when the user has approved the plan in prompt conversation or the workflow explicitly skips Plannotator.",
		],
		parameters: approvePlanParameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const input = parsePlanToolInput(params);
			const result = await runner.approvePlan(
				input.runId,
				input.filePath,
				input.approvalNotes,
				ctx,
			);
			lastStatus = `${input.runId} approved`;
			ctx.ui.setStatus?.("workflow", lastStatus);
			return {
				content: [{ type: "text", text: result.text }],
				details: result,
			};
		},
	});

	pi.registerTool({
		name: "workflow_submit_plan",
		label: "Workflow Submit Plan",
		description:
			"Submit a workflow plan artifact through Plannotator's event API. Used by pi-workflows planning sessions instead of plannotator_submit_plan.",
		promptSnippet:
			"Submit a pi-workflows plan artifact for Plannotator review via event API",
		promptGuidelines: [
			"Use workflow_submit_plan in pi-workflows planning sessions when the plan markdown file is ready for review.",
		],
		parameters: submitPlanParameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const input = parsePlanToolInput(params);
			const result = await runner.submitPlan(input.runId, input.filePath, ctx);
			lastStatus = `${input.runId} ${result.approved ? "approved" : "planning"}`;
			ctx.ui.setStatus?.("workflow", lastStatus);
			return {
				content: [{ type: "text", text: result.text }],
				details: result,
			};
		},
	});

	pi.registerTool({
		name: "workflow_complete_run",
		label: "Workflow Complete Run",
		description:
			"Mark a pi-workflows execution run completed or failed after final validation.",
		promptSnippet:
			"Mark a pi-workflows execution run completed or failed after final validation",
		promptGuidelines: [
			"Use workflow_complete_run at the end of a pi-workflows execution session after final validation has completed.",
		],
		parameters: completeRunParameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const input = parseCompleteRunInput(params);
			const result = await runner.completeRun(
				input.runId,
				input.status,
				input.summary,
			);
			lastStatus = `${input.runId} ${input.status}`;
			ctx.ui.setStatus?.("workflow", lastStatus);
			return {
				content: [{ type: "text", text: result.text }],
				details: result,
			};
		},
	});
}

function parsePlanToolInput(params: unknown): PlanToolInput {
	if (!isRecord(params)) throw new Error("Tool parameters must be an object");
	if (typeof params.runId !== "string" || !params.runId.trim())
		throw new Error("runId is required");
	if (typeof params.filePath !== "string" || !params.filePath.trim())
		throw new Error("filePath is required");
	if (
		params.approvalNotes !== undefined &&
		typeof params.approvalNotes !== "string"
	)
		throw new Error("approvalNotes must be a string when provided");
	return {
		runId: params.runId,
		filePath: params.filePath,
		approvalNotes: params.approvalNotes,
	};
}

function parseCompleteRunInput(params: unknown): CompleteRunInput {
	if (!isRecord(params)) throw new Error("Tool parameters must be an object");
	if (typeof params.runId !== "string" || !params.runId.trim())
		throw new Error("runId is required");
	if (params.status !== "completed" && params.status !== "failed")
		throw new Error("status must be completed or failed");
	if (params.summary !== undefined && typeof params.summary !== "string")
		throw new Error("summary must be a string when provided");
	return {
		runId: params.runId,
		status: params.status,
		summary: params.summary,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatRun(run: WorkflowRunRecord): string {
	return `${run.id} · ${run.workflowName} · ${run.phase}\nplan: ${run.planPath ?? "(none)"}\nupdated: ${run.updatedAt}\n${(run.logs ?? []).slice(-3).join("\n")}`;
}
