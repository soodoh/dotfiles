import assert from "node:assert/strict";
import { globSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, matchesGlob, relative, resolve } from "node:path";

// The package manifest is the only extension catalog. No package-specific skips.
export function manifestResources(packageRoot) {
	const manifest = JSON.parse(
		readFileSync(resolve(packageRoot, "package.json"), "utf8"),
	);
	assert.ok(
		manifest.pi && typeof manifest.pi === "object",
		"Missing pi resource manifest",
	);
	const resources = {};
	for (const kind of ["extensions", "skills", "prompts", "themes"]) {
		const declarations = manifest.pi[kind] ?? [];
		assert.ok(Array.isArray(declarations), `pi.${kind} must be an array`);
		for (const declaration of declarations) {
			assert.ok(
				typeof declaration === "string" && declaration.length,
				`Invalid pi.${kind} path`,
			);
			const pattern = declaration.replace(/^!/, "");
			assert.ok(
				pattern &&
					!isAbsolute(pattern) &&
					!pattern.split(/[\\/]/).includes(".."),
				`pi.${kind} paths must stay package-relative: ${declaration}`,
			);
		}
		const excluded = declarations
			.filter((path) => path.startsWith("!"))
			.map((path) => path.slice(1).replace(/^\.\//, ""));
		const paths = new Map();
		for (const declaration of declarations.filter(
			(path) => !path.startsWith("!"),
		)) {
			const matches = globSync(declaration, { cwd: packageRoot }).sort();
			assert.ok(
				matches.length,
				`pi.${kind}: missing or unmatched resource ${declaration}`,
			);
			for (const match of matches) {
				if (
					excluded.some((pattern) =>
						matchesGlob(match.replace(/^\.\//, ""), pattern),
					)
				)
					continue;
				const path = resolve(packageRoot, match);
				const stat = statSync(path);
				assert.ok(
					stat.isFile() || stat.isDirectory(),
					`Not a file/directory: ${path}`,
				);
				if (kind !== "extensions") {
					const pattern =
						kind === "skills"
							? "**/SKILL.md"
							: kind === "prompts"
								? "**/*.md"
								: "**/*.json";
					assert.ok(
						stat.isDirectory()
							? globSync(pattern, { cwd: path }).length > 0
							: path.endsWith(kind === "themes" ? ".json" : ".md"),
						`pi.${kind}: no usable resources at ${match}`,
					);
				}
				paths.set(realpathSync(path), path);
			}
		}
		resources[kind] = [...paths.values()];
	}
	return resources;
}

export function assertLoaded(report, label) {
	assert.deepEqual(
		report.errors,
		[],
		`${label}: Pi extension-load diagnostics`,
	);
	assert.deepEqual(
		report.resourceDiagnostics,
		[],
		`${label}: Pi resource diagnostics`,
	);
	assert.ok(
		report.extensions.length > 0,
		`${label}: Pi silently loaded no extensions`,
	);
}

export function resourceLabel(packageRoot, path) {
	return relative(packageRoot, path);
}
