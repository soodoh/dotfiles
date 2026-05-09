# Operations

Use this family for on-call handoffs, HOT/reliability reviews, incident/PIR
analysis, Assets/laptop refresh, capacity/staffing, and meeting recording
summaries.

## Triggers

- "I'm taking over on-call"
- "Reliability/HOT/incidents/PIR readout"
- "Laptop refresh candidates"
- "Windows laptops for testing"
- "Team capacity or staffing candidates"
- "Meeting recordings weekly summary"
- "Open risks, blockers, overloaded people, operational health"

## Plan

1. Resolve the operational scope: service/team/component/customer/project/person/org
   and time window.
2. Find the canonical anchors: service/component, HOT/incident/PIR issues, runbooks,
   projects/goals, meeting recordings, or asset object types.
3. Pull current state and recent history.
4. Join across surfaces only where it answers the operational question.
5. Rank by impact, urgency, owner clarity, recurrence risk, and actionability.

## Recipe Cards

### On-Call Handoff

Resolve team/service/component. Pull incidents/HOTs/PIRs, recent Jira follow-up,
runbooks/docs, linked projects, and owners. Cluster symptoms into patterns and
produce first-hour checklist plus escalation map.

### HOT / Reliability Review

Search/query HOTs, incidents, PIRs, linked follow-up work, service/component
context, owners, comments, and status. Cluster by failure theme. Connect each
theme to concrete follow-up and missing ownership.

### Assets / Laptop Refresh

First build the contributor list from project/goal/Jira/PR/doc/activity evidence.
Then query Assets schema/type metadata before AQL. Join people to laptops using
discovered user-like attributes such as `Calculated user` before broad name
filters. Rank by contribution centrality plus asset risk.

### Windows Asset Candidates

Use Assets schema-first discovery. Confirm site/schema/object type, then query
Windows laptops and owner/contact attributes. Report confidence and gaps for each
candidate.

### Capacity / Staffing Candidates

Resolve project/topic/org. Identify people with related recent work, ownership,
review influence, docs, and project/goal involvement. Also check current load
signals: assigned open work, review queue, stale blockers, and project risks.

### Meeting Recording Summary

Query meetings/videos for the requested time window and people scope. Fetch
transcript preview first; fetch full transcript only for central recordings and
write it to a file. Summarize decisions, action items, themes, and gaps where
recordings or transcripts are missing.

## Output Shape

- Lead with severity/urgency or recommendation summary.
- Provide inventory table with owner, status, recency, impact, and evidence.
- Group patterns/themes rather than listing artifacts independently.
- End with ranked next actions and who should own each.
- State data gaps: missing transcripts, no asset match, stale update, ACL/auth
  gaps, or weak ownership evidence.

## Anti-Patterns

- Do not fetch every transcript or page body.
- Do not treat every incident mention as a live risk.
- Do not join Assets by display-name guesses before inspecting schema/type fields.
- Do not recommend staffing solely from recent activity counts.
