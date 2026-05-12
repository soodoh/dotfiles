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
