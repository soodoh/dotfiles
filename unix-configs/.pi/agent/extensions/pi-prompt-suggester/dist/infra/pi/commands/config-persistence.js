import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileConfigLoader } from "../../../config/loader.js";
import { projectStateDir } from "../state-root.js";
import { readObjectJsonIfExists, writeJson } from "../../storage/json-file.js";
import { setPathValue } from "./shared.js";
export function projectOverridePath(cwd, homeDir) {
    return path.join(projectStateDir(cwd, { home: homeDir }), "config.json");
}
export function userOverridePath(homeDir = os.homedir()) {
    return path.join(homeDir, ".pi", "suggester", "config.json");
}
export class SuggesterConfigPersistence {
    ctx;
    composition;
    constructor(ctx, composition) {
        this.ctx = ctx;
        this.composition = composition;
    }
    overridePathForScope(scope) {
        return scope === "user" ? userOverridePath() : projectOverridePath(this.ctx.cwd);
    }
    async refreshCompositionConfig() {
        const next = await new FileConfigLoader(this.ctx.cwd).load();
        Object.assign(this.composition.config, next);
    }
    async readOverride(scope) {
        return await readObjectJsonIfExists(this.overridePathForScope(scope));
    }
    async readOverrideValue(scope, configPath) {
        const raw = await this.readOverride(scope);
        let cursor = raw;
        for (const segment of configPath.split(".").map((part) => part.trim()).filter(Boolean)) {
            if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || !(segment in cursor)) {
                return undefined;
            }
            cursor = cursor[segment];
        }
        return cursor;
    }
    async readOverrideCustomInstruction(scope) {
        const value = await this.readOverrideValue(scope, "suggestion.customInstruction");
        return typeof value === "string" ? value : "";
    }
    async writeValue(scope, configPath, value) {
        const filePath = this.overridePathForScope(scope);
        let previousRaw;
        try {
            previousRaw = await fs.readFile(filePath, "utf8");
        }
        catch (error) {
            if (error.code !== "ENOENT") {
                throw new Error(`Failed to read config override ${filePath}: ${error.message}`);
            }
        }
        let current = {};
        if (previousRaw !== undefined) {
            try {
                const parsed = JSON.parse(previousRaw);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    current = parsed;
                }
                else {
                    throw new Error(`Override config ${filePath} must be a JSON object.`);
                }
            }
            catch (error) {
                throw new Error(`Failed to parse config override ${filePath}: ${error.message}`);
            }
        }
        const next = JSON.parse(JSON.stringify(current));
        setPathValue(next, configPath
            .split(".")
            .map((segment) => segment.trim())
            .filter(Boolean), value);
        try {
            await writeJson(filePath, next);
            await this.refreshCompositionConfig();
        }
        catch (error) {
            try {
                if (previousRaw === undefined) {
                    await fs.rm(filePath, { force: true });
                }
                else {
                    await fs.mkdir(path.dirname(filePath), { recursive: true });
                    await fs.writeFile(filePath, previousRaw, "utf8");
                }
            }
            catch {
                // Best-effort rollback only.
            }
            throw new Error(`Failed to apply config change: ${error.message}`);
        }
    }
    async resetScopes(scopes) {
        const removed = [];
        for (const scope of scopes) {
            const target = this.overridePathForScope(scope);
            try {
                await fs.rm(target, { force: true });
                removed.push(target);
            }
            catch (error) {
                throw new Error(`Failed to reset config at ${target}: ${error.message}`);
            }
        }
        await this.refreshCompositionConfig();
        return removed;
    }
}
