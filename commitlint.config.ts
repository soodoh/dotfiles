import { RuleConfigSeverity } from "@commitlint/types";
import type { UserConfig } from "@commitlint/types";

const Configuration: UserConfig = {
	extends: ["@commitlint/config-conventional"],
	rules: {
		"scope-enum": [
			RuleConfigSeverity.Error,
			"always",
			["root", "mise", "agents", "nvim", "mac", "shell", "herdr"],
		],
	},
};

export default Configuration;
