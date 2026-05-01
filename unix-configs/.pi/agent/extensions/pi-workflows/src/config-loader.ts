import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import type {
	LoadedConfig,
	WorkflowCommand,
	WorkflowDefinition,
	WorkflowNode,
} from "./workflow-types.ts";
import { loadYamlFile } from "./yaml-loader.ts";

async function listFiles(
	dir: string,
	extensions: Set<string>,
): Promise<string[]> {
	if (!existsSync(dir)) return [];
	const entries = await readdir(dir, { withFileTypes: true });
	const out: string[] = [];
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await listFiles(full, extensions)));
		else if (
			entry.isFile() &&
			extensions.has(extname(entry.name).toLowerCase())
		)
			out.push(full);
	}
	return out;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateWorkflow(
	value: unknown,
	sourcePath: string,
): WorkflowDefinition {
	if (!isObject(value)) throw new Error("workflow root must be an object");
	if (typeof value.name !== "string" || !value.name.trim())
		throw new Error("workflow.name is required");
	if (typeof value.description !== "string" || !value.description.trim())
		throw new Error("workflow.description is required");
	if (!Array.isArray(value.nodes) || value.nodes.length === 0)
		throw new Error("workflow.nodes must be a non-empty array");
	const ids = new Set<string>();
	const nodes = value.nodes.map((node, index) =>
		validateNode(node, index, ids),
	);
	for (const node of nodes) {
		for (const dep of node.depends_on ?? []) {
			if (!ids.has(dep))
				throw new Error(`node ${node.id} depends_on unknown node ${dep}`);
		}
	}
	return {
		...(value as Omit<WorkflowDefinition, "sourcePath">),
		nodes,
		sourcePath,
	};
}

function validateNode(
	value: unknown,
	index: number,
	ids: Set<string>,
): WorkflowNode {
	if (!isObject(value)) throw new Error(`node[${index}] must be an object`);
	if (typeof value.id !== "string" || !value.id.trim())
		throw new Error(`node[${index}].id is required`);
	if (ids.has(value.id)) throw new Error(`duplicate node id: ${value.id}`);
	ids.add(value.id);
	if (
		value.depends_on !== undefined &&
		(!Array.isArray(value.depends_on) ||
			!value.depends_on.every((d) => typeof d === "string"))
	) {
		throw new Error(`node ${value.id}.depends_on must be a string array`);
	}
	if (value.when !== undefined) {
		if (typeof value.when !== "string")
			throw new Error(`node ${value.id}.when must be a string`);
		if (!isSupportedWhenExpression(value.when))
			throw new Error(
				`node ${value.id}.when has unsupported expression: ${value.when}`,
			);
	}
	const typeFields = [
		"command",
		"prompt",
		"bash",
		"script",
		"approval",
		"plannotator_review",
		"handoff",
		"subagent",
		"workerReviewLoop",
		"worktreeWave",
	].filter((k) => value[k] !== undefined);
	if (typeFields.length !== 1)
		throw new Error(
			`node ${value.id} must define exactly one node type; got ${typeFields.join(", ") || "none"}`,
		);
	return value as unknown as WorkflowNode;
}

function isSupportedWhenExpression(when: string): boolean {
	return /^\$classify-plan\.output\.complexity\s*==\s*['"](simple|medium|complex)['"]$/.test(
		when,
	);
}

function parseCommandFrontmatter(raw: string): {
	data: Record<string, string>;
	body: string;
} {
	if (!raw.startsWith("---\n")) return { data: {}, body: raw };
	const end = raw.indexOf("\n---", 4);
	if (end === -1) return { data: {}, body: raw };
	const fm = raw.slice(4, end).trim();
	const body = raw.slice(end + 4).replace(/^\n/, "");
	const data: Record<string, string> = {};
	for (const line of fm.split("\n")) {
		const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (match) data[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
	}
	return { data, body };
}

async function loadCommands(dir: string): Promise<WorkflowCommand[]> {
	const files = await listFiles(dir, new Set([".md"]));
	const commands: WorkflowCommand[] = [];
	for (const file of files) {
		const raw = await readFile(file, "utf8");
		const parsed = parseCommandFrontmatter(raw);
		commands.push({
			name: basename(file, ".md"),
			description: parsed.data.description,
			argumentHint: parsed.data["argument-hint"],
			content: parsed.body,
			sourcePath: file,
		});
	}
	return commands;
}

export async function loadWorkflowConfig(
	cwd: string,
	extensionRoot: string,
): Promise<LoadedConfig> {
	const diagnostics: string[] = [];
	const workflowDirs = [
		join(extensionRoot, "workflows", "defaults"),
		join(homedir(), ".pi", "agent", "workflows"),
		resolve(cwd, ".pi", "workflows"),
	];
	const commandDirs = [
		join(extensionRoot, "commands", "defaults"),
		join(homedir(), ".pi", "agent", "workflow-commands"),
		resolve(cwd, ".pi", "workflow-commands"),
	];

	const workflowsByName = new Map<string, WorkflowDefinition>();
	for (const dir of workflowDirs) {
		const files = await listFiles(dir, new Set([".yaml", ".yml"]));
		for (const file of files) {
			try {
				const workflow = validateWorkflow(await loadYamlFile(file), file);
				workflowsByName.set(workflow.name, workflow);
			} catch (err) {
				diagnostics.push(
					`${file}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
	}

	const commandsByName = new Map<string, WorkflowCommand>();
	for (const dir of commandDirs) {
		for (const command of await loadCommands(dir))
			commandsByName.set(command.name, command);
	}

	return {
		workflows: [...workflowsByName.values()],
		commands: [...commandsByName.values()],
		diagnostics,
	};
}
