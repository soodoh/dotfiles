---
name: planning-work
description: Use when turning a feature request, bugfix request, refactor, or project idea into an approved implementation plan and task DAG before autonomous subagent execution.
---

# Planning Work

Create an approved plan plus task DAG, then hand off automatically to `implementation-work`.

This skill is cross-harness: it must work in pi and Claude Code. Do **not** rely on Superpowers, Ralph Wiggum, or any harness-specific workflow extension.

## Hard Requirements

- Subagents are required. If the current harness/session cannot dispatch subagents, stop and tell the user this workflow requires subagents.
- Explore the codebase before asking questions when an answer is discoverable locally.
- Ask exactly one focused question at a time.
- For every question, include your recommended answer.
- Persist the plan and DAG under `.agents/plans/` in the current project.
- Require an explicit approval phrase (`approved`, `approve`, or `ship it`) before implementation.
- After approval, immediately activate/load `implementation-work` and pass it the approved plan artifact path.

## Harness Adapters

| Operation         | pi                                                                          | Claude Code                                                                                                          |
| ----------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Dispatch subagent | Use `subagent(...)` with focused role prompts                               | Use the `Task` tool with focused role prompts                                                                        |
| List models       | Prefer `pi --list-models` when available                                    | Inspect available/current model information exposed by Claude Code; if unavailable, infer from visible/current model |
| Worktree planning | Record whether git worktrees are available; implementation handles fallback | Same                                                                                                                 |
| Skill handoff     | Load/activate `implementation-work` after approval                          | Load/activate `implementation-work` after approval                                                                   |

Use generic wording in artifacts: role, model tier, dependencies, validation. Do not encode pi-only or Claude-only tool calls in the approved plan.

## Process

### 1. Establish Context with Subagents

Dispatch read-only context-gathering subagents before interviewing the user. Use focused prompts such as:

- Request/scope/context: what is being asked, likely affected areas, ambiguous requirements.
- Codebase patterns: relevant files, conventions, existing tests, architecture constraints.
- Validation/risk: test commands, risky areas, migration/rollback concerns.

Ask subagents for evidence-backed findings with file paths and remaining questions. Do not let planning subagents modify files.

### 2. Infer Model Tiers

Discover currently available models when possible and infer tiers from names:

- **cheap/fast:** names with `mini`, `haiku`, `flash`, `lite`, `small`, `spark`, `fast`.
- **standard:** capable general coding models without cheap/strongest signals.
- **strongest:** names with `opus`, `max`, `pro`, `ultra`, highest visible version, largest context/reasoning, or clearly most capable provider option.

If names are ambiguous or only one model is available, use the current/default model for all tiers. Record the inventory and inferred tier mapping in the plan artifact.

### 3. Grill One Decision at a Time

Use this loop until shared understanding is reached:

1. If codebase exploration can answer the next question, explore instead of asking.
2. Ask one focused question.
3. Provide your recommended answer.
4. Incorporate the answer into the plan draft.
5. Walk the next dependent branch of the decision tree.

Resolve at least: scope, non-goals, acceptance criteria, constraints, TDD applicability/exceptions, validation, risks, data/schema changes, rollout/rollback, and task dependencies.

### 4. Write the Plan + DAG Artifact

Create `.agents/plans/<slug>.md` with these required sections:

- `# <Plan Title>`
- `## Approval Status`: status (`pending` or `approved`), approval phrase, approval timestamp.
- `## Goal`
- `## Scope`
- `## Non-Goals`
- `## Acceptance Criteria`
- `## Constraints and Project Instructions`
- `## Model Inventory and Tier Mapping`: table with tier, model(s), and reasoning.
- `## TDD and Verification Policy`: TDD-required tasks, approved non-TDD exceptions, verification hierarchy.
- `## Task DAG`: required Markdown table with columns `ID`, `Task/Chunk`, `Dependencies`, `Execution Mode`, `Suggested Model Tier`, `TDD?`, `Verification`, `Notes`.
- `## Optional DAG Diagram`: optional Mermaid diagram for readability.
- `## Parallelism and Worktree Plan`: parallel writer tasks require isolated git worktrees; if unavailable, implementation degrades those tasks to sequential execution.
- `## Risks and Rollback`
- `## Out-of-Scope Decision Triggers`: decisions that must stop execution and ask the user.
- `## Final Validation and Commit Policy`: auto-commit after final validation, exclude `.agents/` artifacts by default, infer commit message conventions, never add `Co-authored-by` trailers.
- `## Resume Notes`: implementation logs under `.agents/runs/` and resumes from the first incomplete DAG node.

### 5. Approval

Present the artifact path and a concise summary of plan + DAG. Ask for exactly one approval decision.

- If user explicitly says `approved`, `approve`, or `ship it`: update `Approval Status` in the artifact, then immediately invoke `implementation-work` with the artifact path.
- If ambiguous: ask one clarification question.
- If rejected: revise the plan/DAG and repeat approval.

## Red Flags

Stop before implementation if:

- No subagent mechanism is available.
- The working tree state, test infrastructure, or model availability invalidates the DAG and cannot be resolved in planning.
- A behavior-changing task lacks viable tests and the plan does not include either test infrastructure work or an explicit non-TDD exception.
- The user has not provided an explicit approval phrase.
