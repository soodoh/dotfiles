import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { projectStateDir } from "../../../dist/infra/pi/state-root.js";

test("prompt suggester state root uses ~/.local/state/pi/pi-prompt-suggester by default", () => {
	assert.equal(
		path.dirname(projectStateDir("/tmp/repo", { home: "/Users/example" })),
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

	assert.match(
		first,
		new RegExp(`^${escapeRegExp(expectedPrefix)}[a-f0-9]{12}$`),
	);
	assert.match(
		second,
		new RegExp(`^${escapeRegExp(expectedPrefix)}[a-f0-9]{12}$`),
	);
	assert.notEqual(first, second);
});

test("prompt suggester state root normalizes unsafe project names", () => {
	const dir = projectStateDir("/tmp/My Repo!", { home: "/Users/example" });
	assert.match(path.basename(dir), /^My_Repo_-[a-f0-9]{12}$/);
});

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
