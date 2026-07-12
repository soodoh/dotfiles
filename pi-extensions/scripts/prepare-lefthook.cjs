const { existsSync } = require("node:fs");
const { execFileSync } = require("node:child_process");

if (!existsSync(".git")) {
	process.exit(0);
}

execFileSync("lefthook", ["install"], { stdio: "inherit" });
