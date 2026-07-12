import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Sha256FileHash } from "../../../src/infra/hashing/sha256-file-hash";

test("Sha256FileHash returns a known sha256 digest", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-suggester-hash-"));
	try {
		const filePath = join(dir, "message.txt");
		await writeFile(filePath, "hello", "utf8");

		await expect(new Sha256FileHash().hashFile(filePath)).resolves.toBe(
			"sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("Sha256FileHash rejects missing files", async () => {
	const dir = await mkdtemp(join(tmpdir(), "pi-suggester-hash-missing-"));
	try {
		await expect(
			new Sha256FileHash().hashFile(join(dir, "missing.txt")),
		).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
