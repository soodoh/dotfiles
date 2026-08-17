#!/usr/bin/env node
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const packageRoot = join(repositoryRoot, "pi-extensions");
const manifestPath = join(packageRoot, "package.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const resourceTypes = ["extensions", "skills", "prompts", "themes"];
const localPi = {};

for (const packageName of Object.keys(manifest.peerDependencies ?? {})) {
  await access(join(packageRoot, "node_modules", packageName, "package.json"));
}

for (const type of resourceTypes) {
  localPi[type] = (manifest.pi?.[type] ?? []).filter(
    (resource) => !resource.replace(/^\.\//, "").startsWith("node_modules/"),
  );
}

for (const packageName of new Set(manifest.bundleDependencies ?? [])) {
  const dependencyRoot = join(packageRoot, "node_modules", packageName);
  const dependencyManifest = JSON.parse(
    await readFile(join(dependencyRoot, "package.json"), "utf8"),
  );
  const dependencyPrefix = relative(packageRoot, dependencyRoot).replaceAll("\\", "/");

  for (const type of resourceTypes) {
    for (const resource of dependencyManifest.pi?.[type] ?? []) {
      localPi[type].push(`${dependencyPrefix}/${resource.replace(/^\.\//, "")}`);
    }
  }
}

manifest.pi = {};
for (const type of resourceTypes) {
  if (localPi[type].length > 0) {
    manifest.pi[type] = [...new Set(localPi[type])];
  }
}

const rendered = `${JSON.stringify(manifest, null, "\t")}\n`;
if (process.argv.includes("--check")) {
  const current = await readFile(manifestPath, "utf8");
  if (current !== rendered) {
    console.error("pi-extensions/package.json resource aggregation is stale");
    process.exit(1);
  }
} else {
  await writeFile(manifestPath, rendered);
}
