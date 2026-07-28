# aidev-track

Bridges Pi's agent lifecycle to DocuSign's [`aidev-track`](https://github.docusignhq.com/Microservices/aidev-track)
CLI so AI-authored code written by Pi is attributed in git notes
(`refs/notes/aidev-track`), the same way Claude Code, Copilot, and Gemini
integrate natively.

## Why this exists

`aidev-track install-agent-hooks` only wires up Claude Code, Copilot, and
Gemini — each via that agent's own hook system. Pi has no native support and
there is no config to register it. This extension reproduces the exact contract
those agents use, driven by Pi's lifecycle events.

The repo-committed git hooks (`.husky/*` → `aidev-track hook ...`) are
agent-agnostic and need no changes; they reconcile whatever attribution data
this extension records into git notes at commit/push time.

## Event mapping

| Pi event | aidev-track call | Claude equivalent |
| --- | --- | --- |
| `before_agent_start` | `turn-start pi` | `UserPromptSubmit` |
| `tool_call` (`edit`/`write`) | `checkpoint pi` | `PreToolUse` (pristine snapshot) |
| `tool_result` (`edit`/`write`) | `checkpoint pi` | `PostToolUse` (edited snapshot) |
| `agent_settled` | `turn-end pi` | `Stop` (reconcile) |

Each call pipes a JSON payload on stdin containing `session_id`
(`ctx.sessionManager.getSessionId()`), `cwd`, and the relevant hook fields —
`session_id` is what correlates a turn's baseline, checkpoints, and
reconciliation.

The `tool_call` (pre-edit) checkpoint is awaited **before** the edit runs so it
captures the pristine file state; without that ordering attribution silently
falls back to 100% human.

## Behavior and safety

- **Never blocks a turn.** All invocations swallow failures and resolve to a
  status; a missing or hung binary can never break Pi.
- **No-op when `aidev-track` is absent.** The first `ENOENT` disables further
  spawning for the session, mirroring the `|| true` guard in the git hooks.
- **Timeout guarded.** A stuck process is killed after 5s.
- **Tool label.** Pi reports as agent `pi`, which the current CLI records with
  a `tool: "unknown"` label. Attribution still counts fully as AI (AI% is
  correct); only the per-tool breakdown is unlabeled. If the `aidev-track`
  maintainers add a first-class `pi` agent id, no change is needed here beyond
  the label appearing.

## Verifying

```sh
git notes --ref=aidev-track show HEAD   # inspect the raw authorship note
aidev-track pr                          # AI vs human breakdown for the branch
```
