---
name: planning-work
description: Use when turning a feature request, bugfix request, refactor, or project idea into an approved implementation plan and task DAG before autonomous subagent execution.
---

# Planning Work

Create an approved plan plus task DAG, then hand off to `implementation-work` through a fresh/minimal session boundary.

## Hard Requirements

- Subagents are required. If the current harness/session cannot dispatch subagents, stop and tell the user this workflow requires subagents.
- Explore the codebase before asking questions when an answer is discoverable locally.
- Ask exactly one focused question at a time.
- For every question, include your recommended answer.
- Persist the plan and DAG under `.agents/plans/` in the current project.
- Persist all planning support artifacts under `.agents/` too. Do not create root-level planning files like `report.md`, `progress.md`, `context.md`, or ad hoc subagent reports in the project root.
- Require an explicit approval phrase (`approved`, `approve`, or `ship it`) before implementation.
- After approval, create a fresh-session implementation handoff under `.agents/handoffs/`.
- Invoke `implementation-work` only from a fresh/minimal session context. If the harness cannot start or clear into a fresh context automatically, stop and give the user the handoff prompt to paste into a new session. Do not run implementation in the same conversation that produced the plan.

## Harness Adapters

| Operation                       | pi                                                                                                                                                              | Claude Code                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dispatch subagent               | Use `subagent(...)` with focused role prompts                                                                                                                   | Use the `Task` tool with focused role prompts                                                                                                    |
| List models                     | Prefer `pi --list-models` when available                                                                                                                        | Inspect available/current model information exposed by Claude Code; if unavailable, infer from visible/current model                             |
| Worktree planning               | Record whether git worktrees are available; implementation handles fallback                                                                                     | Same                                                                                                                                             |
| Planning artifacts              | Put subagent outputs/progress/context under `.agents/planning/<slug>/`                                                                                          | Put Task outputs/progress/context under `.agents/planning/<slug>/`                                                                               |
| Implementation session boundary | Start a new pi session or clear to a minimal context with only the handoff prompt when available; do not use a nested subagent for implementation orchestration | Use `/clear` or a new Claude Code session with only the handoff prompt when available; do not use a nested Task for implementation orchestration |
| Skill handoff                   | Load/activate `implementation-work` in the fresh/minimal session                                                                                                | Load/activate `implementation-work` in the fresh/minimal session                                                                                 |

Use generic wording in artifacts: role, model tier, dependencies, validation. Do not encode pi-only or Claude-only tool calls in the approved plan. Any harness-generated or subagent-generated planning files must be routed into `.agents/planning/<slug>/`, not the project root.

## Canonical Role Prompt Templates

Use the prompt templates in `prompts/` for planning subagent dispatches. These templates are the cross-harness source of truth; fill their placeholders from the user request and current planning artifact directory.

| Role             | Template                      | When to use                                                                           |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| Context gatherer | `prompts/context-gatherer.md` | Read-only request/scope, codebase pattern, or validation/risk context gathering       |
| DAG planner      | `prompts/dag-planner.md`      | Proposing a task DAG from gathered context before the parent writes the approved plan |

In Claude Code, paste the filled template into `Task`. In pi, pass the filled template as the `subagent(...)` task prompt. Do not improvise root-level artifact names; preserve the template's `.agents/planning/<slug>/` artifact boundary.

## Process

### 1. Establish Context with Subagents

Before dispatching context-gathering subagents, create a planning artifact directory: `.agents/planning/<slug>/`.

Dispatch read-only context-gathering subagents before interviewing the user. Use `prompts/context-gatherer.md` for each planning context subagent and route every subagent output, progress file, context file, report, and note into `.agents/planning/<slug>/`. Use explicit artifact paths in prompts/tool options such as:

- `.agents/planning/<slug>/request-scope-context.md`
- `.agents/planning/<slug>/codebase-patterns.md`
- `.agents/planning/<slug>/validation-risks.md`
- `.agents/planning/<slug>/progress.md`

Use focused prompts such as:

- Request/scope/context: what is being asked, likely affected areas, ambiguous requirements.
- Codebase patterns: relevant files, conventions, existing tests, architecture constraints.
- Validation/risk: test commands, risky areas, migration/rollback concerns.

Ask subagents for evidence-backed findings with file paths and remaining questions. Do not let planning subagents modify files. If a separate DAG proposal subagent is useful, use `prompts/dag-planner.md` and store its output under `.agents/planning/<slug>/`. If a harness defaults to root-level files like `report.md`, `progress.md`, or `context.md`, override the output path or move the artifact into `.agents/planning/<slug>/` immediately and delete the root-level copy.

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
- `## Planning Artifacts`: paths to `.agents/planning/<slug>/` context, progress, and subagent report files.
- `## Implementation Handoff`: path to `.agents/handoffs/<slug>-implementation.md` and instruction that implementation must run in a fresh/minimal session.
- `## Model Inventory and Tier Mapping`: table with tier, model(s), and reasoning.
- `## TDD and Verification Policy`: TDD-required tasks, approved non-TDD exceptions, verification hierarchy.
- `## Task DAG`: required Markdown table with columns `ID`, `Task/Chunk`, `Dependencies`, `Execution Mode`, `Suggested Model Tier`, `TDD?`, `Verification`, `Notes`.
- `## Optional DAG Diagram`: optional Mermaid diagram for readability.
- `## Parallelism and Worktree Plan`: parallel writer tasks require isolated git worktrees; if unavailable, implementation degrades those tasks to sequential execution.
- `## Risks and Rollback`
- `## Out-of-Scope Decision Triggers`: decisions that must stop execution and ask the user.
- `## Final Validation and Commit Policy`: auto-commit after final validation, exclude `.agents/` artifacts by default, infer commit message conventions, never add `Co-authored-by` trailers.
- `## Resume Notes`: implementation logs under `.agents/runs/` and resumes from the first incomplete DAG node.

### 5. Approval and Fresh-Session Handoff

Present the artifact path and a concise summary of plan + DAG. Ask for exactly one approval decision.

- If ambiguous: ask one clarification question.
- If rejected: revise the plan/DAG and repeat approval.
- If user explicitly says `approved`, `approve`, or `ship it`:
  1. Update `Approval Status` in the plan artifact.
  2. Create `.agents/handoffs/<slug>-implementation.md`.
  3. Include only the minimal context needed to start implementation: approved plan path, planning artifact directory, current branch/base SHA if known, explicit instruction to load `implementation-work`, and a reminder not to use the prior planning conversation as context.
  4. Start or clear into a fresh/minimal session if the harness provides that capability.
  5. If the harness cannot reset context automatically, stop and tell the user to open a new session or clear context, then paste/run the handoff prompt.

Do not continue directly into implementation inside the planning conversation. The approved artifact and handoff file are the context boundary.

## Red Flags

Stop before implementation if:

- No subagent mechanism is available.
- The working tree state, test infrastructure, or model availability invalidates the DAG and cannot be resolved in planning.
- A behavior-changing task lacks viable tests and the plan does not include either test infrastructure work or an explicit non-TDD exception.
- The user has not provided an explicit approval phrase.
