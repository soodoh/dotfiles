import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			exclude: [
				"**/*.test.*",
				"**/*.spec.*",
				"**/dist/**",
				"**/node_modules/**",
				"**/.turbo/**",
				"**/.pi-lens/**",
				"coverage/**",
				"packages/auto-session-name/index.ts",
				"packages/statusline/index.ts",
				"packages/prompt-suggester/src/app/ports/**",
			],
			include: ["packages/**/*.{ts,tsx}"],
			provider: "v8",
			reporter: ["text", "lcov"],
			reportsDirectory: "coverage",
			thresholds: {
				branches: 50,
				functions: 68,
				lines: 68,
				statements: 66,
			},
		},
		exclude: ["**/node_modules/**", "**/dist/**"],
		include: ["packages/**/*.{test,spec}.{ts,js}"],
	},
});
