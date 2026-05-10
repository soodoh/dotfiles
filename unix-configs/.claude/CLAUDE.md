# Global working preferences

## Commit metadata
- When making commits, never include any `Co-authored-by` trailers.

## Code Search: rg vs ast-grep

- Use `rg` by default for plain text search: filenames, symbols, string literals, comments, docs, config keys, logs, and quick repository exploration.
- Use `ast-grep` for syntax-aware code search when the query depends on code structure rather than exact text:
  - finding function/class/import/call/JSX patterns
  - distinguishing declarations vs calls vs references
  - matching code regardless of whitespace/formatting
  - finding patterns inside other constructs, e.g. calls inside functions/components
  - finding missing or negative patterns, e.g. async functions without try/catch
  - preparing safe structural rewrites or codemods
- If unsure, start with `rg` to learn names and file locations, then switch to `ast-grep` when regex becomes brittle or produces many false positives.
- Do not use `ast-grep` as a replacement for text search in markdown, comments, logs, or unsupported languages.
- When using `ast-grep`, read the ast-grep skill first. Prefer simple `ast-grep run --pattern ... --lang ...` searches before writing YAML rules; use `scan` rules for relational/composite logic. For relational rules like `inside` or `has`, include `stopBy: end` unless there is a specific reason not to.

## Coding Guidelines

- Do not manually cast types, this indicates we need better typing holistically.
- Do not add lint or TypeScript suppression comments.
- Do not use default React imports; use named imports such as `import { useState } from "react"`.
- Prefer extending or refactoring existing shared code before adding new abstractions.
- Do not introduce parallel implementations when an existing shared pattern or utility can be reused.

## Documentation lookup preference

Use Context7 before inferring or using general web search when a task depends on current or version-specific documentation for a library, framework, API, SDK, CLI, plugin, or configuration format.

Prefer Context7 for:
- Library/framework API details and examples
- Version-sensitive behavior, migrations, deprecations, or breaking changes
- Setup/configuration instructions
- Third-party CLI flags, config keys, plugin APIs, or auth flows
- Cases where an API may have changed since model training

Do not use Context7 for:
- Purely local refactors or repo-specific logic
- Basic language/shell/git concepts
- Questions answerable from files already in the workspace

Use web search only when Context7 does not cover the source, when looking for broader ecosystem discussion, issues, changelogs, blog posts, or non-library current information.
