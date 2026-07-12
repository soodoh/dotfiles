import path from "node:path";
import { expect, test } from "vitest";
import { projectStateDir } from "../../../src/infra/pi/state-root";

test("prompt suggester state root uses ~/.local/state/pi/pi-prompt-suggester by default", () => {
	expect(
		path.dirname(projectStateDir("/tmp/repo", { home: "/Users/example" })),
	).toBe(
		path.join(
			"/Users/example",
			".local",
			"state",
			"pi",
			"pi-prompt-suggester",
			"projects",
		),
	);
});

test("prompt suggester state root avoids collisions for projects with the same basename", () => {
	const first = projectStateDir("/tmp/repos/dotfiles", {
		home: "/Users/example",
	});
	const second = projectStateDir("/other/repos/dotfiles", {
		home: "/Users/example",
	});
	const expectedPrefix = path.join(
		"/Users/example",
		".local",
		"state",
		"pi",
		"pi-prompt-suggester",
		"projects",
		"dotfiles-",
	);

	expect(first).toMatch(
		new RegExp(`^${escapeRegExp(expectedPrefix)}[a-f0-9]{12}$`),
	);
	expect(second).toMatch(
		new RegExp(`^${escapeRegExp(expectedPrefix)}[a-f0-9]{12}$`),
	);
	expect(first).not.toBe(second);
});

test("prompt suggester state root normalizes unsafe project names", () => {
	const dir = projectStateDir("/tmp/My Repo!", { home: "/Users/example" });
	expect(path.basename(dir)).toMatch(/^My_Repo_-[a-f0-9]{12}$/);
});

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
