---
name: twg-workflows
description: >
  Outcome-oriented TWG recipes for multi-step Atlassian work tasks: status
  rollups, context discovery, engineering/PR work, and operational reviews. Use
  together with `twg` when the user asks for a synthesized answer rather than a
  single product-native lookup.
---

# twg-workflows

## Overview

Use this skill when the user wants an outcome: a leadership readout, weekly
update, dependency map, topic deep dive, review queue, on-call handoff,
reliability review, asset refresh plan, appraisal, staffing view, or action list.

This skill does not define command grammar. Load the root `twg` skill first and
discover exact commands with `twg help <terms>` before execution.

## Available scripts

- `twg` - run TWG with agent defaults.

## Recipe Families

| User intent | Reference |
| --- | --- |
| Personal/team/org/project/goal/focus-area status, executive readouts, appraisals | `references/STATUS-ROLLUPS.md` |
| Topic deep dives, workitem/page/user context, dependency maps, context graphs | `references/CONTEXT-DISCOVERY.md` |
| PR review queues, stale reviews, repo contributors, repo hot areas, PR-based status | `references/ENGINEERING-WORK.md` |
| On-call handoff, HOT/reliability review, assets/laptop refresh, capacity/staffing, meeting summaries | `references/OPERATIONS.md` |

Customer/account recipes are intentionally deferred. Until they are added, use
the closest matching family: `CONTEXT-DISCOVERY` for customer anchors and
`STATUS-ROLLUPS` for account readouts.

## Dispatch by Prompt Shape

| Prompt shape | Strategy | Default output |
| --- | --- | --- |
| Lookup, status, queue, "who's assigned" | Bounded: anchor + 1-2 hops | Text or table |
| Comprehensive, deep context, full picture, "catch me up" | Saturation expansion | Text + table |
| Graph, visualize, dependency map, "who's involved", experts | Saturation + peer/team expansion | `twg context ... -o json \| twg visualize --open` (auto-projects; see CONTEXT-DISCOVERY) |
| Mutation (change / update / transition / comment) | Read state, state intent, await confirmation unless explicitly authorized | Text |

## Execution Defaults

Resolve scope first. Use `twg help <terms>` for discovery and
`twg help describe <path>` for both command families and exact command contracts.
Fan out only after anchors are known, hydrate 1-3 central anchors plus 3-5 linked
artifacts by default, read `output_files.stdout` for large/context commands, and
separate facts from inference with confidence/gaps.

## Cross-Product Invariants

1. **Resolve scope first.** No broad search until anchored.
2. **Third-party URLs are first-class.** For any anchor-context prompt, collect
   the anchor's data, formal graph edges, AND third-party URLs (Figma, Google
   Doc, GitHub, Loom, partner doc, etc.). Third-party URLs are graph nodes equal
   in weight to formal edges.
3. **Saturation stop.** Expand until the next candidate would yield no new
   entities, links, contributors, or teams. Counts are not the stop signal;
   yield is.
4. **Parallelize fan-out.** Same-kind fetches (peers, pages, teams) go in one
   batch, not sequentially.
5. **Verify within 1 hop.** Fetch body/description before dismissing any
   candidate within 1 hop of the anchor. Cite peripheral candidates by title.
6. **Read full stdout when entities matter.** YAML `stdout_shape` answers size
   and structure questions only; `output_files.stdout` answers everything else.
7. **State-before-mutate.** Read current state before any write.
8. **Cite contracts.** When unsure, run `twg help describe <path>`.

## Tool Gaps

CLI-side gaps the skill currently compensates for. These are bugs to fix in the
CLI, not rules for agents to memorize:

- Context commands do not yet emit per-target `embeddedUrls[]` on every surface.
  Prefer emitted `embeddedUrls[]` when present; when absent, scan fetched entity
  ADF for `attrs.url`, `marks[type=link].attrs.href`, and bare-URL `text` nodes.
- `stdout_shape` can truncate relationship tails, where external links often
  appear. Until summaries expose this safely, read `output_files.stdout` for
  graph/context answers.
- Team affiliation is not returned in the context graph for non-assigned users.
  Until it is, resolve team affiliation separately for graph and experts prompts.

When fixed, delete the corresponding compensation.

## References

- `references/STATUS-ROLLUPS.md`
- `references/CONTEXT-DISCOVERY.md`
- `references/ENGINEERING-WORK.md`
- `references/OPERATIONS.md`
