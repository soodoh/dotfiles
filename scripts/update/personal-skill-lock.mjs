#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = JSON.parse(await readFile(resolve(root, "dotfiles/profiles/common/.agents/.skill-lock.json"), "utf8"));
const selected = new Set([
  "find-skills",
  "grill-me",
  "obsidian-cli",
  "playwright-cli",
  "skill-creator",
  "thermo-nuclear-code-quality-review",
  "vercel-react-best-practices",
]);
source.skills = Object.fromEntries(Object.entries(source.skills).filter(([name]) => selected.has(name)));
if (Object.keys(source.skills).length !== selected.size) {
  throw new Error("shared skill lock is missing a personal skill");
}
await writeFile(
  resolve(root, "dotfiles/profiles/personal/.agents/.skill-lock.json"),
  `${JSON.stringify(source, null, 2)}\n`,
);
