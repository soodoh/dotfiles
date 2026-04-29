import { promises as fs } from "node:fs";
import { atomicWriteJson } from "./atomic-write.js";
export class JsonSeedStore {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async load() {
        try {
            const raw = await fs.readFile(this.filePath, "utf8");
            return JSON.parse(raw);
        }
        catch (error) {
            if (error.code === "ENOENT")
                return null;
            throw new Error(`Failed to read seed file ${this.filePath}: ${error.message}`);
        }
    }
    async save(seed) {
        await atomicWriteJson(this.filePath, seed);
    }
}
