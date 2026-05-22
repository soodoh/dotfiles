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

Use the `codanna` skill/CLI before broad `rg`, `find`, or file-reading loops when exploring unfamiliar local code. Prefer Codanna for questions like "where is this implemented", "how does this code path work", "what calls this", "what might break if I change this", symbol lookup, semantic code search, call graphs, impact analysis, and refactor planning. After Codanna identifies candidate files or symbols, read the source to verify details before editing or making claims.
