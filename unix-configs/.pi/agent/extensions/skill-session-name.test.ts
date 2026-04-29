import { describe, expect, test } from "bun:test";
import {
	extractSkillName,
	extractUserRequest,
	makeSessionTitle,
	shouldNameAfterTurn,
} from "./skill-session-name";

const skillPrefixedPrompt = `<skill name="brainstorming" location="/tmp/brainstorming/SKILL.md">
# Brainstorming Ideas Into Designs

Long skill instructions that should not be used as the session title.
</skill>

When viewing previous sessions in pi, it's very hard to read if we start off with a skill.`;

describe("skill-started session naming", () => {
	test("detects the leading skill name", () => {
		expect(extractSkillName(skillPrefixedPrompt)).toBe("brainstorming");
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
});
