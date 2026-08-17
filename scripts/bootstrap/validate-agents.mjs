#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const profile = process.env.DOTFILES_PROFILE ?? process.env.MISE_ENV;
if (profile !== "personal-macos" && profile !== "work-macos") {
  throw new Error(`unsupported profile: ${profile ?? "unset"}`);
}
const profileName = profile.replace(/-macos$/, "");
const settingsPath = resolve(root, `dotfiles/profiles/${profileName}/.pi/agent/settings.json`);
const settings = JSON.parse(await readFile(settingsPath, "utf8"));
if (settings.packages?.[0]?.source !== "./pi-extensions") {
  throw new Error(`${settingsPath} must point at checkout-local ./pi-extensions`);
}
for (const resource of settings.packages[0].extensions ?? []) {
  await access(resolve(root, "pi-extensions", resource));
}

if (profile === "work-macos") {
  const mcpPath = resolve(root, "dotfiles/profiles/work/.pi/agent/mcp.json");
  const config = JSON.parse(await readFile(mcpPath, "utf8"));
  const commands = {
    kusto: "kusto-mcp",
    "azure-devops": "mcp-server-azuredevops",
    figma: "figma-developer-mcp",
  };
  for (const [name, command] of Object.entries(commands)) {
    const server = config.mcpServers[name];
    if (server.command !== command) {
      throw new Error(`${mcpPath}: ${name} must use repository-local ${command}`);
    }
    await access(resolve(root, "packages/work-mcp-servers/node_modules/.bin", command));
  }
}
