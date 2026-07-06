# Global working preferences

## Commit metadata
- When making commits, never include any `Co-authored-by` trailers.

## Coding Guidelines

- Do not manually cast types, this indicates we need better typing holistically.
- Do not add lint or TypeScript suppression comments.
- Do not use default React imports; use named imports such as `import { useState } from "react"`.
- Prefer extending or refactoring existing shared code before adding new abstractions.
- Do not introduce parallel implementations when an existing shared pattern or utility can be reused.

## Code intelligence lookup preference

When exploring unfamiliar local code, escalate through search layers in order — do not jump straight to the heaviest one:

1. **`rg` (ripgrep)** — default for exact strings, symbol names, and short keyword queries. Fast, cheap, deterministic. Cap output with `-m` / `| head` and prefer `-l` first to find the file set, then read targeted lines.
2. **`ast-grep`** — escalate here when the pattern is *structural* rather than lexical: "every async function that returns X", "every `useState` with type Y", "every try/catch that rethrows". Anything you could express as an AST shape but would need brittle regex for. Use `--json` and post-process rather than raw dumps.
3. **`serena` MCP** — escalate here for *semantic* / *symbol-graph* questions: "where is this symbol defined", "who references this function", "what would break if I change this signature", "give me an overview of this module without reading every file", refactor planning, and symbol-scoped edits (`replace_symbol_body`, `rename_symbol`, `insert_after_symbol`). Prefer Serena's symbolic reads over reading whole files when the question is about a specific function or class.

After any of these identify candidate files or symbols, read the source to verify details before editing or making claims. Do not use semantic search for short keyword queries where `rg` would answer in one call — it wastes tokens and often ranks poorly on that query shape.
