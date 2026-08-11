#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

const lockPath = process.argv[2] ?? "package-lock.json";
const lock = JSON.parse(await readFile(lockPath, "utf8"));
const cache = new Map();

for (const entry of Object.values(lock.packages ?? {})) {
  if (!entry || entry.integrity || entry.link || !entry.resolved?.startsWith("https://registry.npmjs.org/")) {
    continue;
  }

  const match = entry.resolved.match(/registry\.npmjs\.org\/(.+)\/-\/[^/]+-([^/]+)\.tgz$/);
  if (!match) {
    throw new Error(`Cannot derive registry metadata from ${entry.resolved}`);
  }

  const packagePath = decodeURIComponent(match[1]);
  const version = entry.version ?? match[2];
  const key = `${packagePath}@${version}`;
  let integrity = cache.get(key);
  if (!integrity) {
    const encodedName = encodeURIComponent(packagePath).replace("%2F", "%2f");
    const response = await fetch(`https://registry.npmjs.org/${encodedName}/${version}`);
    if (!response.ok) {
      throw new Error(`Registry lookup failed for ${key}: ${response.status}`);
    }
    integrity = (await response.json()).dist?.integrity;
    if (!integrity) {
      throw new Error(`Registry metadata has no integrity for ${key}`);
    }
    cache.set(key, integrity);
  }
  entry.integrity = integrity;
}

await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
