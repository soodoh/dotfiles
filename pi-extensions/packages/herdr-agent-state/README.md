# Herdr Pi state integration

This is a **locally maintained extension**, not an unmodified Herdr asset. It owns
Pi lifecycle state, native prompt state, background busy contributions, session
association, and socket reporting. The former `herdr-ui-prompts` extension is
consolidated here; there is exactly one lifecycle writer per root TUI pane.

## State and notification policy

Precedence:

1. A native UI prompt or external blocker is active → `blocked`.
2. The parent is active, a core continuation is pending, or a background busy
   contribution remains → `working`.
3. Otherwise → `idle`.

Herdr derives the plugin-facing `done` status from idle with an unseen result.
`done` is not a separate state emitted here and does not establish task success.
`herdr-focus-notify` remains responsible for desktop delivery and pane focus; its
existing explicit `blocked`/`done` filter is unchanged. Neither `idle` nor `unknown`
should be added to that filter. This change is not an attention-only policy switch.

### Inputs and lifecycle guarantees

- Pi 0.85.1+ `agent_start` and `agent_settled`, not `agent_end`/`turn_end`.
- Native `ui_prompt_start/end` are tracked directly as one coalesced span. Closing
  a prompt never releases an external blocker. Prompt titles and sibling labels
  are not sent to Herdr. Pending custom loaders/inspectors also count as native UI
  spans; arbitrary browser/shell input and uninstrumented built-in UI are outside
  this integration's scope.
- `herdr:busy` and `herdr:blocked` accept `{ active: true | false }` on the Pi event
  bus. Each producer owns balanced acquisitions/releases. Multiple producers are
  counted independently; malformed payloads are ignored and counts never go
  negative. Labels are ignored. Synchronous release/acquire label changes are
  coalesced at the next event-loop turn, not delayed by a guessed cooldown.
- Busy includes outstanding delivery, not only live child processes. Producers
  must queue the parent continuation **before** releasing the final contribution.
  The pi-subagents 0.66.0 result watcher awaits notification acceptance before
  emitting async completion. At publication we also check live `isIdle()` and
  `hasPendingMessages()` so that handoff cannot briefly announce completion.
- Initial idle publication waits until `resources_discover`, after all
  `session_start` handlers have restored their runs. Work and native prompts may
  publish during startup. The sibling listeners accept restoration before or
  after this extension's own `session_start` handler.
- Shutdown cancels queued publication, pending socket work and retries, and
  unsubscribes sibling listeners without reporting idle. Pi creates a fresh
  extension instance on reload/new/resume/fork; producers restore their state.
- Only a root `ctx.mode === "tui"` session with `HERDR_ENV=1`, socket and pane ID
  reports. `PI_SUBAGENT_CHILD=1`, RPC, JSON, print, and popup-only processes stay
  silent. `hasUI` alone is not sufficient because RPC also exposes UI methods.

**Attention limitation:** pi-subagents' legacy `herdr:blocked` payload contains
only `active` and `label`, with no producer identity or reason. Its inactivity
warnings can therefore still appear as blocked. We preserve the counted contract
rather than parsing prose or discarding potentially genuine blockers. Reliable
human-only classification requires a richer upstream signal; supervisor warnings
should ultimately stay with the parent unless it asks the human to intervene.

## Deployment and maintenance

Both profile filters select this package through the existing
`~/.pi/agent/pi-extensions` checkout symlink. They exclude the legacy standalone
`extensions/herdr-agent-state.ts`, preserving the file without loading a second
reporter. Do not run `herdr integration install pi`: it writes that excluded copy.
`herdr integration status` checks the legacy destination, not this package.

Start a new Pi session or use `/reload` to load changes. No workstation bootstrap,
Herdr binary update, plugin update, or Bun dependency change is required.

`index.ts` owns event/state handling; `transport.ts` owns bounded ordered delivery.
The transport keeps immutable identity snapshots, monotonic sequences, at most
one pending request per method, and two bounded socket attempts (500/1500 ms).
Delivery is best-effort when Herdr is unavailable. Review upstream improvements
instead of overwriting these files. They participate in normal lint/type/coverage
checks; bundled-byte equality is no longer a maintenance contract.

## Tests

```sh
bun run --cwd pi-extensions test packages/herdr-agent-state/index.test.ts
python3 pi-extensions/packages/herdr-agent-state/integration.test.py "$(mise which pi)"
mise run validate:agents
```

Unit tests assert full captured report sequences, including overlap, replacement,
core continuation handoff, startup restoration, independent prompts/blockers,
mode/child guards, identity fallback, malformed input, socket failure and cleanup.
The isolated host suite loads both profile configurations, with/without a legacy
copy, through the installed Pi loader. It exercises real native UI wrappers and
the installed pi-subagents Herdr bridge, plus fresh runtime reloads. Model runs,
core busy/pending flags, dialog outcomes and transports remain fixture-driven;
real desktop notification/focus behavior remains manual acceptance.

## Upstream provenance

Derived from Herdr **0.8.2**, Pi integration revision **8**, commit
`9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`:
[original source](https://github.com/herdrdev/herdr/blob/9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c/src/integration/assets/pi/herdr-agent-state.ts).
The original SHA-256 was `9b1c41cd72520fc2abe5f2a2aec995c12a926cce844df472c7fd5fcae4f4dbfa`.
The upstream Apache-2.0 [license](LICENSE) is retained. Local modifications add
busy aggregation, direct native prompt handling, startup/teardown coordination,
privacy-safe labels, typed per-session state, and cancellable ordered transport.
