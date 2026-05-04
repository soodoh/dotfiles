---
name: planning-work
description: Use when turning a feature request, bugfix request, refactor, or project idea into an approved implementation plan and task DAG, then routing it to the appropriate implementation skill based on complexity.
---

# Planning Work

Create an approved plan plus task DAG, classify implementation complexity, then hand off to the appropriate implementation skill through a fresh/minimal session boundary.

## Implementation Skill Routing

Planning owns complexity assessment. Implementation skills execute the approved DAG and must not re-plan the feature.

| Complexity / mode | Route to                    | Use when                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `quick-batch`     | `quick-implementation-work` | Low-to-medium risk work with a small or moderate DAG, clear requirements, limited files, no major architectural/migration/security decisions, and changes that can be reviewed as one whole change after all DAG tasks finish. Parallel writer tasks may share the current checkout when independent; isolated worktrees are not required. |
| `deep-gated`      | `implementation-work`       | Complex, high-risk, ambiguous, architectural, migration/security-sensitive, broad, or regression-prone work; anything needing per-task review gates, strict worktree isolation for parallel writers, or investigation checkpoints between tasks.                                                                                           |

Recommended default: choose `quick-batch` only when the codebase evidence and user answers make the scope clear and failure blast radius low. Otherwise choose `deep-gated`.

## Hard Requirements

- Subagents are required. If the current harness/session cannot dispatch subagents, stop and tell the user this workflow requires subagents.
- Explore the codebase before asking questions when an answer is discoverable locally.
- Ask exactly one focused question at a time.
- For every question, include your recommended answer.
- Assess complexity before finalizing the plan. Record the selected implementation skill and rationale in the plan artifact.
- Persist the plan and DAG under `.agents/plans/` in the current project.
- Persist all planning support artifacts under `.agents/` too. Do not create root-level planning files like `report.md`, `progress.md`, `context.md`, or ad hoc subagent reports in the project root.
- Require an explicit approval phrase (`approved`, `approve`, or `ship it`) before implementation.
- After approval, create a fresh-session implementation handoff under `.agents/handoffs/` that names the selected implementation skill.
- Invoke the selected implementation skill only from a fresh/minimal session context. If the harness cannot start or clear into a fresh context automatically, stop and give the user the handoff prompt to paste into a new session. Do not run implementation in the same conversation that produced the plan.

## Harness Adapters

| Operation                       | pi                                                                                                                                                              | Claude Code                                                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dispatch subagent               | Use `subagent(...)` with focused role prompts                                                                                                                   | Use the `Task` tool with focused role prompts                                                                                                    |
| List models                     | Prefer `pi --list-models` when available                                                                                                                        | Inspect available/current model information exposed by Claude Code; if unavailable, infer from visible/current model                             |
| Worktree planning               | Record whether git worktrees are available and whether the selected implementer requires them                                                                   | Same                                                                                                                                             |
| Planning artifacts              | Put subagent outputs/progress/context under `.agents/planning/<slug>/`                                                                                          | Put Task outputs/progress/context under `.agents/planning/<slug>/`                                                                               |
| Implementation session boundary | Start a new pi session or clear to a minimal context with only the handoff prompt when available; do not use a nested subagent for implementation orchestration | Use `/clear` or a new Claude Code session with only the handoff prompt when available; do not use a nested Task for implementation orchestration |
| Skill handoff                   | Load/activate `quick-implementation-work` or `implementation-work`, according to the approved complexity route                                                  | Load/activate `quick-implementation-work` or `implementation-work`, according to the approved complexity route                                   |

Use generic wording in artifacts: role, model tier, dependencies, validation. Do not encode pi-only or Claude-only tool calls in the approved plan. Any harness-generated or subagent-generated planning files must be routed into `.agents/planning/<slug>/`, not the project root.

## Canonical Role Prompt Templates

Use the prompt templates in `prompts/` for planning subagent dispatches. These templates are the cross-harness source of truth; fill their placeholders from the user request and current planning artifact directory.

| Role             | Template                      | When to use                                                                                                                       |
| ---------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Context gatherer | `prompts/context-gatherer.md` | Read-only request/scope, codebase pattern, validation/risk, or complexity evidence gathering                                      |
| DAG planner      | `prompts/dag-planner.md`      | Proposing a task DAG, implementation mode, and parallelism shape from gathered context before the parent writes the approved plan |

In Claude Code, paste the filled template into `Task`. In pi, pass the filled template as the `subagent(...)` task prompt. Do not improvise root-level artifact names; preserve the template's `.agents/planning/<slug>/` artifact boundary.

## Process

### 1. Establish Context with Subagents

Before dispatching context-gathering subagents, create a planning artifact directory: `.agents/planning/<slug>/`.

Dispatch read-only context-gathering subagents before interviewing the user. Use `prompts/context-gatherer.md` for each planning context subagent and route every subagent output, progress file, context file, report, and note into `.agents/planning/<slug>/`. Use explicit artifact paths in prompts/tool options such as:

- `.agents/planning/<slug>/request-scope-context.md`
- `.agents/planning/<slug>/codebase-patterns.md`
- `.agents/planning/<slug>/validation-risks.md`
- `.agents/planning/<slug>/complexity-routing.md`
- `.agents/planning/<slug>/progress.md`

Use focused prompts such as:

- Request/scope/context: what is being asked, likely affected areas, ambiguous requirements.
- Codebase patterns: relevant files, conventions, existing tests, architecture constraints.
- Validation/risk: test commands, risky areas, migration/rollback concerns.
- Complexity/routing: likely DAG size, blast radius, whether per-task gates/worktrees are needed, and whether whole-change review after all tasks is sufficient.

Ask subagents for evidence-backed findings with file paths and remaining questions. Do not let planning subagents modify files. If a separate DAG proposal subagent is useful, use `prompts/dag-planner.md` and store its output under `.agents/planning/<slug>/`. If a harness defaults to root-level files like `report.md`, `progress.md`, or `context.md`, override the output path or move the artifact into `.agents/planning/<slug>/` immediately and delete the root-level copy.

### 2. Infer Model Tiers

Discover currently available models when possible and infer tiers from names:

- **cheap/fast:** names with `mini`, `haiku`, `flash`, `lite`, `small`, `spark`, `fast`.
- **standard:** capable general coding models without cheap/strongest signals.
- **strongest:** names with `opus`, `max`, `pro`, `ultra`, highest visible version, largest context/reasoning, or clearly most capable provider option.

If names are ambiguous or only one model is available, use the current/default model for all tiers. Record the inventory and inferred tier mapping in the plan artifact.

### 3. Assess Complexity and Select the Implementer

Assess complexity after initial codebase exploration and before asking for plan approval. Reassess if user answers change the scope.

Use `quick-batch` when all or nearly all are true:

- Requirements and acceptance criteria are clear.
- Change has low-to-medium blast radius and limited integration risk.
- DAG tasks are independent or can be executed safely in the same checkout without worktree isolation.
- A single whole-change review loop after all tasks complete is sufficient.
- No unapproved architecture, migration, destructive, privacy/security-sensitive, or product decision is expected during implementation.
- TDD requirements are straightforward, or any non-TDD exception is explicit and low risk.

Use `deep-gated` when any are true:

- Ambiguous requirements remain after reasonable investigation.
- The DAG has high-risk dependencies or broad cross-cutting changes.
- Parallel writers need isolated worktrees to avoid conflicts or protect the main checkout.
- Per-task spec/code-quality review gates are needed before later tasks proceed.
- The work involves migrations, security/privacy boundaries, architecture choices, critical regressions, data loss risk, or hard-to-revert behavior.
- Investigation checkpoints are likely during execution.

Record in the plan:

- selected mode: `quick-batch` or `deep-gated`
- selected skill: `quick-implementation-work` or `implementation-work`
- evidence/rationale
- why the other route was not selected
- whether parallel tasks can share the checkout or require worktrees

### 4. Grill One Decision at a Time

Use this loop until shared understanding is reached:

1. If codebase exploration can answer the next question, explore instead of asking.
2. Ask one focused question.
3. Provide your recommended answer.
4. Incorporate the answer into the plan draft.
5. Walk the next dependent branch of the decision tree.

Resolve at least: scope, non-goals, acceptance criteria, constraints, TDD applicability/exceptions, validation, risks, data/schema changes, rollout/rollback, task dependencies, implementation mode, and parallelism/worktree needs.

### 5. Write the Plan + DAG Artifact

Create `.agents/plans/<slug>.md` with these required sections:

- `# <Plan Title>`
- `## Approval Status`: status (`pending` or `approved`), approval phrase, approval timestamp.
- `## Goal`
- `## Scope`
- `## Non-Goals`
- `## Acceptance Criteria`
- `## Constraints and Project Instructions`
- `## Planning Artifacts`: paths to `.agents/planning/<slug>/` context, progress, and subagent report files.
- `## Complexity Assessment and Implementation Route`: mode, selected skill, rationale, rejected route, parallelism/worktree expectations.
- `## Implementation Handoff`: path to `.agents/handoffs/<slug>-implementation.md` and instruction that implementation must run in a fresh/minimal session using the selected skill.
- `## Model Inventory and Tier Mapping`: table with tier, model(s), and reasoning.
- `## TDD and Verification Policy`: TDD-required tasks, approved non-TDD exceptions, verification hierarchy.
- `## Task DAG`: required Markdown table with columns `ID`, `Task/Chunk`, `Dependencies`, `Execution Mode`, `Suggested Model Tier`, `TDD?`, `Verification`, `Notes`.
- `## Optional DAG Diagram`: optional Mermaid diagram for readability.
- `## Parallelism and Worktree Plan`: for `quick-batch`, parallel tasks may share the checkout only when independent/non-overlapping; for `deep-gated`, parallel writer tasks require isolated git worktrees and implementation degrades to sequential if unavailable.
- `## Risks and Rollback`
- `## Out-of-Scope Decision Triggers`: decisions that must stop execution and ask the user.
- `## Final Validation and Commit Policy`: auto-commit after final validation, exclude `.agents/` artifacts by default, infer commit message conventions, never add `Co-authored-by` trailers.
- `## Resume Notes`: implementation logs under `.agents/runs/` and resumes from the first incomplete DAG node or whole-change review loop, depending on selected skill.

### 6. Approval and Fresh-Session Handoff

Present the artifact path and a concise summary of plan + DAG + selected implementation route. Ask for exactly one approval decision.

- If ambiguous: ask one clarification question.
- If rejected: revise the plan/DAG/routing and repeat approval.
- If user explicitly says `approved`, `approve`, or `ship it`:
  1. Update `Approval Status` in the plan artifact.
  2. Create `.agents/handoffs/<slug>-implementation.md`.
  3. Include only the minimal context needed to start implementation: approved plan path, planning artifact directory, selected implementation skill, selected mode, current branch/base SHA if known, explicit instruction to load the selected skill, and a reminder not to use the prior planning conversation as context.
  4. Start or clear into a fresh/minimal session if the harness provides that capability.
  5. If the harness cannot reset context automatically, stop and tell the user to open a new session or clear context, then paste/run the handoff prompt.

Do not continue directly into implementation inside the planning conversation. The approved artifact and handoff file are the context boundary.

## Red Flags

Stop before implementation if:

- No subagent mechanism is available.
- The working tree state, test infrastructure, model availability, or selected route invalidates the DAG and cannot be resolved in planning.
- A behavior-changing task lacks viable tests and the plan does not include either test infrastructure work or an explicit non-TDD exception.
- The user has not provided an explicit approval phrase.
- The selected `quick-batch` route includes parallel tasks that are not demonstrably independent and the plan does not degrade them to sequential execution.
