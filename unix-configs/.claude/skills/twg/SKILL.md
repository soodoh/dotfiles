---
name: twg
description: >
  Root operating skill for the TWG CLI. Use for Atlassian work-data tasks across
  Jira, Confluence, Bitbucket, goals/projects/focus areas, JSM, Assets, people,
  teams, org structure, docs, meetings, videos, search, graph context, and
  supported mutations. Exact command syntax must come from live `twg help`.
---

# twg

First TWG routing step: run `twg help` for the compact command map or
`twg help <terms>` for loose command search.

## Overview

Use this skill for TWG CLI work-data tasks. For synthesized outcomes such as
status reports, topic deep dives, dependency maps, review queues, handoffs,
operational reviews, appraisals, or action lists, also load `twg-workflows`.

## Available scripts

- `twg` - run TWG with agent defaults.

For large outputs, inspect `output_files.compact` first when present, then read
or filter `output_files.stdout` only when the compact view lacks evidence. See
`references/OUTPUT.md`.

## Command Discovery

- Use `twg help` for top-level compact YAML routing. In namespace output, `$`
  lists executable child commands under the current namespace.
- Use `twg help <terms>` before guessing command names, arguments, flags,
  choices, or defaults.
- Use `twg help describe <path>` to inspect either a namespace map or an exact
  executable command contract. Namespace output is compact YAML; executable
  output is JSON by default.
- Before writing `jq` filters for a command, inspect `help describe` output.
  Prefer the advertised `output.recommendedSummary` and
  `output.recommendedAgentFields` over trial-and-error raw JSON inspection.
- Follow `next` commands from help output exactly; do not synthesize
  unsupported help syntax.
- Do not use legacy human `--help` loops for agent discovery.
- Resolve: use `twg resolve --query "<input>"` for URLs, keys, ARIs,
  exact names, and people.
- Search: use `twg search "<query>" --limit 20` for fuzzy topics,
  partial titles, nicknames, customers/themes, or unknown products.
- When using app filters, discover valid Rovo app keys first: `twg rovo list-apps`
- Hydrate: fetch the best 1-3 candidates with native `get`, product `query`,
  or `context` commands.
- Synthesize: answer from hydrated evidence, not search snippets.

## Routing

| Area           | Surfaces                                                               |
| -------------- | ---------------------------------------------------------------------- |
| Product-native | Jira, Confluence, Bitbucket, goals/projects/focus areas, JSM, Assets   |
| People/org     | users, teams, org-tree, collaborators                                  |
| Cross-product  | Rovo search, docs, meetings, videos, work activity                     |
| Graph/context  | resolve, context, Cypher, visualization                                |
| Workflows      | status, dependency, engineering, operations recipes in `twg-workflows` |

Concrete scope matters: use a Jira key, page URL, PR URL, repo slug, account ID,
team/project/goal/focus-area name, customer/topic name, "me", or a time window.
If there is no concrete or partial scope, ask before running broad searches.

## Rules

- Never guess IDs, flags, Jira keys, project keys, account IDs, page IDs,
  workspace/repo slugs, ARIs, or object IDs.
- Treat search/Rovo results as candidate anchors only.
- Fan-out is bounded: resolve scope first, then hydrate selected artifacts.
- For broad reports, prefer summary output and local filtering over flooding
  stdout.
- Avoid using `rg` to inspect TWG JSON payloads. Use `output_files.compact` when
  present, or targeted `jq` against `output_files.stdout`.
- For writes, read current state first and state the intended mutation unless the
  user explicitly asked you to execute it.

## Anti-Patterns

- Do not prefer compatibility aliases such as `user-search`, `page`, or `issue`
  when writing examples or plans. They exist only to rescue stale prompts; use
  the canonical command path shown by `twg help`.
- Do not start an org or topic report by fanning out `work query` for dozens of
  people. Resolve the scope and sample the most relevant anchors first.
- Do not stop at the wrapper YAML summary when the answer requires item names,
  owners, status, URLs, or evidence. Inspect `output_files.compact` first; if it
  is absent or insufficient, use targeted `jq` on `output_files.stdout`.

## References

- `references/HELP.md` - help discovery and exact-command schemas
- `references/OUTPUT.md` - output envelopes and large payload handling
- `references/PRODUCTS.md` - product caveats and mental model
- `references/QUERY-LANGUAGES.md` - JQL, CQL, AQL, and TQL
- `../twg-workflows/references/` - workflow recipes, including deep context
  discovery and graph visualization
