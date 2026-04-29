import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

import {
  createSerenaToolDefinitions,
  getSerenaStateBaseDir,
  getSerenaStatePaths,
  makeProjectNamespace,
  parseActiveProjectFromConfig,
  shouldReuseServerState,
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
});

describe("Serena Pi tools", () => {
  test("registers only task-oriented Serena tools", () => {
    const tools = createSerenaToolDefinitions({} as never);
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "serena_activate_project",
      "serena_find_references",
      "serena_find_symbol",
      "serena_get_symbols_overview",
      "serena_replace_symbol_body",
      "serena_search_codebase",
      "serena_status",
    ]);
  });

  test("tool definitions do not expose raw MCP passthrough", () => {
    const tools = createSerenaToolDefinitions({} as never);
    expect(tools.some((tool) => tool.name.includes("mcp") || tool.name.includes("raw"))).toBe(false);
  });

  test("uses JSON schema parameters", () => {
    const tools = createSerenaToolDefinitions({} as never);
    expect(tools.every((tool) => tool.parameters.type === "object")).toBe(true);
    expect(tools.find((tool) => tool.name === "serena_find_symbol")?.parameters.properties.name_path.type).toBe("string");
  });
});
