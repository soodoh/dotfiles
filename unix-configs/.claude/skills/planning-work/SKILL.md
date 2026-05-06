---
name: planning-work
description: >-
  Use in Claude Code when turning a feature request, bugfix request, refactor, or project idea into an approved implementation plan and task DAG, then routing it to the appropriate implementation skill based on complexity. This skill must not implement changes itself: even simple, one-file, or obvious tasks still require an approved plan and fresh-session handoff to `quick-implementation-work` or `implementation-work` so reviewer/validation gates run.
---

# Planning Work

Create an approved plan plus task DAG, classify implementation complexity, then hand off to the appropriate implementation skill through a fresh/minimal session boundary.

Planning is not an implementation mode. Its job is to preserve the Claude Code workflow boundary that guarantees Task execution, review, validation, and final commit discipline.

If invoked from a standalone `investigation-work` planning seed, treat the seed as evidence input, not as an approved implementation plan. Read the referenced investigation notes, preserve their findings in planning artifacts, then produce a normal pending plan/DAG that still requires explicit user approval before implementation.

## Implementation Skill Routing

Planning owns complexity assessment. Implementation skills execute the approved DAG and must not re-plan the feature.

There is no direct or inline implementation route from this skill. The smallest safe route is `quick-batch` → `quick-implementation-work`; the stricter route is `deep-gated` → `implementation-work`. If the task feels too small for deep gating, select `quick-batch` and keep the plan lightweight rather than implementing it yourself.

| Complexity / mode | Route to                    | Use when                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `quick-batch`     | `quick-implementation-work` | Low-to-medium risk work with a small or moderate DAG, including simple one-file or obvious fixes, when requirements are clear, affected files are limited, no major architectural/migration/security decisions are needed, and changes can be reviewed as one whole change after all DAG tasks finish. Parallel writer tasks may share the current checkout when independent; isolated worktrees are not required. |
| `deep-gated`      | `implementation-work`       | Complex, high-risk, ambiguous, architectural, migration/security-sensitive, broad, or regression-prone work; anything needing per-task review gates, strict worktree isolation for parallel writers, or investigation checkpoints between tasks.                                                                                                                                                                   |

Recommended default: choose `quick-batch` only when the codebase evidence and user answers make the scope clear and failure blast radius low. Otherwise choose `deep-gated`.

## Hard Requirements

- Claude Code's `Task` tool is required for planning Tasks. If this Claude Code session cannot dispatch Tasks, stop and tell the user this workflow requires Claude Code Tasks.
- Do not implement the requested product/test/docs changes from the planning conversation, even when the task is trivial. Before approval, only gather evidence and write `.agents/` planning artifacts. After approval, only update approval metadata and create the `.agents/handoffs/` file, then hand off to the selected implementation skill.
- Explore the codebase before asking questions when an answer is discoverable locally.
- Accept `.agents/planning/<slug>/investigation-seed.md` from standalone `investigation-work` as starting evidence, but do not treat it as approval or as permission to implement.
- Use Claude Code's user-facing response for exactly one focused question or approval decision at a time.
- For every question, include your recommended answer.
- Use `TodoWrite` for planning progress tracking when it is available.
- Assess complexity before finalizing the plan. Record an unambiguous selected mode and selected implementation skill in the plan artifact; if mode and skill would conflict, resolve that before asking for approval.
- Persist the plan and DAG under `.agents/plans/` in the current project.
- Persist all planning support artifacts under `.agents/` too. Do not create root-level planning files like `report.md`, `progress.md`, `context.md`, or ad hoc Task reports in the project root.
- Require an explicit approval phrase (`approved`, `approve`, or `ship it`) before implementation.
- After approval, create a fresh-session implementation handoff under `.agents/handoffs/` that names the selected implementation skill.
- Invoke the selected implementation skill only from a fresh/minimal Claude Code session context. Prefer `/clear` or a new Claude Code session containing only the handoff prompt and approved artifacts. Do not run implementation in the same conversation that produced the plan.

## Claude Code Runtime Rules

- Dispatch planning helpers with the Claude Code `Task` tool, using focused role prompts and explicit artifact paths.
- Inspect available/current model information exposed by Claude Code when model inventory is needed; if unavailable, infer tiers from the visible/current model.
- Put every Task output, progress file, context file, report, and note under `.agents/planning/<slug>/`.
- Do not use a nested Task for implementation orchestration. The selected implementation skill must run as the parent in a fresh/minimal Claude Code session.
- Use `TodoWrite` for parent progress tracking when available.

Keep approved artifacts focused on workflow facts future readers need: record role, model tier, dependencies, validation, and route decisions. Keep Claude Code-specific tool calls in workflow instructions and run logs rather than encoding them as requirements for implementation code. Any Claude Code Task-generated planning files must be routed into `.agents/planning/<slug>/`, not the project root.

## Canonical Role Prompt Templates

Use the prompt templates in `prompts/` for Claude Code planning Task dispatches. These templates are the source of truth for Claude Code planning roles; fill their placeholders from the user request and current planning artifact directory.

| Role             | Template                      | When to use                                                                                                                       |
| ---------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Context gatherer | `prompts/context-gatherer.md` | Read-only request/scope, codebase pattern, validation/risk, or complexity evidence gathering                                      |
| DAG planner      | `prompts/dag-planner.md`      | Proposing a task DAG, implementation mode, and parallelism shape from gathered context before the parent writes the approved plan |

Paste the filled template into the Claude Code `Task` tool. Do not improvise root-level artifact names; preserve the template's `.agents/planning/<slug>/` artifact boundary.

## Process

### Small-Task Fast Path

For simple or low-risk requests, keep planning proportional but do not skip the workflow:

1. Do enough local and Task-based context gathering to confirm scope, affected files, validation, and low-risk status.
2. Draft a compact `.agents/plans/<slug>.md` with a small DAG, often one task.
3. Select `quick-batch` / `quick-implementation-work` unless evidence shows deep gates are needed.
4. Ask for explicit approval.
5. After approval, create the implementation handoff and stop or start a fresh/minimal session with `quick-implementation-work`.

Do not replace this fast path with inline edits. The quick implementation skill exists specifically to keep simple work fast while still enforcing whole-change review, validation, and commit discipline.

### 1. Establish Context with Claude Code Tasks

Before dispatching context-gathering Tasks, create a planning artifact directory: `.agents/planning/<slug>/`. If a standalone investigation seed already exists at `.agents/planning/<slug>/investigation-seed.md`, reuse that directory, read the seed and referenced investigation note first, and record them under `## Planning Artifacts` in the final plan.

Dispatch read-only context-gathering Tasks before interviewing the user. Use `prompts/context-gatherer.md` for each planning context Task and route every Task output, progress file, context file, report, and note into `.agents/planning/<slug>/`. Include explicit artifact paths in Task prompts such as:

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

Ask Tasks for evidence-backed findings with file paths and remaining questions. Do not let planning Tasks modify files. If a separate DAG proposal Task is useful, use `prompts/dag-planner.md` and store its output under `.agents/planning/<slug>/`. If a Claude Code Task writes root-level files like `report.md`, `progress.md`, or `context.md`, move the artifact into `.agents/planning/<slug>/` immediately and delete the root-level copy.

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
2. If no user-only decisions remain after local exploration, skip further questions and proceed to draft/approval.
3. When a question is needed, ask exactly one focused question.
4. Provide your recommended answer.
5. Incorporate the answer into the plan draft.
6. Walk the next dependent branch of the decision tree.

Resolve at least: scope, non-goals, acceptance criteria, constraints, TDD applicability/exceptions, validation, risks, data/schema changes, rollout/rollback, task dependencies, implementation mode, and parallelism/worktree needs. Do not ask questions merely to satisfy this checklist when the answer is already supported by local evidence.

### 5. Write the Plan + DAG Artifact

Create `.agents/plans/<slug>.md` with these required sections:

- `# <Plan Title>`
- `## Approval Status`: status (`pending` or `approved`), approval phrase, approval timestamp. Pending plans use `none`/blank phrase and timestamp; approved plans must record the explicit phrase (`approved`, `approve`, or `ship it`) and timestamp.
- `## Goal`
- `## Scope`
- `## Non-Goals`
- `## Acceptance Criteria`
- `## Constraints and Project Instructions`
- `## Planning Artifacts`: paths to `.agents/planning/<slug>/` context, progress, and Task report files.
- `## Complexity Assessment and Implementation Route`: selected mode (`quick-batch` or `deep-gated`), selected skill (`quick-implementation-work` or `implementation-work`), rationale, rejected route, parallelism/worktree expectations. Mode and skill must agree; do not leave routing to inference.
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
  3. Include only the minimal context needed to start implementation: approved plan path, planning artifact directory, selected implementation skill, selected mode, current branch/base SHA if known, explicit instruction to load the selected skill, a reminder to verify the handoff route matches the plan route, and a reminder not to use the prior planning conversation as context.
  4. Use `/clear` or start a new Claude Code session with only the handoff prompt and approved artifacts.
  5. If you cannot reset context automatically, stop and tell the user to open a new Claude Code session or run `/clear`, then paste/run the handoff prompt.

Do not continue directly into implementation inside the planning conversation. Do not offer to “just make the simple change here.” The approved artifact and handoff file are the context boundary.

## Red Flags

Stop before implementation if:

- Claude Code `Task` is unavailable.
- The working tree state, test infrastructure, model availability, or selected route invalidates the DAG and cannot be resolved in planning.
- A behavior-changing task lacks viable tests and the plan does not include either test infrastructure work or an explicit non-TDD exception.
- The user has not provided an explicit approval phrase.
- The planner is about to edit product/test/docs files or run implementation directly instead of handing off to `quick-implementation-work` or `implementation-work`.
- The selected `quick-batch` route includes parallel tasks that are not demonstrably independent and the plan does not degrade them to sequential execution.
