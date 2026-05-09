# Products And Surfaces

This reference explains durable product concepts and common routing traps. Use
`twg help` for exact command syntax.

## Discovery Surfaces

- `resolve` is for IDs, URLs, keys, exact names, and canonical entity lookup.
- `search` / `rovo search` is for fuzzy topics, nicknames, partial titles, and
  cross-product discovery.
- Product-native commands are for final evidence, exact filters, mutations,
  comments, page bodies, PR diffs, and product-specific semantics.
- `context` commands are for explicit graph relationships around a known entity.
  They do not replace native `get` commands for source fields.

Use search results as candidates, not final facts. Hydrate important hits with
native or context commands before synthesis.

## Product Mental Model

| Product | Durable guidance |
| --- | --- |
| Jira | "Workitem" and "issue" mean the same thing. Use Jira for issue fields, comments, transitions, links, boards, sprints, and Jira project spaces. |
| JSM | Use JSM for service-management concepts: services, incidents, queues, portals, request types, SLAs, and knowledge. If the user wants the underlying issue record, use Jira workitem commands. |
| Confluence | Use search/Rovo for fuzzy page discovery, then page get by ID/URL. Fetch full body only for central pages. Tasks are separate from pages and comments. |
| Bitbucket | Most PR/repo operations require workspace and repo. Resolve them from URLs, local checkout, search results, or prior output. Do not guess slugs. |
| Atlas projects | Cross-team initiatives with owners, contributors, status updates, linked goals, risks, and target dates. Do not confuse them with Jira projects/spaces. |
| Atlas goals | OKRs/key results with owners, health/status, updates, and contributing projects. Goal status should be compared to linked project signals. |
| Focus areas | Planning hierarchy. Tree/count options can be expensive; use status/scope/depth deliberately. |
| Assets | Schema-first. Object type names, schema names, and attributes are site-specific. Inspect schemas/types before writing AQL filters. |
| People/teams | Account IDs are required for many user-scoped commands. Resolve by email/name; use org-tree for reporting structure and teams for team membership. |
| Meetings/videos/docs | Discovery can be broad and slow. Query with time windows and people filters; fetch full transcripts only for selected recordings. |

## Cross-Product Search Rules

- Start with `resolve --query "<input>"` when the input could already be a URL,
  key, exact entity name, or account/person identifier.
- If resolve is weak, use `search "<query>" --limit 20` or app/type filters from
  live help.
- For sensitive or people-heavy searches, narrow by app, type, time window,
  contributor, assignee, owner, or space when available.
- Hydrate 1-3 top candidates. Avoid treating snippets as authoritative.

## Context And Graph Rules

For a known entity, pair source fetch and graph context:

| Entity | Source fields | Graph context |
| --- | --- | --- |
| Jira workitem | native Jira workitem get | context Jira workitem |
| Confluence page | native Confluence page get | context Confluence page |
| User | user lookup / org-tree | context user |
| Atlas project/goal | native project/goal get | search/context where supported |

Default to summary detail. Escalate to full detail only for the central artifact.
When drawing a graph, produce validated graph JSON and use the TWG visualization
command discovered from help.

## Mutation Safety

- Read current state before updating, linking, unlinking, commenting, or deleting.
- Resolve both source and target to stable IDs/ARIs/keys before relationship writes.
- Use `--body-file` for multiline page/comment bodies.
- For relationship mutations, report the source, target, relationship type, and
  resulting key/URL.
- Do not mutate if the source entity identity is ambiguous.

## Operational Caveats

- Bitbucket auth can fail independently of Atlassian/Jira auth.
- Some graph/context endpoints can be ACL-sensitive or slower than product-native
  reads. Fall back to native surfaces when graph hydration fails.
- Recently viewed data is current-user scoped and time-limited.
- Meeting recordings and transcripts are not guaranteed to exist for every meeting.
- Assets joins often fail because of wrong schema/type/attribute assumptions; inspect
  the schema first.
