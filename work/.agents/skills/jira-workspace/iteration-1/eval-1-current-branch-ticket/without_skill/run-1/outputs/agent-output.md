**Dry Run Result**

No Jira item was created or updated. All TWG calls executed were read-only discovery commands.

**Repository Findings**

- `medium: current branch scope` - The repository is on `main`, exactly aligned with `origin/main`, with no tracked or staged diff. The draft therefore uses the current `HEAD` commit (`c74d2fd`, `refactor(agents): combine llm-hub + claude otel`) as the only meaningful current branch change set.
- `info: pi-extensions/packages/llm-hub/llm-hub.ts` - LLM Hub authentication, model discovery, provider registration, and provider-scoped telemetry are consolidated into the `llm-hub` extension.
- `info: pi-extensions/packages/llm-hub/otel-metrics.ts` - Claude Code-compatible OTEL metrics support moves into `llm-hub`, with lifecycle handling tied to the active provider.
- `info: pi-extensions/packages/llm-hub/otel-metrics.test.ts` and `pi-extensions/packages/llm-hub/llm-hub.test.ts` - The consolidated implementation includes dedicated telemetry and provider test coverage.
- `info: pi-extensions/packages/claude-otel/` - The standalone `claude-otel` package is removed, including its implementation, tests, package metadata, and README.
- `info: unix-configs/.pi/agent/settings.json` - The LLM Hub extension is enabled in the configured local Pi extension list.

**Proposed Jira Work Item**

- Project: `OB` (Onboarding), verified through `twg jira space get OB`
- Issue type: `Task` - this is an internal refactor/consolidation, not a user-visible defect or a new user story
- Assignee: `me` (Paul DiLoreto, resolved by TWG)
- Sprint: dynamically discovered from the OB Scrum board; the current read-only lookup returned the single active sprint `2026-14` (ID `54875`)
- Epic: none inferred or proposed; the repository changes provide no grounded epic relationship
- Summary: `Consolidate LLM Hub provider and Claude-compatible OTEL telemetry`

**Draft Description**

## Context

The Pi agent configuration currently carries LLM Hub provider behavior and Claude-compatible OTEL telemetry as separate extension concerns. Consolidate them into the `llm-hub` package so provider authentication, model discovery, and telemetry lifecycle are maintained together.

## Scope

- Add interactive LLM Hub login and retain `LLMHUB_BASE_URL` / `LLMHUB_AUTH_TOKEN` environment fallback support.
- Register the LLM Hub provider even when credentials are unavailable so login remains discoverable.
- Move Claude-compatible OTEL metric collection and export into the LLM Hub package.
- Start telemetry only while an LLM Hub model is active, and flush and stop it when another provider becomes active.
- Remove the standalone `claude-otel` package and its workspace dependency.
- Enable the consolidated LLM Hub extension in the Pi agent settings.
- Update package documentation and tests for authentication, discovery, provider transitions, and telemetry behavior.

## Acceptance Criteria

- LLM Hub credentials can be supplied through interactive login or the documented environment variables.
- Model discovery is bounded and a failed or empty discovery does not remove the LLM Hub login option.
- LLM Hub and LiteLLM remain independently registered and do not override each other's credentials, models, or endpoints.
- OTEL resources start only for an active LLM Hub model and stop safely when switching providers.
- Supported Claude-compatible session, token, cost, activity, code-change, commit, pull-request, and edit-decision metrics remain covered by tests.
- The standalone `claude-otel` package is no longer required or loaded.
- The `llm-hub` package test and typecheck commands pass.

## Validation

- Run `bun run --filter llm-hub test`.
- Run `bun run --filter llm-hub typecheck`.
- In Pi, verify `/login` lists LLM Hub without preconfigured credentials.
- Authenticate against an LLM Hub endpoint and verify discovered models are available.
- With OTEL metrics configured, switch from an LLM Hub model to another provider and verify the exporter flushes and stops.

**TWG Workflow (Preview Only)**

The safe workflow creates the shell item without a description, then updates it with an explicitly declared Markdown format. This avoids feeding Markdown to `jira workitem create --description`, whose default input interpretation is HTML.

```bash
# 1. Verify the target project and supported Task type.
twg jira space get OB -o json

# 2. Resolve the OB Scrum board rather than hardcoding it.
BOARD_ID="$(twg jira board query --project OB --type scrum -o json | jq -r '.data.boards | if length == 1 then .[0].id else error("expected exactly one OB Scrum board") end')"

# 3. Resolve exactly one active sprint dynamically.
SPRINT_ID="$(twg jira board sprints query --board-id "$BOARD_ID" --current -o json | jq -r '.data.sprints | if length == 1 then .[0].id else error("expected exactly one active sprint") end')"

# 4. Inspect create metadata so custom fields are not guessed.
twg jira workitem field create-metadata --space OB --type Task -o json

# 5. MUTATION - intentionally not executed in this dry run.
ISSUE_KEY="$(twg jira workitem create \
  --space OB \
  --type Task \
  --summary 'Consolidate LLM Hub provider and Claude-compatible OTEL telemetry' \
  --assignee me \
  -o json | jq -r '.data.key')"

# 6. MUTATION - intentionally not executed. DESCRIPTION contains the Markdown draft above.
twg jira workitem update \
  --id "$ISSUE_KEY" \
  --description "$DESCRIPTION" \
  --description-format markdown \
  --sprint "$SPRINT_ID" \
  -o json
```

At execution time, steps 2 and 3 must be rerun; the currently observed board ID `473` and sprint ID `54875` are evidence of discovery, not values to embed permanently.

**Residual Risks**

- The branch has no tracked delta relative to `origin/main`; if the intended work is in another branch or in the untracked Jira evaluation files, this draft targets the wrong change set.
- No implementation tests were run during this ticket-drafting task, so the acceptance criteria reflect repository documentation and committed test files rather than newly verified runtime results.
- The two-step create/update workflow could leave an incomplete shell issue if the Markdown or sprint update fails; an executing agent should capture the created key and retry or clean up deliberately.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete, severity-tagged findings identify the branch-scope ambiguity and affected paths including pi-extensions/packages/llm-hub/llm-hub.ts, pi-extensions/packages/llm-hub/otel-metrics.ts, pi-extensions/packages/claude-otel/, and unix-configs/.pi/agent/settings.json; residual risks are explicitly documented."
    }
  ],
  "changedFiles": [
    "/Users/paul.diloreto/.agents/skills/jira-workspace/iteration-1/current-branch-ticket/without_skill/outputs/agent-output.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short --branch; git branch --show-current; git log --oneline --decorate -8",
      "result": "passed",
      "summary": "Confirmed main equals origin/main, with no tracked or staged changes; only untracked Jira evaluation artifacts exist."
    },
    {
      "command": "git show --stat --summary HEAD; git show HEAD -- relevant changed files",
      "result": "passed",
      "summary": "Inspected HEAD commit c74d2fd and grounded the draft in the LLM Hub/OTEL consolidation."
    },
    {
      "command": "twg whoami -o json; twg jira space get OB -o json",
      "result": "passed",
      "summary": "Read-only discovery verified the current user, OB project, and supported Task issue type."
    },
    {
      "command": "twg jira board query --project OB -o json; twg jira board sprints query --board-id 473 --current -o json",
      "result": "passed",
      "summary": "Read-only discovery found the OB Scrum board and its single active sprint 2026-14 (54875)."
    },
    {
      "command": "twg jira workitem field create-metadata --space OB --type Task -o json",
      "result": "passed",
      "summary": "Read-only metadata confirmed Sprint is customfield_10020 and no required create fields were shown."
    }
  ],
  "validationOutput": [
    "No Jira create, update, transition, or other mutation command was executed.",
    "Draft targets OB, assigns to me, dynamically resolves the active sprint, and uses an explicit Markdown update rather than the create command's HTML-default description input."
  ],
  "residualRisks": [
    "Current main has no tracked diff from origin/main, so HEAD was used as the inferred change set.",
    "Implementation tests were not run because this task only drafted a ticket.",
    "A future two-step create/update execution must handle partial failure after shell issue creation."
  ],
  "noStagedFiles": true,
  "diffSummary": "HEAD consolidates the standalone claude-otel package into llm-hub, adds provider authentication and scoped telemetry behavior, updates tests/docs/dependencies, removes claude-otel, and enables llm-hub in Pi settings.",
  "reviewFindings": [
    "medium: repository root - main matches origin/main with no tracked branch changes, making HEAD-based ticket scope an explicit inference",
    "info: pi-extensions/packages/llm-hub/llm-hub.ts - provider authentication, discovery, registration, and telemetry integration are consolidated",
    "info: pi-extensions/packages/claude-otel/ - standalone package is removed",
    "no blockers: dry-run workflow performed no Jira mutation"
  ],
  "manualNotes": "The prohibited jira/SKILL.md file was not read or used. Only read-only local Git and TWG discovery commands were executed."
}
```
