# Status Rollups

Use this family for personal, team, org, project, goal, focus-area, executive,
quarterly, and appraisal-style reports. These tasks ask for a synthesized readout,
not a raw activity dump.

## Contents

- Triggers
- Plan
- Recipe Cards
- Output Shape
- Anti-Patterns

## Triggers

- "What did I/person/team/org work on?"
- "Status of project/goal/topic/focus area"
- "Leadership readout"
- "Weekly/monthly/quarterly review"
- "APEX/performance appraisal evidence"
- "Goal alignment audit"
- "Org bottlenecks, priorities, stale goals, project risks"

## Plan

1. Use `twg help <terms>` to find commands for users, org-tree, teams, projects,
   goals, focus areas, work activity, search, and any evidence surfaces such as
   Jira, Confluence, docs, meetings, videos, or Bitbucket. Use
   `twg help describe <path>` for both command families and exact command
   contracts before unfamiliar commands where arguments, options, choices,
   defaults, or output guidance matter.
2. Resolve the reporting scope.
   - Person: use email/name/account ID, then user and context as needed.
   - Team: resolve team, then members.
   - Org: use org-tree with enough depth to reach useful manager/team groups.
   - Project/goal/focus area: resolve native key/ARI/name and latest updates.
   - Topic: resolve/search first, then pick concrete project/goal/page/workitem anchors.
3. Establish the time window. Default to the prompt; otherwise ask or use a small
   recent window such as 7d/30d depending on the report.
4. Pull planning state first for project/goal/org reports: owners, latest updates,
   status, target dates, linked goals/projects.
5. Fan out for evidence:
   - Jira work: assigned/authored/closed/blocked/open items.
   - Bitbucket: merged/authored/reviewed PRs when engineering output matters.
   - Confluence/docs: created/updated central pages.
   - Meetings/videos: only when decisions or action items matter.
   - Work query: use bounded time/person scopes, not as a blind org-wide first move.
6. Bucket by the user-requested structure: manager, team, workstream, RAG status,
   person, project, or risk.
7. Synthesize with confidence/gaps.

## Recipe Cards

### Person Or Personal Update

Resolve the person, then pull recent authored/assigned Jira work, authored/reviewed
PRs, docs/pages, meetings, and project/goal involvement. Distinguish authored work
from review, coordination, and influence.

Stop when the main activity types are represented or when the requested time window
is exhausted.

### Team Or Org Leadership Readout

Resolve org-tree first. For org prompts, prefer a depth that reaches managers or
nuclear teams rather than stopping at direct reports. For each manager/team group,
sample top workstreams and recent risks before per-person details.

Lead with cross-org themes, then manager/team rows. Include leadership attention
areas and evidence strength.

### Project Or Goal Status

Fetch the native project/goal first. Include owner, current state, latest update,
linked goals/projects, target dates, and status recency. Then hydrate only the Jira,
docs, PRs, or meetings that explain risk, progress, or dependency.

For goals, compare goal status with contributing project signals and call out
mismatches.

### Topic Status

Use resolve/search once to discover candidate anchors. Select 1-3 central anchors
such as an Atlas project, goal, page, or Jira epic/workitem. Hydrate those before
using broad work/activity queries.

### Appraisal / Performance Evidence

Resolve the person and time horizon. Separate evidence into authored delivery,
reviews, collaboration, docs/strategy, project/goal impact, and stakeholder
signals. Avoid ranking solely by counts.

## Output Shape

For leadership reports:

- Executive summary first, with 3-6 high-signal observations.
- Table with owner/team/workstream, positive signals, risk signals, current focus,
  confidence, and evidence.
- Risks and leadership attention ranked by impact and owner.
- Confidence and gaps, including stale updates or missing product coverage.

## Anti-Patterns

- Do not make a status report a list of every artifact.
- Do not infer goal/project health from issue counts alone.
- Do not fan out across every org member if manager/team-level grouping answers the
  prompt.
- Do not use search snippets as final evidence for status or risk.
