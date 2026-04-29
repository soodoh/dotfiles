import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type ToolResultContent = { type: "text"; text: string };
type PiToolResult = { content: ToolResultContent[]; details?: Record<string, unknown>; isError?: boolean };
type SerenaClient = Client;

export interface SerenaServerState {
  schemaVersion: 1;
  projectRoot: string;
  projectRootRealpath: string;
  namespace: string;
  pid: number;
  port: number;
  endpoint: string;
  startedAt: string;
}

export interface SerenaStatePathOptions {
  xdgStateHome?: string;
  home?: string;
}

export interface SerenaStatePaths {
  baseDir: string;
  namespace: string;
  namespaceDir: string;
  serverStatePath: string;
  lockPath: string;
  logDir: string;
  projectMapPath: string;
}

interface ReuseChecks {
  isPidAlive?: (pid: number) => boolean;
}

interface SerenaToolRuntime {
  ensureServer(ctx: ExtensionContext, signal?: AbortSignal): Promise<SerenaConnection>;
  getProjectRoot(ctx: ExtensionContext): Promise<string>;
}

interface SerenaConnection {
  state: SerenaServerState;
  client: SerenaClient;
  close(): Promise<void>;
}

interface CallSerenaOptions {
  verifyProject?: boolean;
}

const SERENA_SCHEMA_VERSION = 1;
const DEFAULT_SERENA_FROM = "git+https://github.com/oraios/serena";
const LOCK_RETRY_MS = 100;
const LOCK_TIMEOUT_MS = 30_000;
const STARTUP_TIMEOUT_MS = 90_000;

export function getSerenaStateBaseDir(options: SerenaStatePathOptions = {}): string {
  const stateHome = options.xdgStateHome ?? process.env.XDG_STATE_HOME ?? join(options.home ?? homedir(), ".local", "state");
  return join(stateHome, "serena", "pi");
}

export function makeProjectNamespace(projectRootRealpath: string): string {
  const root = resolve(projectRootRealpath);
  const slug = basename(root).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return `${slug}-${hash}`;
}

export function getSerenaStatePaths(projectRootRealpath: string, options: SerenaStatePathOptions = {}): SerenaStatePaths {
  const baseDir = getSerenaStateBaseDir(options);
  const namespace = makeProjectNamespace(projectRootRealpath);
  const namespaceDir = join(baseDir, namespace);
  return {
    baseDir,
    namespace,
    namespaceDir,
    serverStatePath: join(namespaceDir, "server-state.json"),
    lockPath: join(namespaceDir, "startup.lock"),
    logDir: join(namespaceDir, "logs"),
    projectMapPath: join(baseDir, "project-map.json"),
  };
}

export function shouldReuseServerState(state: SerenaServerState, expectedProjectRootRealpath: string, checks: ReuseChecks = {}): boolean {
  if (state.schemaVersion !== SERENA_SCHEMA_VERSION) return false;
  if (resolve(state.projectRootRealpath) !== resolve(expectedProjectRootRealpath)) return false;
  if (!state.endpoint || !state.pid || !state.port) return false;
  return (checks.isPidAlive ?? isPidAlive)(state.pid);
}

export function parseActiveProjectFromConfig(configText: string): string | undefined {
  const patterns = [
    /^\s*active_project\s*:\s*(.+?)\s*$/im,
    /^\s*active project\s*:\s*(.+?)\s*$/im,
    /^\s*Active project\s*:\s*(.+?)\s*$/im,
  ];

  for (const pattern of patterns) {
    const match = configText.match(pattern);
    const value = match?.[1]?.trim();
    if (value && !/^none$/i.test(value) && !/^no active project$/i.test(value)) return value;
  }

  return undefined;
}

export function createSerenaToolDefinitions(runtime: SerenaToolRuntime) {
  const callSerena = async (
    ctx: ExtensionContext,
    signal: AbortSignal | undefined,
    toolName: string,
    args: Record<string, unknown>,
    options: CallSerenaOptions = {},
  ): Promise<PiToolResult> => {
    const connection = await runtime.ensureServer(ctx, signal);
    try {
      if (options.verifyProject !== false) {
        await verifyActiveProject(connection.client, connection.state.projectRootRealpath);
      }
      const result = await connection.client.callTool({ name: toolName, arguments: args }, undefined, { signal });
      return serenaResultToPiResult(result, { endpoint: connection.state.endpoint, projectRoot: connection.state.projectRootRealpath });
    } finally {
      await connection.close();
    }
  };

  return [
    {
      name: "serena_status",
      label: "Serena Status",
      description: "Show the project-scoped Serena singleton status for the current Pi worktree.",
      promptSnippet: "Check the current worktree's Serena singleton status.",
      parameters: Type.Object({}),
      async execute(_toolCallId: string, _params: Record<string, never>, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
        const connection = await runtime.ensureServer(ctx, signal);
        try {
          const activeProject = await getActiveProjectIfAvailable(connection.client, signal);
          return {
            content: [
              {
                type: "text" as const,
                text: [
                  `Serena endpoint: ${connection.state.endpoint}`,
                  `PID: ${connection.state.pid}`,
                  `Project root: ${connection.state.projectRootRealpath}`,
                  activeProject ? `Active project: ${activeProject}` : "Active project: project-scoped singleton (Serena get_current_config unavailable)",
                ].join("\n"),
              },
            ],
            details: { state: connection.state, activeProject },
          };
        } finally {
          await connection.close();
        }
      },
    },
    {
      name: "serena_activate_project",
      label: "Serena Activate Project",
      description: "Ensure the current worktree's Serena singleton is running; refuses to switch an existing singleton to another project.",
      promptSnippet: "Ensure Serena is active for the current worktree before symbol operations.",
      parameters: Type.Object({
        project: Type.Optional(Type.String({ description: "Optional project path/name. Must match the current Pi worktree root." })),
      }),
      async execute(_toolCallId: string, params: { project?: string }, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
        const projectRoot = await runtime.getProjectRoot(ctx);
        if (params.project && resolve(params.project) !== resolve(projectRoot) && params.project !== projectRoot) {
          return safeError(
            `Refusing to activate '${params.project}'. This Pi Serena singleton is scoped to '${projectRoot}'. Start Pi in that project/worktree to use a separate Serena singleton.`,
          );
        }
        const connection = await runtime.ensureServer(ctx, signal);
        try {
          await verifyActiveProject(connection.client, connection.state.projectRootRealpath);
          return {
            content: [{ type: "text", text: `Serena is active for ${connection.state.projectRootRealpath} at ${connection.state.endpoint}.` }],
            details: { state: connection.state },
          };
        } finally {
          await connection.close();
        }
      },
    },
    {
      name: "serena_search_codebase",
      label: "Serena Search Codebase",
      description: "Search the current project with Serena's pattern search. Prefer symbolic tools when looking for known symbols.",
      promptSnippet: "Search code via Serena search_for_pattern instead of ad-hoc grep when semantic tools are not enough.",
      parameters: Type.Object({
        pattern: Type.String({ description: "Regex/substr pattern for Serena search_for_pattern." }),
        relative_path: Type.Optional(Type.String({ description: "Optional file or directory path relative to the project root." })),
        restrict_search_to_code_files: Type.Optional(Type.Boolean()),
        paths_include_glob: Type.Optional(Type.String()),
        paths_exclude_glob: Type.Optional(Type.String()),
        context_lines_before: Type.Optional(Type.Number()),
        context_lines_after: Type.Optional(Type.Number()),
        max_answer_chars: Type.Optional(Type.Number()),
      }),
      async execute(_id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
        const { pattern, ...rest } = params;
        return callSerena(ctx, signal, "search_for_pattern", { substring_pattern: pattern, ...pruneUndefined(rest) });
      },
    },
    {
      name: "serena_find_symbol",
      label: "Serena Find Symbol",
      description: "Find symbols by Serena name path pattern in the current project.",
      promptSnippet: "Find known code symbols via Serena find_symbol before reading whole files or grepping.",
      parameters: Type.Object({
        name_path: Type.String({ description: "Symbol name path pattern, e.g. ClassName/methodName or methodName." }),
        relative_path: Type.Optional(Type.String()),
        substring_matching: Type.Optional(Type.Boolean()),
        include_body: Type.Optional(Type.Boolean()),
        depth: Type.Optional(Type.Number()),
        max_answer_chars: Type.Optional(Type.Number()),
      }),
      async execute(_id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
        return callSerena(ctx, signal, "find_symbol", pruneUndefined(params));
      },
    },
    {
      name: "serena_find_references",
      label: "Serena Find References",
      description: "Find references to a symbol using Serena's language-server backend.",
      promptSnippet: "Find references via Serena find_referencing_symbols before text search.",
      parameters: Type.Object({
        name_path: Type.String({ description: "Name path of the symbol to find references for." }),
        relative_path: Type.String({ description: "File path containing the symbol, relative to the project root." }),
        max_answer_chars: Type.Optional(Type.Number()),
      }),
      async execute(_id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
        return callSerena(ctx, signal, "find_referencing_symbols", pruneUndefined(params));
      },
    },
    {
      name: "serena_get_symbols_overview",
      label: "Serena Symbols Overview",
      description: "Get Serena's top-level symbol overview for a file.",
      promptSnippet: "Use Serena get_symbols_overview as the first step when understanding a source file.",
      parameters: Type.Object({
        relative_path: Type.String({ description: "File path relative to the project root." }),
        max_answer_chars: Type.Optional(Type.Number()),
      }),
      async execute(_id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
        return callSerena(ctx, signal, "get_symbols_overview", pruneUndefined(params));
      },
    },
    {
      name: "serena_replace_symbol_body",
      label: "Serena Replace Symbol Body",
      description: "Safely replace a previously inspected symbol body using Serena's structured edit operation.",
      promptSnippet: "Use Serena replace_symbol_body for whole-symbol edits after locating the symbol with Serena.",
      parameters: Type.Object({
        name_path: Type.String({ description: "Name path of the symbol whose body should be replaced." }),
        relative_path: Type.String({ description: "File path containing the symbol, relative to the project root." }),
        body: Type.String({ description: "Replacement body/definition content." }),
      }),
      async execute(_id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
        return callSerena(ctx, signal, "replace_symbol_body", pruneUndefined(params));
      },
    },
  ];
}

export function createSerenaRuntime(): SerenaToolRuntime {
  return {
    async getProjectRoot(ctx) {
      return realpath(await detectProjectRoot(ctx.cwd));
    },

    async ensureServer(ctx, signal) {
      const projectRoot = await realpath(await detectProjectRoot(ctx.cwd));
      const paths = getSerenaStatePaths(projectRoot);
      await mkdir(paths.namespaceDir, { recursive: true });

      const existing = await readServerState(paths.serverStatePath);
      if (existing && shouldReuseServerState(existing, projectRoot)) {
        try {
          return await connectToState(existing, signal);
        } catch {
          await rm(paths.serverStatePath, { force: true });
        }
      }

      return withStartupLock(paths.lockPath, async () => {
        const lockedExisting = await readServerState(paths.serverStatePath);
        if (lockedExisting && shouldReuseServerState(lockedExisting, projectRoot)) {
          try {
            return await connectToState(lockedExisting, signal);
          } catch {
            await rm(paths.serverStatePath, { force: true });
          }
        }

        const state = await startSerenaServer(projectRoot, paths, signal);
        await writeServerState(paths.serverStatePath, state);
        await updateProjectMap(paths.projectMapPath, projectRoot, state);
        return connectToState(state, signal);
      });
    },
  };
}

async function connectToState(state: SerenaServerState, signal?: AbortSignal): Promise<SerenaConnection> {
  const transport = new StreamableHTTPClientTransport(new URL(state.endpoint));
  const client = new Client({ name: "pi-serena-extension", version: "1.0.0" });
  await client.connect(transport, { signal });
  await client.ping({ signal });
  return {
    state,
    client,
    async close() {
      await client.close();
    },
  };
}

async function verifyActiveProject(client: SerenaClient, expectedProjectRoot: string): Promise<void> {
  const activeProject = await getActiveProjectIfAvailable(client);
  if (!activeProject) return;

  const activeRealpath = await realpath(activeProject).catch(() => resolve(activeProject));
  const expectedRealpath = await realpath(expectedProjectRoot).catch(() => resolve(expectedProjectRoot));
  if (activeRealpath !== expectedRealpath) {
    throw new Error(
      `Serena active project mismatch. Expected '${expectedRealpath}', but Serena reports '${activeRealpath}'. Refusing to use this endpoint.`,
    );
  }
}

async function getActiveProjectIfAvailable(client: SerenaClient, signal?: AbortSignal): Promise<string | undefined> {
  const tools = await client.listTools(undefined, { signal }).catch(() => undefined);
  const hasConfigTool = tools?.tools?.some((tool) => tool.name === "get_current_config");
  if (!hasConfigTool) return undefined;

  const config = await client.callTool({ name: "get_current_config", arguments: {} }, undefined, { signal });
  if ((config as { isError?: unknown }).isError) return undefined;
  return parseActiveProjectFromConfig(extractText(config));
}

async function startSerenaServer(projectRoot: string, paths: SerenaStatePaths, signal?: AbortSignal): Promise<SerenaServerState> {
  const port = await allocatePort();
  await mkdir(paths.logDir, { recursive: true });
  const logPath = join(paths.logDir, `serena-${Date.now()}.log`);
  const logFd = openSync(logPath, "a");
  const { command, args } = getSerenaLaunchCommand(projectRoot, port);
  const child = spawn(command, args, {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: process.env,
  });
  closeSync(logFd);
  child.unref();

  if (!child.pid) throw new Error("Failed to start Serena: child process did not report a PID.");

  const state: SerenaServerState = {
    schemaVersion: SERENA_SCHEMA_VERSION,
    projectRoot,
    projectRootRealpath: projectRoot,
    namespace: paths.namespace,
    pid: child.pid,
    port,
    endpoint: `http://127.0.0.1:${port}/mcp`,
    startedAt: new Date().toISOString(),
  };

  await waitForServer(state, signal);
  return state;
}

function getSerenaLaunchCommand(projectRoot: string, port: number): { command: string; args: string[] } {
  const customCommand = process.env.PI_SERENA_COMMAND;
  if (customCommand) {
    return { command: customCommand, args: makeSerenaServerArgs(projectRoot, port) };
  }

  return {
    command: process.env.PI_SERENA_UVX ?? "uvx",
    args: ["--from", process.env.PI_SERENA_UVX_FROM ?? DEFAULT_SERENA_FROM, "serena", ...makeSerenaServerArgs(projectRoot, port)],
  };
}

function makeSerenaServerArgs(projectRoot: string, port: number): string[] {
  return [
    "start-mcp-server",
    "--transport",
    "streamable-http",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--project",
    projectRoot,
    "--context",
    process.env.PI_SERENA_CONTEXT ?? "ide",
    "--open-web-dashboard",
    "false",
  ];
}

async function waitForServer(state: SerenaServerState, signal?: AbortSignal): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < STARTUP_TIMEOUT_MS) {
    if (signal?.aborted) throw new Error("Serena startup aborted.");
    try {
      const connection = await connectToState(state, signal);
      await verifyActiveProject(connection.client, state.projectRootRealpath);
      await connection.close();
      return;
    } catch (error) {
      lastError = error;
      await delay(500, undefined, { signal }).catch(() => undefined);
    }
  }
  throw new Error(`Timed out waiting for Serena at ${state.endpoint}: ${String(lastError)}`);
}

async function withStartupLock<T>(lockPath: string, work: () => Promise<T>): Promise<T> {
  const start = Date.now();
  while (true) {
    try {
      await mkdir(lockPath, { recursive: false });
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      if (Date.now() - start > LOCK_TIMEOUT_MS) {
        await rm(lockPath, { recursive: true, force: true });
        continue;
      }
      await delay(LOCK_RETRY_MS);
    }
  }

  try {
    return await work();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

async function detectProjectRoot(cwd: string): Promise<string> {
  const gitRoot = await execFileText("git", ["rev-parse", "--show-toplevel"], cwd).catch(() => undefined);
  return gitRoot?.trim() || cwd;
}

async function execFileText(command: string, args: string[], cwd: string): Promise<string> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(command, args, { cwd }, (error, stdout, stderr) => {
      if (error) rejectPromise(new Error(stderr || error.message));
      else resolvePromise(stdout);
    });
  });
}

async function realpath(path: string): Promise<string> {
  const { realpath: fsRealpath } = await import("node:fs/promises");
  return fsRealpath(path).catch(() => resolve(path));
}

async function allocatePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolvePromise(address.port);
        else rejectPromise(new Error("Could not allocate a local port for Serena."));
      });
    });
    server.on("error", rejectPromise);
  });
}

async function readServerState(path: string): Promise<SerenaServerState | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as SerenaServerState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return undefined;
  }
}

async function writeServerState(path: string, state: SerenaServerState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function updateProjectMap(projectMapPath: string, projectRoot: string, state: SerenaServerState): Promise<void> {
  let map: Record<string, unknown> = {};
  try {
    map = JSON.parse(await readFile(projectMapPath, "utf8")) as Record<string, unknown>;
  } catch {
    map = {};
  }
  map[projectRoot] = { namespace: state.namespace, endpoint: state.endpoint, pid: state.pid, updatedAt: new Date().toISOString() };
  await mkdir(dirname(projectMapPath), { recursive: true });
  await writeFile(projectMapPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function serenaResultToPiResult(result: unknown, details: Record<string, unknown>): PiToolResult {
  const text = extractText(result);
  return {
    content: [{ type: "text", text: text || JSON.stringify(result, null, 2) }],
    details: { ...details, raw: result },
    isError: Boolean((result as { isError?: unknown })?.isError),
  };
}

function extractText(result: unknown): string {
  const content = (result as { content?: unknown })?.content;
  if (!Array.isArray(content)) return typeof result === "string" ? result : "";
  return content
    .map((part) => {
      if (part && typeof part === "object" && (part as { type?: unknown }).type === "text") {
        return String((part as { text?: unknown }).text ?? "");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)) as T;
}

function safeError(message: string): PiToolResult {
  return { content: [{ type: "text", text: message }], isError: true, details: { message } };
}

export function registerSerenaTools(pi: ExtensionAPI, runtime = createSerenaRuntime()): void {
  for (const tool of createSerenaToolDefinitions(runtime)) {
    pi.registerTool(tool as never);
  }
}
