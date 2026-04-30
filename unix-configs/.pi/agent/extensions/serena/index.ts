import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { createSerenaRuntime, registerSerenaTools, type SerenaServerState } from "./serena-tools";

const DEFAULT_BLOCKED_TOOL_NAMES = ["read", "write", "edit", "ls", "find", "grep"];
const DEFAULT_SERENA_TOOL_TIMEOUT_MS = 20_000;

type SettingsJson = Record<string, unknown> & {
  serena?: {
    blockedTools?: unknown;
  };
};

export default function serenaExtension(pi: ExtensionAPI) {
  const runtime = createSerenaRuntime();
  let blockedToolNames = [...DEFAULT_BLOCKED_TOOL_NAMES];
  let activeServerState: SerenaServerState | undefined;

  registerSerenaTools(pi, runtime);

  pi.on("tool_call", async (event) => {
    if (blockedToolNames.includes(event.toolName)) {
      return {
        block: true,
        reason: `Tool '${event.toolName}' is disabled. Use Serena tools instead.`,
      };
    }
  });

  pi.registerCommand("serena-tool-blocker", {
    description: "Configure the Serena tool blacklist",
    handler: async (_args, ctx) => {
      const projectRoot = await runtime.getProjectRoot(ctx);
      blockedToolNames = await loadBlockedTools(projectRoot);

      const allTools = pi
        .getAllTools()
        .map((tool) => tool.name)
        .sort((a, b) => a.localeCompare(b));
      const blocked = new Set(blockedToolNames);

      while (ctx.hasUI) {
        const options = allTools.map((name) => `${blocked.has(name) ? "✓" : " "} ${name}`);
        options.push("Done");

        const choice = await ctx.ui.select("Toggle blocked tools", options);
        if (!choice || choice === "Done") break;
        const name = choice.slice(2);
        if (blocked.has(name)) blocked.delete(name);
        else blocked.add(name);
      }

      blockedToolNames = Array.from(blocked).sort((a, b) => a.localeCompare(b));
      await saveProjectBlockedTools(projectRoot, blockedToolNames);
      if (ctx.hasUI) ctx.ui.notify("Serena tool blacklist updated.", "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const projectRoot = await runtime.getProjectRoot(ctx);
    blockedToolNames = await loadBlockedTools(projectRoot);

    try {
      const connection = await runtime.ensureServer(ctx, ctx.signal);
      await runtime.registerOwner(ctx, connection.state);
      activeServerState = connection.state;
      try {
        await activateSessionProject(connection.client, projectRoot);
      } finally {
        await connection.close();
      }
    } catch {
      // Keep startup non-fatal; the Serena tools will surface connection errors when invoked.
    }
  });

  pi.on("session_shutdown", async (event, ctx) => {
    if (event.reason !== "quit" || !activeServerState) return;

    try {
      await runtime.releaseOwner(ctx, activeServerState);
      activeServerState = undefined;
    } catch {
      // Shutdown should remain best-effort; stale leases are pruned by future Pi sessions.
    }
  });
}

async function activateSessionProject(
  client: {
    listTools: () => Promise<{ tools: Array<{ name: string }> }>;
    callTool: (request: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
  },
  projectRoot: string,
) {
  const tools = await client.listTools();
  const toolNames = new Set(tools.tools.map((tool) => tool.name));

  if (toolNames.has("activate_project")) {
    await withTimeout(
      client.callTool({ name: "activate_project", arguments: { project: projectRoot } }),
      DEFAULT_SERENA_TOOL_TIMEOUT_MS,
      `Serena MCP request timed out after ${DEFAULT_SERENA_TOOL_TIMEOUT_MS}ms`,
    );
  }

  if (toolNames.has("check_onboarding_performed")) {
    await withTimeout(
      client.callTool({ name: "check_onboarding_performed", arguments: {} }),
      DEFAULT_SERENA_TOOL_TIMEOUT_MS,
      `Serena MCP request timed out after ${DEFAULT_SERENA_TOOL_TIMEOUT_MS}ms`,
    );
  }
}

async function loadBlockedTools(projectRoot: string): Promise<string[]> {
  const globalSettings = await readJsonSettings(join(homedir(), ".pi", "agent", "settings.json"));
  const projectSettings = await readJsonSettings(join(projectRoot, ".pi", "settings.json"));

  return getBlockedTools(projectSettings) ?? getBlockedTools(globalSettings) ?? [...DEFAULT_BLOCKED_TOOL_NAMES];
}

function getBlockedTools(settings: SettingsJson | undefined): string[] | undefined {
  const blockedTools = settings?.serena?.blockedTools;
  if (Array.isArray(blockedTools) && blockedTools.every((tool) => typeof tool === "string")) {
    return blockedTools;
  }
  return undefined;
}

async function saveProjectBlockedTools(projectRoot: string, tools: string[]): Promise<void> {
  const settingsPath = join(projectRoot, ".pi", "settings.json");
  const settings = (await readJsonSettings(settingsPath)) ?? {};
  settings.serena = { ...(settings.serena ?? {}), blockedTools: tools };
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

async function readJsonSettings(settingsPath: string): Promise<SettingsJson | undefined> {
  try {
    return JSON.parse(await readFile(settingsPath, "utf8")) as SettingsJson;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
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
