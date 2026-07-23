**Preview Only**

No Jira item was created or updated. Read-only discovery found one unambiguous open OB epic matching the requested topic: [OB-2875](https://docusign.atlassian.net/browse/OB-2875), **Getting started experiences: Home - Onboarding Tasks and Recommended components**. It is an `Epic` in project `OB` and is currently `In Progress`.

**Proposed Ticket**

- Project: `OB` / Onboarding
- Type: `Bug` (verified as an available OB issue type)
- Summary: `Prevent the welcome checklist from remaining in a loading state after tasks load`
- Assignee: `me`
- Epic/parent: `OB-2875` — Getting started experiences: Home - Onboarding Tasks and Recommended components
- Sprint: `2026-14` (ID `54875`), the sole active sprint on the Onboarding Scrum Board (ID `473`)

Proposed description:

```markdown
## Context
The welcome checklist sometimes remains in a loading state even after all checklist tasks have loaded. This leaves users unable to see or interact with the fully loaded checklist.

## Reproduction
1. Open the experience containing the welcome checklist.
2. Allow all checklist tasks to load.
3. Observe that the checklist sometimes continues to display its loading state.

## Actual behavior
The welcome checklist can remain in a loading state after all tasks have loaded.

## Expected behavior
Once all checklist tasks have loaded, the loading state clears and the complete checklist is displayed and available for interaction.

## Scope
Ensure the welcome checklist derives and clears its loading state correctly when task loading completes, including the intermittent path that currently leaves the loading state active.

## Acceptance criteria
- The welcome checklist exits its loading state after all tasks finish loading.
- All loaded checklist tasks are displayed and available for interaction after the loading state clears.
- The checklist does not remain indefinitely in a loading state when task loading completes successfully.
- Automated coverage exercises the task-loading completion path that previously left the checklist loading.

## Validation
- Add or update automated tests for loading-state transitions when checklist tasks finish loading.
- Verify the checklist renders all loaded tasks and no loading indicator after successful completion.
```

**Exact Discovery Approach**

These read-only commands were run:

```bash
twg help describe "jira workitem create"
twg help describe "jira workitem update"
twg help describe "jira board query"
twg help describe "jira board sprints query"
twg help describe "jira workitem field create-metadata"
twg help describe "jira workitem get"
twg help describe "jira workitem query"

twg jira space get OB
twg jira board query --project OB --type scrum
twg jira board sprints query --id 473 --current
twg jira workitem field create-metadata --space OB --type Bug --output json

twg jira workitem query \
  --jql 'project = OB AND issuetype = Epic AND statusCategory != Done AND summary ~ "Getting started experiences"' \
  --first 20

twg jira workitem query \
  --jql 'project = OB AND issuetype = Epic AND statusCategory != Done AND summary ~ "Getting started"' \
  --first 20

twg jira workitem get OB-2875 --fields summary,issuetype,project,status,description
```

Discovery verified:

- `OB` is the Onboarding software project and supports the `Bug` issue type.
- Project `OB` has exactly one Scrum board: `Onboarding Scrum Board` (ID `473`).
- Board `473` has exactly one active sprint: `2026-14` (ID `54875`).
- Both focused epic searches returned only `OB-2875`; hydration verified that it is an OB `Epic`, not merely a keyword search result.
- Live create help supports `--parent`; live update help supports `--sprint` and Markdown descriptions through `--description-format markdown`.
- Create metadata was queried before proposing the mutation, as required for current OB/Bug field contracts.

**Exact Create/Update Approach — Not Executed**

Because `jira workitem create` does not advertise `--description-format`, the safe approach is to create without a description, capture the returned key, and then apply the Markdown description together with the sprint update. The verified epic hierarchy is supplied through the live `--parent` contract.

```bash
CREATE_OUTPUT=$(twg jira workitem create \
  --space OB \
  --type Bug \
  --summary 'Prevent the welcome checklist from remaining in a loading state after tasks load' \
  --assignee me \
  --parent OB-2875)

# Extract CREATED_KEY from the key returned by CREATE_OUTPUT; never infer it from Jira history.

DESCRIPTION=$(cat <<'MARKDOWN'
## Context
The welcome checklist sometimes remains in a loading state even after all checklist tasks have loaded. This leaves users unable to see or interact with the fully loaded checklist.

## Reproduction
1. Open the experience containing the welcome checklist.
2. Allow all checklist tasks to load.
3. Observe that the checklist sometimes continues to display its loading state.

## Actual behavior
The welcome checklist can remain in a loading state after all tasks have loaded.

## Expected behavior
Once all checklist tasks have loaded, the loading state clears and the complete checklist is displayed and available for interaction.

## Scope
Ensure the welcome checklist derives and clears its loading state correctly when task loading completes, including the intermittent path that currently leaves the loading state active.

## Acceptance criteria
- The welcome checklist exits its loading state after all tasks finish loading.
- All loaded checklist tasks are displayed and available for interaction after the loading state clears.
- The checklist does not remain indefinitely in a loading state when task loading completes successfully.
- Automated coverage exercises the task-loading completion path that previously left the checklist loading.

## Validation
- Add or update automated tests for loading-state transitions when checklist tasks finish loading.
- Verify the checklist renders all loaded tasks and no loading indicator after successful completion.
MARKDOWN
)

twg jira workitem update \
  --id "$CREATED_KEY" \
  --description "$DESCRIPTION" \
  --description-format markdown \
  --sprint 54875 \
  --output json
```

The final read-back would be:

```bash
twg jira workitem get "$CREATED_KEY" --full
```

That verification would check project, type, summary, rendered description, assignee, sprint, and parent/epic. If the post-create update failed, the created key and partial state would be reported rather than creating a duplicate.

**Findings And Risks**

- No blockers: the project, issue type, sole Scrum board, sole active sprint, and one unambiguous matching open epic were verified through read-only Jira calls.
- Residual risk: the report does not invent the intermittent trigger, affected environment, frequency, severity, or regression version; those details were not supplied and should be added if learned during implementation.
- Artifact: `/Users/paul.diloreto/.agents/skills/jira-workspace/iteration-1/bug-with-epic/with_skill/outputs/agent-output.md` contains this preview; no repository source files were reviewed or changed.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete Jira findings, preview content, exact read-only discovery commands, proposed mutation commands, artifact path, and residual risks are documented."
    }
  ],
  "changedFiles": [
    "/Users/paul.diloreto/.agents/skills/jira-workspace/iteration-1/bug-with-epic/with_skill/outputs/agent-output.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "twg help describe for Jira create, update, board query, sprint query, create metadata, get, and query contracts",
      "result": "passed",
      "summary": "Verified live read/write command contracts without performing mutations."
    },
    {
      "command": "twg jira space get OB",
      "result": "passed",
      "summary": "Verified the Onboarding project and Bug issue type."
    },
    {
      "command": "twg jira board query --project OB --type scrum",
      "result": "passed",
      "summary": "Found exactly one OB Scrum board, ID 473."
    },
    {
      "command": "twg jira board sprints query --id 473 --current",
      "result": "passed",
      "summary": "Found exactly one active sprint, 2026-14 (ID 54875)."
    },
    {
      "command": "twg jira workitem field create-metadata --space OB --type Bug --output json",
      "result": "passed",
      "summary": "Read current OB Bug create metadata."
    },
    {
      "command": "focused open-epic JQL queries and twg jira workitem get OB-2875",
      "result": "passed",
      "summary": "Found and hydrated one unambiguous matching OB epic, OB-2875."
    }
  ],
  "validationOutput": [
    "OB supports Bug issues.",
    "Onboarding Scrum Board (473) is the sole matching Scrum board.",
    "Sprint 2026-14 (54875) is the sole active sprint.",
    "OB-2875 is an In Progress Epic in OB and the only focused match for Getting started experiences.",
    "No Jira create or update command was executed."
  ],
  "residualRisks": [
    "The precise intermittent trigger, environment, frequency, severity, and regression version remain unknown and were not invented."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added only the required preview artifact; no Jira mutation and no repository source change.",
  "reviewFindings": [
    "no blockers: Jira placement and epic match were verified read-only",
    "residual: no source files were provided or reviewed, so the underlying loading-state defect and exact reproduction trigger are not independently validated"
  ],
  "manualNotes": "Preview only. The displayed create/update/read-back commands are proposed and were not executed."
}
```
