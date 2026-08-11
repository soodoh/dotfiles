---
name: jira
description: >
  Create well-formed Jira work items in the OB/Onboarding project with the TWG
  CLI, assigned to the current user and placed in the active sprint. Use this
  skill whenever the user asks to create, file, open, or write a Jira ticket,
  bug, story, task, or enhancement for onboarding work, including requests based
  on current code changes or earlier conversation context. Also use it when an
  OB ticket must be associated with an epic or its Jira description must render
  cleanly in the web UI.
compatibility: Requires an authenticated `twg` CLI with access to Jira project OB.
---

# Jira Ticket Creation

Create one Jira work item in the `OB` / `Onboarding` project. Assign it to `me`,
place it in the current sprint, and associate it with the correct epic when the
user requests one.

## Operating principles

- Load and follow the root `twg` skill. Derive exact syntax from live
  `twg help` rather than assuming installed CLI flags.
- Treat the user's request to create/file/open a ticket as authorization to
  perform the mutation. Do not add a confirmation step once the ticket is clear.
- Read current state before writing. Resolve mutable values such as the active
  sprint and epic instead of relying on remembered IDs.
- Never create a ticket during an explicit dry run, preview, evaluation, or
  request to draft only. Return the proposed ticket and commands instead.
- Ask one focused question only when a material detail cannot be inferred safely.
  Do not ask for details that current conversation, local changes, or TWG can
  supply.

## 1. Build the ticket context

Use sources in this order:

1. The current prompt.
2. Relevant facts already established earlier in the session.
3. Local repository evidence when the user refers to "my changes", "this
   branch", or similar context. Inspect the working tree and diff without
   reverting or modifying anything. Use branch name, changed files, tests, and
   behavior—not raw diff noise—to explain the work.
4. A focused TWG lookup when the request refers to an existing Jira item, epic,
   PR, document, or work context.
5. A concise clarification when the desired outcome or acceptance boundary is
   still ambiguous.

Do not invent requirements, impact, test results, epic membership, or links.
Separate verified context from reasonable implementation notes.

## 2. Infer issue type and content

Choose the issue type from the work:

- `Bug` for incorrect existing behavior or a regression.
- `Story` for user-facing value with a meaningful outcome.
- `Enhancement` for an improvement to existing behavior.
- `Task` for engineering, operational, research, cleanup, or enablement work.

Honor an explicit type from the user. Verify that the type exists in OB using
`twg jira space get OB` or the current live help/data surface.

Write a concise, action-oriented summary. Write a self-contained description
with only the sections supported by known context:

```markdown
## Context
Why this work is needed and the relevant current behavior.

## Scope
What should change, including important boundaries.

## Acceptance criteria
- Observable, verifiable completion condition
- Additional completion condition

## Validation
Known tests or checks, or the checks expected during implementation.

## References
- [Descriptive label](https://example.com)
```

Prefer concrete behavior over implementation speculation. Omit empty sections.
For a bug, include reproduction, expected behavior, and actual behavior when
known. For current code changes, describe the intent and resulting behavior;
do not paste a commit log or giant file list.

## 3. Resolve Jira placement

Before creation, discover the current contracts and values:

1. Run focused help for `jira workitem create`, `jira workitem update`,
   `jira board query`, `jira board sprints query`, and
   `jira workitem field create-metadata` when their contracts are not already
   known in this invocation.
2. Verify project `OB` and find its Scrum board with
   `twg jira board query --project OB --type scrum`.
3. Query that board's active sprint using the live equivalent of
   `twg jira board sprints query --id <board-id> --current`.
4. Require exactly one applicable active sprint. If none or multiple are
   returned, stop and ask which sprint to use rather than guessing.
5. Discover create metadata for the inferred issue type:
   `twg jira workitem field create-metadata --space OB --type <type>`.
   Use returned `customfield_*` IDs for custom fields.

### Epic association

Only set an epic when the user asks for one or clearly identifies epic context.

- If given an epic key or URL, hydrate it and verify it is an `Epic` in project
  `OB`.
- If given an epic name or topic, query open OB epics with focused JQL, hydrate
  the best candidates, and match on meaning—not keyword overlap alone.
- If exactly one epic clearly fits, use it. If multiple plausible epics remain,
  ask the user to choose. If none fit, say so; never silently pick one.
- Use the epic/parent field advertised by create metadata. For this Jira setup it
  may be an `Epic Link` custom field; do not hardcode its ID. Use `--parent` only
  when live metadata/help confirms that it represents the requested epic
  relationship.

## 4. Create and format safely

Jira rich-text input must match the CLI's declared format. Prefer Markdown and
an explicit `--description-format markdown` whenever the live create/update
contract supports it. This lets Jira convert headings, lists, code, and links to
its rich-text document model instead of displaying markup literally.

If create does not support an explicit description format:

1. Create the item without the rich description (or with a minimal plain value
   only if description is required).
2. Immediately set the full description with
   `twg jira workitem update --description-format markdown`.

If Markdown is unavailable but the command explicitly accepts HTML, send real,
valid HTML matching the HTML format. Never send Markdown while the command is
using its default HTML mode, never send Jira wiki markup, and never escape HTML
into visible text such as `&lt;h2&gt;`.

Create in OB with the inferred type and `--assignee me`. Set the verified epic
field during creation when possible. Then update the created item with the
resolved active sprint using the canonical sprint flag advertised by live help.
Keep the issue key returned by create; do not infer it from project history.

Prefer argument-safe construction for multiline descriptions. A temporary file
or shell heredoc is acceptable when it avoids broken quoting, but do not leave
sensitive temporary content behind.

## 5. Verify and report

Read the created issue back with the fields needed to verify:

- project and issue type
- summary and description
- assignee
- sprint
- epic/parent when requested

If any post-create update fails, report the partial state and issue URL clearly;
do not create a replacement duplicate. Apply one focused correction when the
CLI provides a deterministic validation error.

Return a concise result containing the issue key, linked URL, summary, type,
assignee, active sprint, and epic when set. Mention any field that could not be
verified.
