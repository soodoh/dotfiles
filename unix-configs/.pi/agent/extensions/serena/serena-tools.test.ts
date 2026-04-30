import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import {
  buildSerenaProcessEnv,
  createSerenaToolDefinitions,
  getDefaultSerenaContext,
  getSerenaStateBaseDir,
  getSerenaStatePaths,
  isExpectedActiveProject,
  makeProjectNamespace,
  parseActiveProjectFromConfig,
  registerSerenaOwner,
  releaseSerenaOwnerAndMaybeStop,
  shouldReuseServerState,
  shouldStopSerenaForOwnerShutdown,
  type SerenaServerState,
} from "./serena-tools";

describe("Serena Pi extension state", () => {
  test("stores Pi-managed Serena state under XDG state home", () => {
    expect(getSerenaStateBaseDir({ xdgStateHome: "/tmp/state" })).toBe("/tmp/state/serena/pi");
    expect(getSerenaStateBaseDir({ home: "/Users/example" })).toBe("/Users/example/.local/state/serena/pi");
  });

  test("namespaces state by canonical worktree root, not project display name", () => {
    const main = makeProjectNamespace("/Users/me/Projects/app/main");
    const worktree = makeProjectNamespace("/Users/me/Projects/app/feature-x");

    expect(main).toStartWith("main-");
    expect(worktree).toStartWith("feature-x-");
    expect(main).not.toBe(worktree);
  });

  test("derives state, lock, log, and project map paths from namespace", () => {
    const paths = getSerenaStatePaths("/Users/me/Projects/dotfiles", { xdgStateHome: "/tmp/state" });

    expect(paths.baseDir).toBe("/tmp/state/serena/pi");
    expect(paths.namespace).toStartWith("dotfiles-");
    expect(paths.namespaceDir).toBe(`/tmp/state/serena/pi/${paths.namespace}`);
    expect(paths.serverStatePath).toBe(`${paths.namespaceDir}/server-state.json`);
    expect(paths.lockPath).toBe(`${paths.namespaceDir}/startup.lock`);
    expect(paths.logDir).toBe(`${paths.namespaceDir}/logs`);
    expect(paths.leasePath).toBe(`${paths.namespaceDir}/leases.json`);
    expect(paths.projectMapPath).toBe("/tmp/state/serena/pi/project-map.json");
  });

  test("only reuses live state for the same canonical project root", () => {
    const state: SerenaServerState = {
      schemaVersion: 1,
      projectRoot: "/repo/main",
      projectRootRealpath: "/repo/main",
      namespace: makeProjectNamespace("/repo/main"),
      pid: 123,
      port: 49152,
      endpoint: "http://127.0.0.1:49152/mcp",
      startedAt: "2026-04-29T00:00:00.000Z",
    };

    expect(shouldReuseServerState(state, "/repo/main", { isPidAlive: () => true })).toBe(true);
    expect(shouldReuseServerState(state, "/repo/feature", { isPidAlive: () => true })).toBe(false);
    expect(shouldReuseServerState(state, "/repo/main", { isPidAlive: () => false })).toBe(false);
  });

  test("parses active project paths from Serena get_current_config text", () => {
    expect(parseActiveProjectFromConfig("Active project: /Users/me/Projects/dotfiles\nAvailable projects: ...")).toBe(
      "/Users/me/Projects/dotfiles",
    );
    expect(parseActiveProjectFromConfig("active_project: /repo/main\ncontexts: ide")).toBe("/repo/main");
    expect(parseActiveProjectFromConfig("No active project")).toBeUndefined();
  });

  test("configures a requests-compatible CA bundle for Serena child processes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "serena-ca-test-"));
    const certPath = join(dir, "cert.pem");
    await writeFile(certPath, "test cert", "utf8");

    try {
      const env = buildSerenaProcessEnv({ PATH: "/usr/bin" }, [join(dir, "missing.pem"), certPath]);

      expect(env.REQUESTS_CA_BUNDLE).toBe(certPath);
      expect(env.PATH).toBe("/usr/bin");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("preserves an explicit requests CA bundle for Serena child processes", () => {
    const env = buildSerenaProcessEnv({ PATH: "/usr/bin", REQUESTS_CA_BUNDLE: "/custom/cert.pem" }, ["/detected/cert.pem"]);

    expect(env.REQUESTS_CA_BUNDLE).toBe("/custom/cert.pem");
  });

  test("defaults Serena startup to the full-toolset desktop app context", () => {
    expect(getDefaultSerenaContext({})).toBe("desktop-app");
    expect(getDefaultSerenaContext({ PI_SERENA_CONTEXT: "ide" })).toBe("ide");
  });

  test("accepts active project reported by registered project name", async () => {
    expect(await isExpectedActiveProject("dotfiles", "/Users/me/Projects/dotfiles")).toBe(true);
    expect(await isExpectedActiveProject("/Users/me/Projects/dotfiles", "/Users/me/Projects/dotfiles")).toBe(true);
    expect(await isExpectedActiveProject("other", "/Users/me/Projects/dotfiles")).toBe(false);
  });
  test("keeps Serena running while another live Pi owner uses the same server", () => {
    const leases = [
      { ownerPid: 100, serverPid: 300, endpoint: "http://127.0.0.1:300/mcp", updatedAt: "2026-04-29T00:00:00.000Z" },
      { ownerPid: 200, serverPid: 300, endpoint: "http://127.0.0.1:300/mcp", updatedAt: "2026-04-29T00:00:01.000Z" },
    ];

    expect(
      shouldStopSerenaForOwnerShutdown(leases, 100, 300, { isPidAlive: (pid) => pid === 200 }),
    ).toBe(false);
  });

  test("stops Serena when no other live Pi owner uses the same server", () => {
    const leases = [
      { ownerPid: 100, serverPid: 300, endpoint: "http://127.0.0.1:300/mcp", updatedAt: "2026-04-29T00:00:00.000Z" },
      { ownerPid: 200, serverPid: 300, endpoint: "http://127.0.0.1:300/mcp", updatedAt: "2026-04-29T00:00:01.000Z" },
      { ownerPid: 201, serverPid: 301, endpoint: "http://127.0.0.1:301/mcp", updatedAt: "2026-04-29T00:00:02.000Z" },
    ];

    expect(
      shouldStopSerenaForOwnerShutdown(leases, 100, 300, { isPidAlive: (pid) => pid === 201 }),
    ).toBe(true);
  });

  test("records owner leases and keeps Serena running for another live owner", async () => {
    const dir = await mkdtemp(join(tmpdir(), "serena-lease-test-"));
    const paths = getSerenaStatePaths("/repo/main", { xdgStateHome: dir });
    const state: SerenaServerState = {
      schemaVersion: 1,
      projectRoot: "/repo/main",
      projectRootRealpath: "/repo/main",
      namespace: paths.namespace,
      pid: 300,
      port: 49300,
      endpoint: "http://127.0.0.1:49300/mcp",
      startedAt: "2026-04-29T00:00:00.000Z",
    };
    const stopped: number[] = [];

    try {
      await registerSerenaOwner(paths, state, 100);
      await registerSerenaOwner(paths, state, 200);

      const didStop = await releaseSerenaOwnerAndMaybeStop(paths, state, 100, { isPidAlive: (pid) => pid === 200 }, async (server) => {
        stopped.push(server.pid);
      });

      expect(didStop).toBe(false);
      expect(stopped).toEqual([]);
      expect(JSON.parse(await readFile(paths.leasePath, "utf8"))).toMatchObject([{ ownerPid: 200, serverPid: 300 }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("does not remove a newer live server state when releasing a stale owner", async () => {
    const dir = await mkdtemp(join(tmpdir(), "serena-lease-test-"));
    const paths = getSerenaStatePaths("/repo/main", { xdgStateHome: dir });
    const oldState: SerenaServerState = {
      schemaVersion: 1,
      projectRoot: "/repo/main",
      projectRootRealpath: "/repo/main",
      namespace: paths.namespace,
      pid: 300,
      port: 49300,
      endpoint: "http://127.0.0.1:49300/mcp",
      startedAt: "2026-04-29T00:00:00.000Z",
    };
    const newerState: SerenaServerState = {
      ...oldState,
      pid: 301,
      port: 49301,
      endpoint: "http://127.0.0.1:49301/mcp",
      startedAt: "2026-04-29T00:00:01.000Z",
    };
    const stopped: number[] = [];

    try {
      await registerSerenaOwner(paths, oldState, 100);
      await registerSerenaOwner(paths, newerState, 200);
      await writeFile(paths.serverStatePath, `${JSON.stringify(newerState, null, 2)}\n`, "utf8");

      const didStop = await releaseSerenaOwnerAndMaybeStop(paths, oldState, 100, { isPidAlive: (pid) => pid === 200 }, async (server) => {
        stopped.push(server.pid);
      });

      expect(didStop).toBe(false);
      expect(stopped).toEqual([]);
      expect(JSON.parse(await readFile(paths.serverStatePath, "utf8"))).toMatchObject({ pid: 301 });
      expect(JSON.parse(await readFile(paths.leasePath, "utf8"))).toMatchObject([{ ownerPid: 200, serverPid: 301 }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("removes final owner lease and stops Serena on last owner shutdown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "serena-lease-test-"));
    const paths = getSerenaStatePaths("/repo/main", { xdgStateHome: dir });
    const state: SerenaServerState = {
      schemaVersion: 1,
      projectRoot: "/repo/main",
      projectRootRealpath: "/repo/main",
      namespace: paths.namespace,
      pid: 300,
      port: 49300,
      endpoint: "http://127.0.0.1:49300/mcp",
      startedAt: "2026-04-29T00:00:00.000Z",
    };
    const stopped: number[] = [];

    try {
      await registerSerenaOwner(paths, state, 100);

      const didStop = await releaseSerenaOwnerAndMaybeStop(paths, state, 100, { isPidAlive: () => false }, async (server) => {
        stopped.push(server.pid);
      });

      expect(didStop).toBe(true);
      expect(stopped).toEqual([300]);
      expect(JSON.parse(await readFile(paths.leasePath, "utf8"))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("Serena Pi tools", () => {
  const publishedParityToolNames = [
    "activate_project",
    "check_onboarding_performed",
    "create_text_file",
    "delete_lines",
    "delete_memory",
    "edit_memory",
    "execute_shell_command",
    "find_file",
    "find_referencing_symbols",
    "find_symbol",
    "get_current_config",
    "get_symbols_overview",
    "initial_instructions",
    "insert_after_symbol",
    "insert_at_line",
    "insert_before_symbol",
    "jet_brains_find_referencing_symbols",
    "jet_brains_find_symbol",
    "jet_brains_get_symbols_overview",
    "jet_brains_type_hierarchy",
    "list_dir",
    "list_memories",
    "onboarding",
    "open_dashboard",
    "prepare_for_new_conversation",
    "read_file",
    "read_memory",
    "remove_project",
    "rename_memory",
    "rename_symbol",
    "replace_content",
    "replace_lines",
    "replace_symbol_body",
    "restart_language_server",
    "search_for_pattern",
    "serena_list_tools",
    "serena_mcp_reset",
    "summarize_changes",
    "switch_modes",
    "think_about_collected_information",
    "think_about_task_adherence",
    "think_about_whether_you_are_done",
    "write_memory",
  ];

  test("registers the published Serena parity tool names", () => {
    const tools = createSerenaToolDefinitions({} as never);
    const names = tools.map((tool) => tool.name);

    for (const expectedName of publishedParityToolNames) {
      expect(names).toContain(expectedName);
    }
    expect(names).toContain("serena_status");
  });

  test("renames old prefixed wrappers to Serena's native MCP tool names", () => {
    const names = createSerenaToolDefinitions({} as never).map((tool) => tool.name);

    expect(names).not.toContain("serena_activate_project");
    expect(names).not.toContain("serena_find_references");
    expect(names).not.toContain("serena_find_symbol");
    expect(names).not.toContain("serena_get_symbols_overview");
    expect(names).not.toContain("serena_replace_symbol_body");
    expect(names).not.toContain("serena_search_codebase");
  });

  test("uses published JSON schema parameter names", () => {
    const tools = createSerenaToolDefinitions({} as never);
    expect(tools.every((tool) => tool.parameters.type === "object")).toBe(true);
    expect(tools.find((tool) => tool.name === "find_symbol")?.parameters.properties.name_path_pattern.type).toBe("string");
    expect(tools.find((tool) => tool.name === "search_for_pattern")?.parameters.properties.substring_pattern.type).toBe("string");
  });

  test("forwards native Serena arguments without compatibility rewriting", async () => {
    const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    const tools = createSerenaToolDefinitions({
      async getProjectRoot() {
        return "/repo";
      },
      async ensureServer() {
        return {
          state: {
            schemaVersion: 1,
            projectRoot: "/repo",
            projectRootRealpath: "/repo",
            namespace: "repo-test",
            pid: 123,
            port: 49152,
            endpoint: "http://127.0.0.1:49152/mcp",
            startedAt: "2026-04-29T00:00:00.000Z",
          },
          client: {
            async listTools() {
              return { tools: [] };
            },
            async callTool(call: { name: string; arguments: Record<string, unknown> }) {
              calls.push(call);
              return { content: [{ type: "text", text: "ok" }] };
            },
          },
          async close() {},
        } as never;
      },
    });

    await tools
      .find((tool) => tool.name === "find_symbol")!
      .execute("call-1", { name_path_pattern: "MyClass", include_body: true }, undefined, undefined, {} as never);

    expect(calls).toEqual([{ name: "find_symbol", arguments: { name_path_pattern: "MyClass", include_body: true } }]);
  });
});
