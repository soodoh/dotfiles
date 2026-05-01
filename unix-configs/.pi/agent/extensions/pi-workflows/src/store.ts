import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { homePath, nowIso, writeJson } from "./utils.ts";
import type { WorkflowRunRecord } from "./workflow-types.ts";

const LEGACY_STORE_PATH = homePath(".pi", "agent", "workflow-runs.json");
const RUNS_DIR = homePath(".pi", "agent", "workflow-runs");

type StoreFile = { runs: WorkflowRunRecord[] };

async function readLegacyStore(): Promise<StoreFile> {
	if (!existsSync(LEGACY_STORE_PATH)) return { runs: [] };
	try {
		const parsed = JSON.parse(await readFile(LEGACY_STORE_PATH, "utf8"));
		return { runs: Array.isArray(parsed?.runs) ? parsed.runs : [] };
	} catch {
		return { runs: [] };
	}
}

async function readRunFile(id: string): Promise<WorkflowRunRecord | undefined> {
	const path = join(RUNS_DIR, `${id}.json`);
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(await readFile(path, "utf8"));
		return parsed?.id === id ? (parsed as WorkflowRunRecord) : undefined;
	} catch {
		return undefined;
	}
}

async function readRunFiles(): Promise<WorkflowRunRecord[]> {
	if (!existsSync(RUNS_DIR)) return [];
	const files = await readdir(RUNS_DIR, { withFileTypes: true });
	const runs = await Promise.all(
		files
			.filter(
				(file) => file.isFile() && extname(file.name).toLowerCase() === ".json",
			)
			.map((file) => readRunFile(basename(file.name, ".json"))),
	);
	return runs.filter((run): run is WorkflowRunRecord => Boolean(run));
}

export async function listRuns(): Promise<WorkflowRunRecord[]> {
	const byId = new Map<string, WorkflowRunRecord>();
	for (const run of (await readLegacyStore()).runs) byId.set(run.id, run);
	for (const run of await readRunFiles()) byId.set(run.id, run);
	return [...byId.values()].sort((a, b) =>
		b.updatedAt.localeCompare(a.updatedAt),
	);
}

export async function getRun(
	id: string,
): Promise<WorkflowRunRecord | undefined> {
	return (
		(await readRunFile(id)) ??
		(await readLegacyStore()).runs.find((run) => run.id === id)
	);
}

export async function saveRun(run: WorkflowRunRecord): Promise<void> {
	run.updatedAt = nowIso();
	await writeJson(join(RUNS_DIR, `${run.id}.json`), run);
}

export async function appendRunLog(id: string, message: string): Promise<void> {
	const run = await getRun(id);
	if (!run) return;
	run.logs.push(`${nowIso()} ${message}`);
	await saveRun(run);
}

export const workflowRunStorePath = RUNS_DIR;
