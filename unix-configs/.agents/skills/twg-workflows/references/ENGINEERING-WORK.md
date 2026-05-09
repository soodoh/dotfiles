# Engineering Work

Use this family for PR/repo/review workflows: review queues, stale reviews, repo
contributors, repo hot areas, PR-based status, issue-to-PR lookups, and review
bottleneck analysis.

## Triggers

- "Which PRs are waiting for my review?"
- "Latest PRs for this issue"
- "Who contributed most to this repo/topic?"
- "Repos I created PRs in"
- "Stale reviews"
- "Review flow or bottlenecks"
- "PR-only leadership readout"
- "Open bugs/tasks with PRs in flight"

## Plan

1. Use `twg help <terms>` to find Bitbucket, Jira, context, and search command
   paths. Use `twg help describe <path>` for both command families and exact
   command contracts before unfamiliar commands where arguments, options,
   choices, defaults, or output guidance matter. Do not assume old aliases.
2. Resolve workspace/repo/PR/workitem/topic.
   - Repo prompt: find workspace and repo from URL, local checkout, or repo query.
   - Workitem prompt: fetch/context Jira workitem to discover linked PRs.
   - Topic prompt: resolve/search topic, then find linked repos/PRs/workitems.
3. Query, then hydrate selected PRs.
   - Use query/search for queue or candidate list.
   - Fetch PR details/comments/tasks/diff only for stale, blocked, central, or
     high-impact PRs.
4. For review status, include age, requested reviewers, comments/tasks, approval
   state, CI/pipeline status, and last activity.
5. For repo/team reports, group by repo/service/workstream, not just person counts.
6. For PR-based rollups, inspect PR titles/descriptions and linked issues to infer
   themes; do not rank solely by PR count.

## Recipe Cards

### Review Queue

Query reviewer-scoped open PRs. Sort by waiting time, requested action, unresolved
tasks/comments, failing CI, and project relevance. Hydrate only PRs needing action.

### Stale Reviews / Review Bottlenecks

Find PRs open or waiting beyond the threshold. Group by repo, author, reviewer,
and stage. Identify bottleneck patterns: missing reviewer, unresolved tasks,
failing CI, repeated request-changes, or owner unavailable.

### Issue PRs

Use workitem context to find linked PRs, commits, branches, and repos. Fetch PRs
only if the user asks for details, status, or next action.

### Repo Contributors / Hot Areas

Query PRs/commits for the repo and time window. Group by files/areas, authors,
reviewers, and themes. For "hot areas", prioritize changed area plus frequency
and ownership signals.

### PR-Based Status Rollup

Resolve org/team first, then collect merged PRs for members or repos in the time
window. Group PRs into themes and repos/services. Include substantial contributors
and cross-team dependencies, but call out gaps where PR-only evidence omits Jira,
docs, or planning context.

## Output Shape

- Queue/action tasks: table with PR, repo, owner, state, why it needs attention,
  next action, evidence.
- Engineering reports: executive summary, repo/workstream table, contributors,
  review bottlenecks, risks/gaps.
- Always include URLs or stable IDs for the key artifacts.

## Anti-Patterns

- Do not guess Bitbucket workspace/repo.
- Do not fetch every PR body/diff/comments in a large queue.
- Do not treat PR counts as impact.
- Do not mix Bitbucket auth failures with Atlassian auth; report them separately.
