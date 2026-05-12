---
name: codanna
description: >
  Use Codanna CLI for code intelligence: semantic code search, symbol lookup,
  callers/callees, dependency and impact analysis, implementations, and indexed
  documentation search. Use this skill whenever the user asks where code lives,
  how a symbol is connected, what calls what, what might break if something
  changes, or asks for concept-level code exploration, even if they do not
  explicitly mention Codanna.
---

# Codanna

Codanna gives agents indexed code intelligence through the `codanna` CLI. It is
especially useful before broad `grep`/file-reading loops when the user wants to
understand code structure, relationships, or intent.

## Prerequisites and bootstrap

- `codanna` must be available on `PATH`.
- Before running any Codanna query in a repository, ensure Codanna is initialized
  and indexed. This is expected setup for using the skill, so do it
  automatically instead of asking first.

Bootstrap sequence:

```bash
# Create .codanna/settings.toml if the project has not been initialized yet.
test -f .codanna/settings.toml || codanna init

# Check whether the index already has content.
codanna mcp --json get_index_info
```

If `get_index_info` shows `file_count` is `0`, or if a search command reports no
usable index/configuration, build the initial index before searching:

```bash
codanna index .
```

For active repositories where recent edits may not be indexed, prefer `--watch`
on one-shot queries or run `codanna index .` when freshness matters.

## Operating rules

1. Prefer Codanna for code-structure questions: symbol location, callers,
   callees, impact radius, implementations, and concept-level discovery.
2. Prefer `--json` so results can be parsed reliably. Use text output only for a
   quick human-facing check.
3. Use `--watch` on one-shot queries when the repository has changed recently or
   stale results would be risky:

   ```bash
   codanna mcp --watch --json semantic_search_with_context query:"error handling" limit:3
   ```

4. Treat Codanna results as navigation and evidence, not as a substitute for
   reading code. After Codanna identifies files and line ranges, read the
   relevant source before editing or making claims.
5. Use `symbol_id:N` for follow-up relationship queries when Codanna returns a
   symbol id. This avoids ambiguity between duplicate names.
6. Use normal text search (`rg`) for exact strings, config keys, logs, or when
   the user supplied a literal token. Use Codanna when structure or meaning
   matters.
7. Do not start `codanna serve --watch` unless the user specifically asks for an
   MCP server. In Claude Code and pi, the direct `codanna mcp ...` CLI commands
   are enough and avoid persistent server/index lock issues.
8. If a repo uses a non-default config, pass it explicitly:

   ```bash
   codanna --config .codanna/settings.toml mcp --json get_index_info
   ```

## Command recipes

| Intent | Command |
| --- | --- |
| Check index status | `codanna mcp --json get_index_info` |
| Find code by concept with relationships | `codanna mcp --json semantic_search_with_context query:"<concept>" limit:3` |
| Find code by concept, lighter output | `codanna mcp --json semantic_search_docs query:"<concept>" limit:5` |
| Fuzzy symbol search | `codanna mcp --json search_symbols query:"<name-or-topic>" limit:10` |
| Exact symbol lookup | `codanna mcp --json find_symbol <SymbolName>` |
| What a function calls | `codanna mcp --json get_calls symbol_id:<N>` |
| Who calls a function | `codanna mcp --json find_callers symbol_id:<N>` |
| What may break if this changes | `codanna mcp --json analyze_impact symbol_id:<N>` |
| Search indexed markdown/text docs | `codanna mcp --json search_documents query:"<docs query>" limit:5` |

For complex quoting or generated arguments, use JSON args instead of shell
key-value syntax:

```bash
codanna mcp --json --args '{"query":"where do we validate OAuth callback state?","limit":5}' semantic_search_with_context
```

## Query strategy

### Concept discovery

When the user asks "where is X handled?", "how does X work?", or describes a
behavior without naming symbols:

1. Run `semantic_search_with_context` with a specific domain query.
2. If results are weak, try `search_symbols` with likely terms.
3. Read the top candidate files/line ranges.
4. Use `find_callers`, `get_calls`, or `analyze_impact` for follow-up questions.

Example:

```bash
codanna mcp --json semantic_search_with_context query:"OAuth callback state validation and CSRF protection" limit:5
```

### Symbol investigation

When the user names a class, function, method, trait/interface, or module:

1. Run `find_symbol` for exact names or `search_symbols` if the name may be
   partial.
2. Prefer returned `symbol_id` for calls/callers/impact.
3. Read the implementation before summarizing or editing.

Example:

```bash
codanna mcp --json find_symbol AuthService
codanna mcp --json find_callers symbol_id:123
codanna mcp --json analyze_impact symbol_id:123
```

### Impact analysis

When the user asks what changes might affect, before refactors, or before
renaming/changing public behavior:

1. Identify the symbol id.
2. Run `analyze_impact`.
3. Read high-confidence callers and tests.
4. Summarize direct callers, indirect risk, and verification targets.

## Output style

When answering from Codanna results, include:

- Key files and line ranges.
- Relevant symbol names and ids when useful for follow-up.
- Relationship summary: callers, callees, implementations, or impact.
- What you verified by reading source versus what Codanna suggested.
- Gaps or low-confidence areas if semantic scores are weak or the index appears
  stale.
