# Context Discovery

Use this family for topic deep dives, workitem/page/user context, dependency
maps, project/page-to-repo discovery, and graph-style explanations.

## Triggers

- "Catch me up on..."
- "Deep context around this workitem/page/topic"
- "Dependency map"
- "Which repo should I change?"
- "Which people/repos/projects are related?"
- "Draw the graph" / "visualize" / "open the graph"
- "Find upstream/downstream blockers or consumers"
- "Who's involved" / "experts on X"

Expansion strategy and stop rule come from the dispatch table in
`twg-workflows/SKILL.md`.

## Anchor Resolution

- Stable key/URL/ARI: use it directly after `twg help` confirms accepted input.
- Fuzzy topic/name: `twg resolve --query`, then `twg search` / `twg rovo search`
  if needed.
- Multiple anchors of the same kind: pass them all to a single batched `context`
  call so edges return together.

## Per-Candidate Expansion

For every candidate (anchor or peer), run source fetch and context as a single
parallel batch:

- **Source fetch** (`get`, `query`) - fields, owner, status, body, comments.
- **Context** (`context`, `subgraph`) - graph edges including formal external
  links. Context is the only path to formal external edges, so a failed context
  call is a coverage gap, not a safe skip.

Use summary detail first. Escalate to full only for the central anchor or up to
3 high-signal related anchors when URLs, comments, body content, or provenance
are missing.

Read `output_files.stdout` before selecting artifacts; do not rely on
`stdout_shape` for context results. Shape samples are statistical, and external
links often appear at the tail of relationship arrays where summaries truncate
first.

## Expansion Budget

- Start graph/context deep dives with `--since 30d`. The CLI default is `7d`,
  which can under-collect edges for deep context discovery.
- Expand to `60d`, then `90d`, only when evidence is insufficient. Use `7d` or
  `14d` for explicitly recent/status requests.
- Fetch known older links directly by URL, key, ID, or ARI instead of widening
  the whole graph blindly.
- Hydrate up to 3 high-signal related anchors one level deeper. High-signal
  anchors include RFCs, parents, implementation artifacts, and third-party or
  remote links.
- Artifact URLs can come from descriptions, comments, remote links, and formal
  context relationships. Track provenance because it determines graph edge
  direction.

## Dependency Map And Relationship Defaults

For graph, dependency, and "who's involved" prompts, expand by relationship
role rather than raw count:

| Relationship                              | Default action                                                     |
| ----------------------------------------- | ------------------------------------------------------------------ |
| Parent, epic, inbound peer                | Expand; these often carry decisions and links the anchor lacks.    |
| Outbound peer, blocker, consumer          | Expand when it changes dependency direction, ownership, or status. |
| Child issue or sub-task                   | Verify body before dismissing; title/summary alone is not enough.  |
| Confluence page or planning doc           | Fetch body when it is central or carries source links.             |
| External design, PR, commit, branch       | Add as graph node with URL and provenance.                         |
| Assignee, reporter, contributor, reviewer | Add as person node; resolve team for graph/expert prompts.         |

## Embedded URLs

Third-party URLs (Figma, Google Doc, GitHub, Loom, partner doc) appear in these
places:

- The anchor's `remoteLinks` (formal).
- Context external\_\* edges (formal).
- Description/body/comment ADF on the anchor and fetched entities (informal).
- Linked target ADF already present in full context responses:
  `relationships[].targets[].description.richText.adfValue.json`.

Scan ADF trees for `attrs.url`, `marks[type=link].attrs.href`, and bare-URL
`text` nodes. For graph and "who's involved" prompts, track which entity each
URL came from; provenance determines edge direction.

For workitem context graphs, inspect formal external edges first:
`jira_work_item_links_external_design`, `jira_work_item_links_external_pull_request`,
`jira_work_item_links_external_commit`, `jira_work_item_links_external_branch`,
`jira_work_item_links_page`, `jira_work_item_links_goal`, and
`jira_work_item_links_project`.

For page, topic, dependency, expert, people-map, or repo-routing prompts, search is
only the first step. Hydrate central anchors with context, then classify each
artifact as central, peripheral, dependency, owner/contributor evidence, or
unresolved candidate.

## Output Shape

- Anchor snapshot: what it is and why it matters.
- Relationship table: entity, type, direction, owner, importance, evidence.
- Risks and dependencies, with confirmed edges separated from inferred
  relationships.
- Suggested next actions.
- Confidence and gaps when evidence is incomplete, access-limited, stale, or
  sampled.

## Graph Visualization

When the user asks to visualize, draw, or open a graph, pipe a context command
straight into `twg visualize`. The visualize loader auto-detects the context
envelope shape and projects it to a graph spec — no hand-authored JSON.

```bash
# Preferred — context output flows directly into the viewer.
twg context jira workitem PROJ-123 -s hello -o json | twg visualize --open
twg context confluence page 12345 -s hello -o json | twg visualize --open
twg context user me -s hello -o json | twg visualize --open

# Equivalent: ask for the graph shape explicitly. Useful when emitting to a
# file for later inspection or for non-piped consumers.
twg context jira workitem PROJ-123 -s hello -o json --output-shape graph \
  > "$TMPDIR/graph.json"
twg visualize --in "$TMPDIR/graph.json" --open
```

Hand-author graph JSON **only** when the projection cannot produce what you
need (custom labels, synthesised summary nodes, hand-merged multi-anchor
graphs). When authoring, each node needs `id`, `displayName`, `nodeType`, and
`url` for clickable entities; each relationship needs `source`, `target`,
`label`. The CLI validates and reports missing fields.

Keep rendered graphs focused on directly relevant people, teams, and artifacts.
Summarize high-fanout membership lists instead of expanding every edge.
Third-party artifact nodes should carry the provider/product name in the label.
Never hand-roll graph HTML.

## Anti-Patterns

- Do not stop at search results without hydrating anchors.
- Do not treat `stdout_shape` as a complete entity or URL inventory.
- Do not skip peer expansion for graph/dependency prompts because peers look
  "Done".
- Do not dismiss a 1-hop candidate by title alone.
