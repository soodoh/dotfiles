import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
export async function atomicWriteJson(filePath, value) {
    const directory = path.dirname(filePath);
    await fs.mkdir(directory, { recursive: true });
    const tempPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, filePath);
}
