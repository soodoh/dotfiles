import path from "node:path";
import { FileConfigLoader } from "../config/loader.js";
import { projectStateDir } from "../infra/pi/state-root.js";
import { Sha256FileHash } from "../infra/hashing/sha256-file-hash.js";
import { JsonSeedStore } from "../infra/storage/json-seed-store.js";
import { GitClient } from "../infra/vcs/git-client.js";
import { StalenessChecker } from "../app/services/staleness-checker.js";
export async function runStaleCheckScript() {
    const cwd = process.cwd();
    const config = await new FileConfigLoader(cwd).load();
    const checker = new StalenessChecker({
        config,
        fileHash: new Sha256FileHash(),
        vcs: new GitClient(cwd),
        cwd,
    });
    const seedStore = new JsonSeedStore(path.join(projectStateDir(cwd), "seed.json"));
    const seed = await seedStore.load();
    const result = await checker.check(seed);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
