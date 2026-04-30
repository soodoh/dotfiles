import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync } from "node:fs";
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
  leasePath: string;
  projectMapPath: string;
}

interface ReuseChecks {
  isPidAlive?: (pid: number) => boolean;
}

interface SerenaToolRuntime {
  ensureServer(ctx: ExtensionContext, signal?: AbortSignal): Promise<SerenaConnection>;
  getProjectRoot(ctx: ExtensionContext): Promise<string>;
  registerOwner(ctx: ExtensionContext, state: SerenaServerState): Promise<void>;
  releaseOwner(ctx: ExtensionContext, state: SerenaServerState): Promise<boolean>;
}

export interface SerenaOwnerLease {
  ownerPid: number;
  serverPid: number;
  endpoint: string;
  updatedAt: string;
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
const DEFAULT_SERENA_TOOL_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 50 * 1024;
const DEFAULT_MAX_LINES = 2000;

export function getDefaultRequestsCaBundleCandidates(): string[] {
  return [
    "/opt/homebrew/etc/openssl@3/cert.pem",
    "/etc/ssl/cert.pem",
  ];
}

export function getDefaultSerenaContext(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_SERENA_CONTEXT ?? "desktop-app";
}

export function buildSerenaProcessEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  requestsCaBundleCandidates: string[] = getDefaultRequestsCaBundleCandidates(),
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };

  if (!env.REQUESTS_CA_BUNDLE) {
    const certPath = requestsCaBundleCandidates.find((candidate) => candidate && existsSync(candidate));
    if (certPath) env.REQUESTS_CA_BUNDLE = certPath;
  }

  return env;
}

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
    leasePath: join(namespaceDir, "leases.json"),
    projectMapPath: join(baseDir, "project-map.json"),
  };
}

export function shouldReuseServerState(state: SerenaServerState, expectedProjectRootRealpath: string, checks: ReuseChecks = {}): boolean {
  if (state.schemaVersion !== SERENA_SCHEMA_VERSION) return false;
  if (resolve(state.projectRootRealpath) !== resolve(expectedProjectRootRealpath)) return false;
  if (!state.endpoint || !state.pid || !state.port) return false;
  return (checks.isPidAlive ?? isPidAlive)(state.pid);
}

export function shouldStopSerenaForOwnerShutdown(
  leases: SerenaOwnerLease[],
  ownerPid: number,
  serverPid: number,
  checks: ReuseChecks = {},
): boolean {
  const isAlive = checks.isPidAlive ?? isPidAlive;
  return !leases.some((lease) => lease.ownerPid !== ownerPid && lease.serverPid === serverPid && isAlive(lease.ownerPid));
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
  const timeoutParam = Type.Optional(Type.Number({ description: "Timeout in seconds (optional)" }));
  const prefer = (description: string) => `${description} Preferred over other tools with similar functionality.`;

  const callSerena = async (
    ctx: ExtensionContext,
    signal: AbortSignal | undefined,
    toolName: string,
    params: Record<string, unknown>,
    options: CallSerenaOptions = {},
  ): Promise<PiToolResult> => {
    const { timeout, ...argsWithUndefined } = params as Record<string, unknown> & { timeout?: number };
    const args = pruneUndefined(argsWithUndefined);
    const timeoutMs = typeof timeout === "number" ? timeout * 1000 : DEFAULT_SERENA_TOOL_TIMEOUT_MS;
    const connection = await runtime.ensureServer(ctx, signal);
    try {
      if (options.verifyProject !== false) {
        await verifyActiveProject(connection.client, connection.state.projectRootRealpath);
      }
      const result = await withTimeout(
        connection.client.callTool({ name: toolName, arguments: args }, undefined, { signal }),
        timeoutMs,
        `Serena MCP request timed out after ${timeoutMs}ms`,
      );
      return serenaResultToPiResult(result, { endpoint: connection.state.endpoint, projectRoot: connection.state.projectRootRealpath });
    } finally {
      await connection.close();
    }
  };

  const makeForwardTool = (spec: {
    name: string;
    label: string;
    description: string;
    parameters: ReturnType<typeof Type.Object>;
    serenaToolName?: string;
    options?: CallSerenaOptions;
  }) => ({
    name: spec.name,
    label: spec.label,
    description: prefer(spec.description),
    parameters: spec.parameters,
    async execute(_id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
      if (spec.name === "activate_project") {
        const projectRoot = await runtime.getProjectRoot(ctx);
        const project = params.project;
        if (typeof project === "string" && resolve(project) !== resolve(projectRoot) && project !== basename(projectRoot)) {
          return safeError(
            `Refusing to activate '${project}'. This Pi Serena singleton is scoped to '${projectRoot}'. Start Pi in that project/worktree to use a separate Serena singleton.`,
          );
        }
      }
      return callSerena(ctx, signal, spec.serenaToolName ?? spec.name, params, spec.options);
    },
  });

  const tools = [
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
      name: "serena_list_tools",
      label: "Serena List Tools",
      description: prefer("List available Serena MCP tools."),
      parameters: Type.Object({ timeout: timeoutParam }),
      async execute(_toolCallId: string, params: Record<string, unknown>, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
        const timeout = (params as { timeout?: number }).timeout;
        const timeoutMs = typeof timeout === "number" ? timeout * 1000 : DEFAULT_SERENA_TOOL_TIMEOUT_MS;
        const connection = await runtime.ensureServer(ctx, signal);
        try {
          const listed = await withTimeout(connection.client.listTools(undefined, { signal }), timeoutMs, `Serena MCP request timed out after ${timeoutMs}ms`);
          const lines = listed.tools.map((tool) => {
            const description = tool.description ? ` — ${tool.description}` : "";
            return `• ${tool.name}${description}`;
          });
          return wrapTextResult(lines.length ? lines.join("\n") : "No tools available.");
        } finally {
          await connection.close();
        }
      },
    },
    ...[
      {
        name: "find_symbol",
        label: "Serena Find Symbol",
        description: "Find symbols by name pattern using Serena MCP.",
        parameters: Type.Object({
          name_path_pattern: Type.String({ description: "Symbol name path pattern" }),
          depth: Type.Optional(Type.Number({ description: "Descendant depth to include" })),
          relative_path: Type.Optional(Type.String({ description: "Scope search to a file or directory" })),
          include_body: Type.Optional(Type.Boolean({ description: "Include symbol body" })),
          include_info: Type.Optional(Type.Boolean({ description: "Include additional symbol info (hover-like)" })),
          include_kinds: Type.Optional(Type.Array(Type.Number(), { description: "LSP kinds to include" })),
          exclude_kinds: Type.Optional(Type.Array(Type.Number(), { description: "LSP kinds to exclude" })),
          substring_matching: Type.Optional(Type.Boolean({ description: "Enable substring matching" })),
          max_answer_chars: Type.Optional(Type.Number({ description: "Serena max output chars" })),
          timeout: timeoutParam,
        }),
      },
      {
        name: "find_referencing_symbols",
        label: "Serena Find Referencing Symbols",
        description: "Find references to a symbol using Serena MCP.",
        parameters: Type.Object({
          name_path: Type.String({ description: "Name path of the target symbol" }),
          relative_path: Type.String({ description: "File containing the symbol" }),
          include_kinds: Type.Optional(Type.Array(Type.Number(), { description: "LSP kinds to include" })),
          exclude_kinds: Type.Optional(Type.Array(Type.Number(), { description: "LSP kinds to exclude" })),
          max_answer_chars: Type.Optional(Type.Number({ description: "Serena max output chars" })),
          timeout: timeoutParam,
        }),
      },
      {
        name: "insert_after_symbol",
        label: "Serena Insert After Symbol",
        description: "Insert content after a symbol definition via Serena MCP.",
        parameters: Type.Object({
          name_path: Type.String({ description: "Name path of the target symbol" }),
          relative_path: Type.String({ description: "File containing the symbol" }),
          body: Type.String({ description: "Content to insert" }),
          timeout: timeoutParam,
        }),
      },
      {
        name: "replace_symbol_body",
        label: "Serena Replace Symbol Body",
        description: "Replace an entire symbol body via Serena MCP.",
        parameters: Type.Object({
          name_path: Type.String({ description: "Name path of the target symbol" }),
          relative_path: Type.String({ description: "File containing the symbol" }),
          body: Type.String({ description: "New symbol body (includes signature line)" }),
          timeout: timeoutParam,
        }),
      },
      {
        name: "read_file",
        label: "Serena Read File",
        description: "Read file contents via Serena MCP.",
        parameters: Type.Object({
          relative_path: Type.String({ description: "Path relative to the Serena project root" }),
          start_line: Type.Optional(Type.Number({ description: "0-based start line" })),
          end_line: Type.Optional(Type.Number({ description: "0-based end line (inclusive)" })),
          max_answer_chars: Type.Optional(Type.Number({ description: "Serena max output chars" })),
          timeout: timeoutParam,
        }),
      },
      {
        name: "get_symbols_overview",
        label: "Serena Get Symbols Overview",
        description: "Retrieve top-level symbols in a file with optional depth traversal.",
        parameters: Type.Object({
          relative_path: Type.String({ description: "File to analyze" }),
          depth: Type.Optional(Type.Number({ description: "Descendant depth (0 = top-level only)" })),
          max_answer_chars: Type.Optional(Type.Number({ description: "Serena max output chars" })),
          timeout: timeoutParam,
        }),
      },
      {
        name: "insert_before_symbol",
        label: "Serena Insert Before Symbol",
        description: "Insert content before a symbol definition via Serena MCP.",
        parameters: Type.Object({
          name_path: Type.String({ description: "Name path of the target symbol" }),
          relative_path: Type.String({ description: "File containing the symbol" }),
          body: Type.String({ description: "Content to insert" }),
          timeout: timeoutParam,
        }),
      },
      {
        name: "rename_symbol",
        label: "Serena Rename Symbol",
        description: "Rename a symbol throughout the codebase using language server refactoring.",
        parameters: Type.Object({
          name_path: Type.String({ description: "Name path of the target symbol" }),
          relative_path: Type.String({ description: "File containing the symbol" }),
          new_name: Type.String({ description: "New symbol name" }),
          timeout: timeoutParam,
        }),
      },
      {
        name: "restart_language_server",
        label: "Serena Restart Language Server",
        description: "Restart the Serena language server manager.",
        parameters: Type.Object({ timeout: timeoutParam }),
      },
      {
        name: "jet_brains_get_symbols_overview",
        label: "Serena JetBrains Get Symbols Overview",
        description: "Retrieve top-level symbols in a file via the JetBrains backend.",
        parameters: Type.Object({
          relative_path: Type.String({ description: "File to analyze" }),
          depth: Type.Optional(Type.Number({ description: "Descendant depth (0 = top-level only)" })),
          max_answer_chars: Type.Optional(Type.Number({ description: "Serena max output chars" })),
          include_file_documentation: Type.Optional(Type.Boolean({ description: "Include file docstring in results" })),
          timeout: timeoutParam,
        }),
      },
      {
        name: "jet_brains_find_symbol",
        label: "Serena JetBrains Find Symbol",
        description: "Find symbols by name pattern using the JetBrains backend.",
        parameters: Type.Object({
          name_path_pattern: Type.String({ description: "Symbol name path pattern" }),
          depth: Type.Optional(Type.Number({ description: "Descendant depth to include" })),
          relative_path: Type.Optional(Type.String({ description: "Scope search to a file or directory" })),
          include_body: Type.Optional(Type.Boolean({ description: "Include symbol body" })),
          include_info: Type.Optional(Type.Boolean({ description: "Include additional symbol info (hover-like)" })),
          search_deps: Type.Optional(Type.Boolean({ description: "Search dependency symbols" })),
          max_answer_chars: Type.Optional(Type.Number({ description: "Serena max output chars" })),
          timeout: timeoutParam,
        }),
      },
      {
        name: "jet_brains_find_referencing_symbols",
        label: "Serena JetBrains Find Referencing Symbols",
        description: "Find references to a symbol using the JetBrains backend.",
        parameters: Type.Object({
          name_path: Type.String({ description: "Name path of the target symbol" }),
          relative_path: Type.String({ description: "File containing the symbol" }),
          max_answer_chars: Type.Optional(Type.Number({ description: "Serena max output chars" })),
          timeout: timeoutParam,
        }),
      },
      {
        name: "jet_brains_type_hierarchy",
        label: "Serena JetBrains Type Hierarchy",
        description: "Retrieve the type hierarchy of a symbol using the JetBrains backend.",
        parameters: Type.Object({
          name_path: Type.String({ description: "Name path of the target symbol" }),
          relative_path: Type.String({ description: "File containing the symbol" }),
          hierarchy_type: Type.Optional(Type.Union([Type.Literal("super"), Type.Literal("sub"), Type.Literal("both")])),
          depth: Type.Optional(Type.Union([Type.Number({ description: "Hierarchy depth limit" }), Type.Null()])),
          max_answer_chars: Type.Optional(Type.Number({ description: "Serena max output chars" })),
          timeout: timeoutParam,
        }),
      },
      {
        name: "search_for_pattern",
        label: "Serena Search For Pattern",
        description: "Search for a text pattern using Serena's search tool.",
        parameters: Type.Object({
          substring_pattern: Type.String({ description: "Search pattern (regex supported)" }),
          context_lines_before: Type.Optional(Type.Number({ description: "Lines of context before each match" })),
          context_lines_after: Type.Optional(Type.Number({ description: "Lines of context after each match" })),
          paths_include_glob: Type.Optional(Type.String({ description: "Glob of files to include" })),
          paths_exclude_glob: Type.Optional(Type.String({ description: "Glob of files to exclude" })),
          relative_path: Type.Optional(Type.String({ description: "Restrict search scope (file or directory)" })),
          restrict_search_to_code_files: Type.Optional(Type.Boolean({ description: "Restrict search to code files only" })),
          max_answer_chars: Type.Optional(Type.Number({ description: "Serena max output chars" })),
          timeout: timeoutParam,
        }),
      },
      {
        name: "list_dir",
        label: "Serena List Directory",
        description: "List files and directories in a path (optionally recursive).",
        parameters: Type.Object({
          relative_path: Type.String({ description: "Directory to list (use . for project root)" }),
          recursive: Type.Boolean({ description: "Whether to scan subdirectories" }),
          skip_ignored_files: Type.Optional(Type.Boolean({ description: "Skip ignored files" })),
          max_answer_chars: Type.Optional(Type.Number({ description: "Serena max output chars" })),
          timeout: timeoutParam,
        }),
      },
      {
        name: "find_file",
        label: "Serena Find File",
        description: "Find files matching a file mask within a path.",
        parameters: Type.Object({
          file_mask: Type.String({ description: "Filename or file mask (wildcards * or ?)" }),
          relative_path: Type.String({ description: "Directory to search (use . for project root)" }),
          timeout: timeoutParam,
        }),
      },
      {
        name: "create_text_file",
        label: "Serena Create Text File",
        description: "Create or overwrite a file in the project directory.",
        parameters: Type.Object({
          relative_path: Type.String({ description: "Path of the file to create" }),
          content: Type.String({ description: "File contents" }),
          timeout: timeoutParam,
        }),
      },
      {
        name: "replace_content",
        label: "Serena Replace Content",
        description: "Replace content in a file (literal or regex).",
        parameters: Type.Object({
          relative_path: Type.String({ description: "File to update" }),
          needle: Type.String({ description: "String or regex pattern to search for" }),
          repl: Type.String({ description: "Replacement string" }),
          mode: Type.Union([Type.Literal("literal"), Type.Literal("regex")], { description: "How to interpret the needle" }),
          allow_multiple_occurrences: Type.Optional(Type.Boolean({ description: "Allow replacing multiple occurrences" })),
          timeout: timeoutParam,
        }),
      },
      {
        name: "delete_lines",
        label: "Serena Delete Lines",
        description: "Delete a range of lines within a file.",
        parameters: Type.Object({
          relative_path: Type.String({ description: "File to update" }),
          start_line: Type.Number({ description: "0-based start line" }),
          end_line: Type.Number({ description: "0-based end line" }),
          timeout: timeoutParam,
        }),
      },
      {
        name: "replace_lines",
        label: "Serena Replace Lines",
        description: "Replace a range of lines within a file.",
        parameters: Type.Object({
          relative_path: Type.String({ description: "File to update" }),
          start_line: Type.Number({ description: "0-based start line" }),
          end_line: Type.Number({ description: "0-based end line" }),
          content: Type.String({ description: "Replacement content" }),
          timeout: timeoutParam,
        }),
      },
      {
        name: "insert_at_line",
        label: "Serena Insert At Line",
        description: "Insert content at a specific line in a file.",
        parameters: Type.Object({
          relative_path: Type.String({ description: "File to update" }),
          line: Type.Number({ description: "0-based line index" }),
          content: Type.String({ description: "Content to insert" }),
          timeout: timeoutParam,
        }),
      },
      {
        name: "execute_shell_command",
        label: "Serena Execute Shell Command",
        description: "Execute a shell command.",
        parameters: Type.Object({
          command: Type.String({ description: "Shell command to execute" }),
          cwd: Type.Optional(Type.String({ description: "Working directory (relative to project root)" })),
          capture_stderr: Type.Optional(Type.Boolean({ description: "Capture stderr output" })),
          max_answer_chars: Type.Optional(Type.Number({ description: "Serena max output chars" })),
          timeout: timeoutParam,
        }),
      },
      {
        name: "get_current_config",
        label: "Serena Get Current Config",
        description: "Print the current Serena configuration.",
        parameters: Type.Object({ timeout: timeoutParam }),
        options: { verifyProject: false },
      },
      {
        name: "activate_project",
        label: "Serena Activate Project",
        description: "Activate a Serena project by name or path.",
        parameters: Type.Object({
          project: Type.String({ description: "Project name or path" }),
          timeout: timeoutParam,
        }),
        options: { verifyProject: false },
      },
      {
        name: "remove_project",
        label: "Serena Remove Project",
        description: "Remove a project from Serena configuration.",
        parameters: Type.Object({
          project_name: Type.String({ description: "Name of project to remove" }),
          timeout: timeoutParam,
        }),
      },
      {
        name: "switch_modes",
        label: "Serena Switch Modes",
        description: "Activate Serena modes by name.",
        parameters: Type.Object({
          modes: Type.Array(Type.String({ description: "Mode name" })),
          timeout: timeoutParam,
        }),
      },
      {
        name: "open_dashboard",
        label: "Serena Open Dashboard",
        description: "Open the Serena web dashboard.",
        parameters: Type.Object({ timeout: timeoutParam }),
      },
      {
        name: "check_onboarding_performed",
        label: "Serena Check Onboarding",
        description: "Check whether onboarding has been performed.",
        parameters: Type.Object({ timeout: timeoutParam }),
      },
      {
        name: "onboarding",
        label: "Serena Onboarding",
        description: "Perform project onboarding to capture context.",
        parameters: Type.Object({ timeout: timeoutParam }),
      },
      {
        name: "initial_instructions",
        label: "Serena Initial Instructions",
        description: "Provide the Serena instructions manual.",
        parameters: Type.Object({ timeout: timeoutParam }),
      },
      {
        name: "prepare_for_new_conversation",
        label: "Serena Prepare For New Conversation",
        description: "Provide instructions for continuing in a new conversation.",
        parameters: Type.Object({ timeout: timeoutParam }),
      },
      {
        name: "summarize_changes",
        label: "Serena Summarize Changes",
        description: "Provide instructions for summarizing changes.",
        parameters: Type.Object({ timeout: timeoutParam }),
      },
      {
        name: "think_about_collected_information",
        label: "Serena Think About Collected Information",
        description: "Thinking tool for assessing collected information.",
        parameters: Type.Object({ timeout: timeoutParam }),
      },
      {
        name: "think_about_task_adherence",
        label: "Serena Think About Task Adherence",
        description: "Thinking tool for assessing task adherence.",
        parameters: Type.Object({ timeout: timeoutParam }),
      },
      {
        name: "think_about_whether_you_are_done",
        label: "Serena Think About Whether You Are Done",
        description: "Thinking tool for determining if the task is complete.",
        parameters: Type.Object({ timeout: timeoutParam }),
      },
      {
        name: "read_memory",
        label: "Serena Read Memory",
        description: "Read a memory from Serena's memory store.",
        parameters: Type.Object({
          memory_name: Type.String({ description: "Memory name" }),
          timeout: timeoutParam,
        }),
      },
      {
        name: "write_memory",
        label: "Serena Write Memory",
        description: "Write a memory to Serena's memory store.",
        parameters: Type.Object({
          memory_name: Type.String({ description: "Memory name" }),
          content: Type.String({ description: "Memory content" }),
          max_chars: Type.Optional(Type.Number({ description: "Max characters to write" })),
          timeout: timeoutParam,
        }),
      },
      {
        name: "list_memories",
        label: "Serena List Memories",
        description: "List memories in Serena's memory store.",
        parameters: Type.Object({
          topic: Type.Optional(Type.String({ description: "Topic filter" })),
          timeout: timeoutParam,
        }),
      },
      {
        name: "delete_memory",
        label: "Serena Delete Memory",
        description: "Delete a memory from Serena's memory store.",
        parameters: Type.Object({
          memory_name: Type.String({ description: "Memory name" }),
          timeout: timeoutParam,
        }),
      },
      {
        name: "rename_memory",
        label: "Serena Rename Memory",
        description: "Rename or move a memory.",
        parameters: Type.Object({
          old_name: Type.String({ description: "Existing memory name" }),
          new_name: Type.String({ description: "New memory name" }),
          timeout: timeoutParam,
        }),
      },
      {
        name: "edit_memory",
        label: "Serena Edit Memory",
        description: "Edit a memory using literal or regex replacement.",
        parameters: Type.Object({
          memory_name: Type.String({ description: "Memory name" }),
          needle: Type.String({ description: "String or regex pattern to search for" }),
          repl: Type.String({ description: "Replacement string" }),
          mode: Type.Union([Type.Literal("literal"), Type.Literal("regex")], { description: "How to interpret the needle" }),
          timeout: timeoutParam,
        }),
      },
    ].map(makeForwardTool),
    {
      name: "serena_mcp_reset",
      label: "Serena MCP Reset",
      description: prefer("Reset the Serena MCP client connection."),
      parameters: Type.Object({}),
      async execute(_toolCallId: string, _params: Record<string, never>, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
        const connection = await runtime.ensureServer(ctx, signal);
        await connection.close();
        return { content: [{ type: "text" as const, text: "Serena MCP client reset." }] };
      },
    },
  ];

  return tools;
}

export function createSerenaRuntime(): SerenaToolRuntime {
  return {
    async getProjectRoot(ctx) {
      return realpath(await detectProjectRoot(ctx.cwd));
    },

    async registerOwner(_ctx, state) {
      const paths = getSerenaStatePaths(state.projectRootRealpath);
      await registerSerenaOwner(paths, state);
    },

    async releaseOwner(_ctx, state) {
      const paths = getSerenaStatePaths(state.projectRootRealpath);
      return releaseSerenaOwnerAndMaybeStop(paths, state);
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

export async function registerSerenaOwner(paths: SerenaStatePaths, state: SerenaServerState, ownerPid = process.pid): Promise<void> {
  await mkdir(paths.namespaceDir, { recursive: true });
  await withStartupLock(paths.lockPath, async () => {
    const leases = await readOwnerLeases(paths.leasePath);
    const next = leases.filter((lease) => lease.ownerPid !== ownerPid);
    next.push({ ownerPid, serverPid: state.pid, endpoint: state.endpoint, updatedAt: new Date().toISOString() });
    await writeOwnerLeases(paths.leasePath, next);
  });
}

export async function releaseSerenaOwnerAndMaybeStop(
  paths: SerenaStatePaths,
  state: SerenaServerState,
  ownerPid = process.pid,
  checks: ReuseChecks = {},
  stopServer: (state: SerenaServerState, paths: SerenaStatePaths) => Promise<void> = stopSerenaServer,
): Promise<boolean> {
  await mkdir(paths.namespaceDir, { recursive: true });
  return withStartupLock(paths.lockPath, async () => {
    const leases = await readOwnerLeases(paths.leasePath);
    const remaining = leases.filter((lease) => lease.ownerPid !== ownerPid);
    const liveRemaining = remaining.filter((lease) => (checks.isPidAlive ?? isPidAlive)(lease.ownerPid));
    await writeOwnerLeases(paths.leasePath, liveRemaining);

    if (!shouldStopSerenaForOwnerShutdown(liveRemaining, ownerPid, state.pid, checks)) return false;

    const currentState = await readServerState(paths.serverStatePath);
    if (currentState && !isSameSerenaServerState(currentState, state)) return false;

    await stopServer(state, paths);
    return true;
  });
}

async function readOwnerLeases(path: string): Promise<SerenaOwnerLease[]> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSerenaOwnerLease);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [];
  }
}

async function writeOwnerLeases(path: string, leases: SerenaOwnerLease[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(leases, null, 2)}\n`, "utf8");
}

function isSerenaOwnerLease(value: unknown): value is SerenaOwnerLease {
  if (!value || typeof value !== "object") return false;
  const lease = value as Partial<SerenaOwnerLease>;
  return typeof lease.ownerPid === "number" && typeof lease.serverPid === "number" && typeof lease.endpoint === "string" && typeof lease.updatedAt === "string";
}

function isSameSerenaServerState(a: SerenaServerState, b: SerenaServerState): boolean {
  return a.pid === b.pid && a.endpoint === b.endpoint && a.namespace === b.namespace;
}

async function stopSerenaServer(state: SerenaServerState, paths: SerenaStatePaths): Promise<void> {
  if (isPidAlive(state.pid)) {
    try {
      process.kill(-state.pid, "SIGTERM");
    } catch {
      try {
        process.kill(state.pid, "SIGTERM");
      } catch {
        // Process may have exited between liveness check and signal.
      }
    }

    await delay(500);

    if (isPidAlive(state.pid)) {
      try {
        process.kill(-state.pid, "SIGKILL");
      } catch {
        try {
          process.kill(state.pid, "SIGKILL");
        } catch {
          // Process may have exited after SIGTERM.
        }
      }
    }
  }

  await rm(paths.serverStatePath, { force: true });
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

export async function isExpectedActiveProject(activeProject: string, expectedProjectRoot: string): Promise<boolean> {
  const expectedRealpath = await realpath(expectedProjectRoot).catch(() => resolve(expectedProjectRoot));
  if (activeProject === basename(expectedRealpath)) return true;

  const activeRealpath = await realpath(activeProject).catch(() => resolve(activeProject));
  return activeRealpath === expectedRealpath;
}

async function verifyActiveProject(client: SerenaClient, expectedProjectRoot: string): Promise<void> {
  const activeProject = await getActiveProjectIfAvailable(client);
  if (!activeProject) return;

  if (!(await isExpectedActiveProject(activeProject, expectedProjectRoot))) {
    const expectedRealpath = await realpath(expectedProjectRoot).catch(() => resolve(expectedProjectRoot));
    throw new Error(
      `Serena active project mismatch. Expected '${expectedRealpath}', but Serena reports '${activeProject}'. Refusing to use this endpoint.`,
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
  const port = await getSerenaPort();
  await mkdir(paths.logDir, { recursive: true });
  const logPath = join(paths.logDir, `serena-${Date.now()}.log`);
  const logFd = openSync(logPath, "a");
  const { command, args } = getSerenaLaunchCommand(projectRoot, port);
  const child = spawn(command, args, {
    cwd: projectRoot,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: buildSerenaProcessEnv(process.env),
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
    getDefaultSerenaContext(process.env),
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

async function getSerenaPort(): Promise<number> {
  const override = process.env.SERENA_MCP_PORT;
  if (override) {
    const port = Number(override);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid SERENA_MCP_PORT: ${override}`);
    }
    return port;
  }

  return allocatePort();
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
  const text = extractText(result) || JSON.stringify(result, null, 2);
  return {
    ...wrapTextResult(text),
    details: { ...details, raw: result },
    isError: Boolean((result as { isError?: unknown })?.isError),
  };
}

function wrapTextResult(text: string): PiToolResult {
  const truncation = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  let output = truncation.content;
  if (truncation.truncated) {
    output += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines `;
    output += `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`;
  }

  return { content: [{ type: "text", text: output }] };
}

function truncateHead(text: string, limits: { maxLines: number; maxBytes: number }) {
  const lines = text.split("\n");
  const totalLines = lines.length;
  const totalBytes = Buffer.byteLength(text, "utf8");
  let kept = lines.slice(0, limits.maxLines).join("\n");

  while (Buffer.byteLength(kept, "utf8") > limits.maxBytes) {
    kept = kept.slice(0, Math.max(0, kept.length - 1024));
  }

  const outputLines = kept.length === 0 ? 0 : kept.split("\n").length;
  const outputBytes = Buffer.byteLength(kept, "utf8");
  return {
    content: kept,
    truncated: outputLines < totalLines || outputBytes < totalBytes,
    outputLines,
    totalLines,
    outputBytes,
    totalBytes,
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
