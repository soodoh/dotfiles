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
| `before_agent_start`, or `agent_start` without it | `turn-start pi` once per settled run | `UserPromptSubmit` |
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

- **Never prevents a turn.** Hooks are awaited and may delay execution, but
  failures resolve to a status instead of throwing. Nonzero exits and stdin
  errors are failures, not successful attribution.
- **One baseline per settled run.** Completion messages and commands starting
  a run without `before_agent_start` also get a baseline. Automatic retries and
  continuations reuse it; only `agent_settled` reconciles and releases it.
- **Serialized hook processes.** Parallel and codemode-nested `edit`/`write`
  checkpoints share one runtime queue. Pi still owns file mutation ordering;
  this does not lock other sessions or replace the CLI's cross-process safety.
- **No-op when `aidev-track` is absent.** The first `ENOENT` disables further
  spawning for the session, mirroring the `|| true` guard in the git hooks.
- **Timeout/cancellation guarded.** A stuck process is hard-killed after 5s.
  Turn cancellation stops active snapshots; reconciliation can still run after
  an abort. Session shutdown cancels active hooks and drains/skips queued work.
  Waiting for termination adds at most 250ms if the OS does not report close.
- **Tool label.** Pi reports as agent `pi`, which the current CLI records with
  a `tool: "unknown"` label. Attribution still counts fully as AI (AI% is
  correct); only the per-tool breakdown is unlabeled. If the `aidev-track`
  maintainers add a first-class `pi` agent id, no change is needed here beyond
  the label appearing.

## Verifying

```sh
bun run --cwd pi-extensions test -- packages/aidev-track
node pi-extensions/packages/aidev-track/integration-host.test.mjs "$(mise which pi)"
```

The actual-host test uses a deterministic model and captured attribution CLI,
plus real subprocess failure probes. It exercises native codemode concurrency
and extension-triggered continuations without credentials or workstation hooks.
It does not claim end-to-end git-note attribution by the proprietary CLI.


```sh
git notes --ref=aidev-track show HEAD   # inspect the raw authorship note
aidev-track pr                          # AI vs human breakdown for the branch
```
