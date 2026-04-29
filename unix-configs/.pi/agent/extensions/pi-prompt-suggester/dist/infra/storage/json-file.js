import { promises as fs } from "node:fs";
import path from "node:path";
export async function readJsonIfExists(filePath) {
    try {
        return JSON.parse(await fs.readFile(filePath, "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT")
            return undefined;
        throw error;
    }
}
export async function readObjectJsonIfExists(filePath) {
    const parsed = await readJsonIfExists(filePath);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return {};
    return parsed;
}
export async function writeJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
