import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	backfillSkillSessionNameInFile,
	extractSkillName,
	extractUserRequest,
	makeSessionTitle,
	shouldNameAfterTurn,
} from "./auto-session-name";

const skillPrefixedPrompt = `<skill name="brainstorming" location="/tmp/brainstorming/SKILL.md">
# Brainstorming Ideas Into Designs

Long skill instructions that should not be used as the session title.
</skill>

When viewing previous sessions in pi, it's very hard to read if we start off with a skill.`;

const otherSkillPrefixedPrompt = `<skill name="systematic-debugging" location="/tmp/systematic-debugging/SKILL.md">
# Systematic Debugging
</skill>

Find the root cause before fixing this issue.`;

const jsonLine = (value: unknown) => `${JSON.stringify(value)}\n`;

describe("skill-started session naming", () => {
	test("detects any leading skill name", () => {
		expect(extractSkillName(skillPrefixedPrompt)).toBe("brainstorming");
		expect(extractSkillName(otherSkillPrefixedPrompt)).toBe("systematic-debugging");
	});

	test("uses the real user request after leading skill XML", () => {
		expect(extractUserRequest(skillPrefixedPrompt)).toBe(
			"When viewing previous sessions in pi, it's very hard to read if we start off with a skill.",
		);
	});

	test("builds a compact session title from skill and request", () => {
		expect(makeSessionTitle("brainstorming", extractUserRequest(skillPrefixedPrompt), 64)).toBe(
			"brainstorming: When viewing previous sessions in pi, it's very…",
		);
	});

	test("falls back to the skill name when there is no visible request", () => {
		expect(makeSessionTitle("brainstorming", "", 64)).toBe("brainstorming skill session");
	});

	test("only auto-names unnamed skill-started sessions after the first turn", () => {
		expect(shouldNameAfterTurn({ hasSessionName: false, skillName: "brainstorming", turnIndex: 0 })).toBe(true);
		expect(shouldNameAfterTurn({ hasSessionName: true, skillName: "brainstorming", turnIndex: 0 })).toBe(false);
		expect(shouldNameAfterTurn({ hasSessionName: false, skillName: undefined, turnIndex: 0 })).toBe(false);
		expect(shouldNameAfterTurn({ hasSessionName: false, skillName: "brainstorming", turnIndex: 1 })).toBe(false);
	});

	test("backfills a session_info name for existing skill-started session files", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-session-name-test-"));
		try {
			const sessionPath = join(dir, "session.jsonl");
			await writeFile(
				sessionPath,
				[
					jsonLine({ type: "session", version: 3, id: "session-id", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir }),
					jsonLine({
						type: "message",
						id: "aaaaaaaa",
						parentId: null,
						timestamp: "2026-01-01T00:00:01.000Z",
						message: { role: "user", content: otherSkillPrefixedPrompt, timestamp: Date.now() },
					}),
				].join(""),
			);

			expect(await backfillSkillSessionNameInFile(sessionPath)).toBe(true);
			const updated = await readFile(sessionPath, "utf8");
			expect(updated).toContain('"type":"session_info"');
			expect(updated).toContain('"name":"systematic-debugging: Find the root cause before fixing this issue."');
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("does not backfill sessions that already have a name", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-session-name-test-"));
		try {
			const sessionPath = join(dir, "session.jsonl");
			const original = [
				jsonLine({ type: "session", version: 3, id: "session-id", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir }),
				jsonLine({ type: "session_info", id: "bbbbbbbb", parentId: null, timestamp: "2026-01-01T00:00:00.500Z", name: "Existing name" }),
				jsonLine({
					type: "message",
					id: "aaaaaaaa",
					parentId: "bbbbbbbb",
					timestamp: "2026-01-01T00:00:01.000Z",
					message: { role: "user", content: otherSkillPrefixedPrompt, timestamp: Date.now() },
				}),
			].join("");
			await writeFile(sessionPath, original);

			expect(await backfillSkillSessionNameInFile(sessionPath)).toBe(false);
			expect(await readFile(sessionPath, "utf8")).toBe(original);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
