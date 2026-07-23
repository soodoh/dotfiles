**Dry Run**

No Jira issue was created or updated. I used only repository inspection, live TWG help, and read-only Jira queries.

**Repository Findings**

- `main` is aligned with `origin/main`; there are no committed, staged, or tracked working-tree changes.
- The only current changes are untracked files under `unix-configs/.agents/skills/jira/` and `unix-configs/.agents/skills/jira-workspace/`.
- `unix-configs/.agents/skills/jira/SKILL.md` adds an agent skill for safely creating OB Jira work items through TWG, including issue-type inference, active-sprint discovery, Markdown-safe descriptions, optional epic resolution, and post-create verification.
- `unix-configs/.agents/skills/jira/evals/evals.json` adds three dry-run evaluations covering a current-branch ticket, a bug with an epic, and telemetry without an epic. The workspace metadata mirrors those scenarios.
- Inferred issue type: `Task`, because this is engineering enablement/tooling and evaluation work rather than a product regression or user-facing story. Live project data confirms that `Task` is available in OB.

**Proposed Ticket**

- Project: `OB` / Onboarding
- Type: `Task`
- Summary: `Add a TWG skill for creating well-formed OB Jira tickets`
- Assignee: `me`
- Sprint: `2026-14` (active sprint ID `54875`, dynamically resolved from the sole OB Scrum board)
- Epic: None; no epic context was requested or established

**Description**

```markdown
## Context

Agents need a consistent workflow for creating Jira work items in the OB project. The workflow must derive live TWG command contracts and mutable Jira values, produce descriptions that render correctly, and avoid unintended writes during previews or evaluations.

## Scope

- Add a Jira skill that targets the OB project, assigns new work items to the current user, and places them in the single active sprint discovered from the OB Scrum board.
- Infer Bug, Story, Enhancement, or Task from the requested work while verifying that the selected issue type exists in OB.
- Discover create metadata before setting custom fields and resolve epic relationships only when epic context is explicitly requested or clearly established.
- Use a Markdown-safe create/update sequence when the create command defaults description input to HTML.
- Add evaluation scenarios for current-branch drafting, bug-and-epic resolution, and telemetry work without an epic.
- Preserve dry-run behavior by returning a draft and proposed commands without creating or updating Jira.

## Acceptance criteria

- The Jira skill documents a read-before-write TWG workflow for creating one OB work item assigned to `me` and placed in the dynamically resolved active sprint.
- Issue type is inferred from repository or prompt context and verified against the OB project's available issue types.
- Markdown descriptions are never passed through an HTML-default input; the documented fallback creates the issue without the full description and then updates it with `--description-format markdown`.
- Epic association is omitted unless requested or supported by clear epic context, and any requested association uses live create metadata rather than a hardcoded custom-field ID.
- Explicit dry-run, preview, draft, and evaluation requests perform no Jira mutation.
- Evaluation fixtures cover the three documented ticket-drafting scenarios.

## Validation

- Inspect the skill and evaluation JSON for consistency with the documented workflow.
- Run each evaluation and confirm that preview scenarios perform read-only discovery only.
- Confirm live TWG help advertises the command flags used by the workflow.
- Confirm the OB project exposes the inferred issue type and exactly one applicable active sprint before any future create operation.
```

**TWG Workflow**

Read-only discovery performed:

```bash
twg help describe "jira workitem create"
twg help describe "jira workitem update"
twg help describe "jira board query"
twg help describe "jira board sprints query"
twg help describe "jira workitem field create-metadata"
twg jira space get OB
twg jira board query --project OB --type scrum
twg jira board sprints query --id 473 --current
twg jira workitem field create-metadata --space OB --type Task --output json
```

The live results verify project `OB`, issue type `Task`, one Scrum board (`473`), and exactly one active sprint (`2026-14`, ID `54875`). Create metadata reports Sprint as `customfield_10020`, though the canonical update contract supports `--sprint`; no custom field needs to be hardcoded for this draft.

If this were not a dry run, I would use this mutation sequence. The create command accepts descriptions but defaults to HTML and does not expose `--description-format`, so the full Markdown description must be applied in a separate update:

```bash
# 1. Create without the full Markdown description and retain the returned key.
twg jira workitem create \
  --space OB \
  --type Task \
  --summary "Add a TWG skill for creating well-formed OB Jira tickets" \
  --assignee me

# 2. Put the retained key in the dynamically resolved sprint.
twg jira workitem update --id "<RETURNED_KEY>" --sprint "54875"

# 3. Read the Markdown from an argument-safe temporary file or variable.
twg jira workitem update \
  --id "<RETURNED_KEY>" \
  --description "$(cat "<DESCRIPTION_FILE>")" \
  --description-format markdown

# 4. Verify project, type, summary, description, assignee, and sprint.
twg jira workitem get "<RETURNED_KEY>" \
  --fields summary,description,assignee,issuetype,project,customfield_10020
```

No create/update/get commands using a new issue key were executed in this dry run.

**Review Findings**

- info: `unix-configs/.agents/skills/jira/SKILL.md` - The new workflow correctly treats explicit dry runs as non-mutating and documents live help, project, board, sprint, and metadata discovery.
- info: `unix-configs/.agents/skills/jira/SKILL.md` - The Markdown fallback matches the installed CLI contract: create defaults to HTML and lacks `--description-format`, while update supports `--description-format markdown`.
- info: `unix-configs/.agents/skills/jira/evals/evals.json` - Evaluation coverage exercises current-branch grounding, conditional epic association, and a no-epic telemetry case.
- warning: `unix-configs/.agents/skills/jira-workspace/iteration-1/current-branch-ticket/eval_metadata.json` - The repository is on `main` with no tracked branch diff; the ticket draft therefore assumes the untracked skill and evaluation files are the intended “current branch changes.”

**Residual Risks**

- The untracked `jira-workspace` files appear to be evaluation artifacts and may not be intended for version control alongside the skill.
- No automated skill evaluation or JSON/schema validation was run; validation here is inspection plus live read-only TWG contract/data discovery.
- Sprint `2026-14` is mutable Jira state and must be queried again immediately before a future mutation rather than reused from this dry run.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete repository-grounded findings identify unix-configs/.agents/skills/jira/SKILL.md and unix-configs/.agents/skills/jira/evals/evals.json, with info/warning severity and explicit residual risks."
    }
  ],
  "changedFiles": [
    "/Users/paul.diloreto/.agents/skills/jira-workspace/iteration-1/current-branch-ticket/with_skill/outputs/agent-output.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short --branch; git branch --show-current; git log --oneline --decorate -8; git diff --stat; git diff --cached --stat; git diff --stat origin/main...HEAD",
      "result": "passed",
      "summary": "Confirmed main matches origin/main, with no tracked or staged diff and only untracked Jira skill/evaluation files."
    },
    {
      "command": "twg help describe jira workitem create/update, jira board query, jira board sprints query, and jira workitem field create-metadata",
      "result": "passed",
      "summary": "Verified live create, update, board, sprint, and metadata command contracts; update supports explicit Markdown and sprint assignment."
    },
    {
      "command": "twg jira space get OB",
      "result": "passed",
      "summary": "Verified OB is the Onboarding software project and supports the Task issue type."
    },
    {
      "command": "twg jira board query --project OB --type scrum; twg jira board sprints query --id 473 --current",
      "result": "passed",
      "summary": "Resolved the sole OB Scrum board and exactly one active sprint, 2026-14 (54875)."
    },
    {
      "command": "twg jira workitem field create-metadata --space OB --type Task --output json",
      "result": "passed",
      "summary": "Verified Task create metadata and identified optional Sprint and Epic Link custom fields without performing a mutation."
    }
  ],
  "validationOutput": [
    "Dry run honored: no Jira create or update command was executed.",
    "Project OB, issue type Task, board 473, and active sprint 2026-14/54875 were verified from live read-only Jira data.",
    "Installed create defaults descriptions to HTML and lacks a format flag; installed update supports --description-format markdown."
  ],
  "residualRisks": [
    "The branch has no tracked diff, so the draft assumes the untracked Jira skill/evaluation files are the intended changes.",
    "Evaluation workspace artifacts may not be intended for version control.",
    "The active sprint must be resolved again before any future Jira mutation."
  ],
  "noStagedFiles": true,
  "diffSummary": "No tracked branch diff; untracked files add an OB Jira creation skill, three evaluation definitions, and their workspace metadata.",
  "reviewFindings": [
    "info: unix-configs/.agents/skills/jira/SKILL.md - Dry-run and Markdown-safe TWG workflow matches live CLI contracts.",
    "info: unix-configs/.agents/skills/jira/evals/evals.json - Three scenarios cover branch context, epic resolution, and no-epic telemetry.",
    "warning: unix-configs/.agents/skills/jira-workspace/iteration-1/current-branch-ticket/eval_metadata.json - No tracked current-branch diff exists; intent is inferred from untracked files."
  ],
  "manualNotes": "No Jira mutation occurred. No epic was searched or assigned because the repository changes establish no epic context."
}
```
