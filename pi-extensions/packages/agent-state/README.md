# Pi session state: Herdr and Moshi

One locally maintained state owner, with separate Herdr and Moshi socket adapters.
This replaces `herdr-agent-state` (which already incorporated `herdr-ui-prompts`)
and the generated Moshi Pi hook. It does not change either daemon, pairing,
notification preferences, or other agents' Moshi hooks.

## Semantics

1. Native Pi UI prompt in the parent → `blocked`.
2. Parent activity, live subagent work, undelivered completion, queued core
   continuation, or unavailable activity evidence → `working`.
3. Otherwise → `idle`.

Herdr receives these states. Its plugin-facing `done` means idle and unseen, not
successful completion. `herdr-focus-notify` keeps its explicit `blocked`/`done`
filter. This is not an attention-only notification-policy switch.

Moshi receives `session_started` for working, `approval_required` for input, and
one `task_complete` when an observed task settles with a normal assistant stop.
Aborted, errored, and response-limit stops use `error`, never success. This is a
lifecycle result, not proof that tests passed or the user's objective was met.
Unknown outcomes, startup idle, and dialog closure alone do not complete a task.
Automatic continuations keep the original Pi session identity and cannot complete
it while more work or delivery remains. No time-based completion cooldown is used.

Native `ui_prompt_start/end` spans supply human-input state. Moshi documents
`approval_required` as covering permissions **and user answers**: our title is
“Pi needs input”, not “needs approval”. No `actionId` or
`toolName` is fabricated; answer in the terminal (including Moshi's terminal).
A `PermissionResolved` update clears Moshi's input marker when the span ends,
even if a later completion replaces a queued working update. A real quit emits
`session.closed`; reload/new/resume/fork only tear down this runtime's transports.

Only root `ctx.mode === "tui"` instances report. Child runtimes
(`PI_SUBAGENT_CHILD=1`), RPC, JSON and print modes are silent. A root interactive
fork remains eligible; transcript lineage alone does not identify a subagent.
Moshi works outside Herdr. Herdr requires `HERDR_ENV=1`, socket and pane identity;
a popup lacking pane identity cannot write Herdr state.

Native custom UI loaders/inspectors count as waiting spans too. Plain prose,
uninstrumented built-in UI and arbitrary browser/shell input are not interpreted
as requests for human input.

## Upstream liveness compatibility

`liveness.ts` implements the host side of pi-subagents' existing versioned
[session-liveness protocol](https://github.com/nicobailon/pi-subagents/blob/main/docs/extension-api.md):

```ts
// Symbol.for("@agegr/pi-web/session-liveness/v1")
interface Registry {
  version: 1;
  register(provider: {
    name: string;
    sessionId: string;
    sessionFile?: string;
    isActive(): boolean;
  }): () => void;
}
```

The upstream `pi-subagents` provider owns the authoritative calculation: queued/
running jobs, foreground scheduling owners/children, retained nested work and
pending completion delivery. Successful registration enables upstream's retained
nested-route tracker. We query its `isActive()` for the exact current Pi UUID;
we do not import private upstream modules, read run files, scrape fleet/status
DTOs, reconstruct run state, or modify dependencies. Tests may import installed
upstream implementations to exercise this contract on upgrades.

The dormant registry is advertised during extension factory loading, before any
`session_start` handler, so extension order does not matter. It starts no timers
or I/O. Non-TUI runtimes release their lease immediately at `session_start`;
child runtimes never acquire one. Our ownership marker survives module reloads,
and readers/provider registrations have independent, idempotent disposers.
An old runtime cannot unregister a replacement. The last reader removes only
our registry. An existing foreign registry—even a compatible v1 host—is **not**
wrapped, queried or overwritten: v1 has registration, not a public lookup API.
A later registry replacement also makes evidence unavailable.

Initial idle waits until all `session_start` restoration handlers finish
(`resources_discover`). Lifecycle events trigger immediate in-memory reads;
optional subagent events are only hints. Because v1 has no change subscription,
one unreferenced timer also reads every 250 ms during background activity/pending
continuations or unknown evidence, and every second otherwise. This discovers
scheduled work without depending on event names. It is not filesystem polling
or a notification cooldown; no timeout declares work finished. Pi's `isIdle()`
and `hasPendingMessages()` cover the delivery-to-parent handoff.

Missing providers, wrong identities, malformed/throwing activity and ownership
conflicts retain working state and suppress completion. One local warning asks
to check registry ownership and run `mise run validate:agents`, then `/reload`.
Do not overwrite another host's registry or add a guessed completion timeout.

This is a pi-web-named **versioned host protocol**, not a general Pi extension
subscription API or a promise of compatibility with every future upstream release.
The dependency remains pinned in `package.json`/`bun.lock`. On upgrades, run the
behavioral and native-host tests below; adapt this one module if the protocol
changes. A general-purpose upstream liveness interface would be preferable when
available. There is no local pi-subagents patch to rebase.

Anonymous `herdr:blocked` events are deliberately ignored, regardless of sender.
A child's supervisor request goes to the parent orchestrator; the parent resolves
it or opens a native prompt for the human. Neither supervisor warnings nor third-
party legacy blockers directly generate input alerts. This intentionally drops
legacy blocker compatibility; producers needing human input must use Pi's native
prompt UI. We never infer audience from labels or prose.

Balanced `{ active: boolean }` contributions on `herdr:busy` remain supported for
external work, even outside Herdr. Counts support overlapping producers; malformed
contributions cannot release counts and synchronous label replacements coalesce
at the next event-loop turn. External jobs not owned by pi-subagents need those
contributions; simply appearing in FleetView does not register liveness.

## Transport, identity and privacy

- `state.ts` owns all lifecycle decisions. `index.ts` wires `herdr.ts` and `moshi.ts`.
- Herdr retains its Apache-derived ordered transport (`transport.ts`): immutable
  identity snapshots, monotonic sequences, one pending request per method and
  bounded 500/1500-ms attempts with obsolete-retry suppression.
- Moshi uses its JSON-line, half-close, ack protocol (`moshi-transport.ts`): one
  in-flight attempt, latest pending state plus at most one input-resolution
  barrier, 1000-ms timeout and **no notification retries**. Both transports are
  best-effort, cancel queued work on teardown and never start daemons.
- `MOSHI_SOCKET_PATH` overrides the endpoint. Defaults match moshi-hook: macOS
  `~/Library/Application Support/Moshi/moshi-hook.sock`, Linux
  `$XDG_RUNTIME_DIR/moshi-hook.sock` or `/tmp/moshi-hook.sock`, Windows named pipe
  `\\.\pipe\moshi-hook` (Windows is not tested).
- Pi UUID, transcript path, cwd/project name, model and terminal identity are
  preserved. Herdr prefers an absolute transcript path with UUID fallback;
  Moshi requires a UUID. Herdr/Zellij identity comes from environment; tmux adds
  one bounded 200-ms read-only identity query at session start.
- Unlike the generated Moshi hook, this adapter sends generic titles, **not**
  prompt/response excerpts, UI titles, sibling labels or error details. Terminal
  and transcript metadata still reach the daemon; Moshi's normal cloud handling
  of notification metadata remains in effect. No credentials are read here.

## Deployment and maintenance

Both profiles load `packages/agent-state/index.ts` through the checkout symlink.
They exclude `extensions/herdr-agent-state.ts` **and** `extensions/moshi-hooks.ts`;
keep both exclusions, even when those files are absent or regenerated by installers.
Do not load the old package alongside this one. `herdr integration status` checks
the excluded standalone asset, not our package.

On another checkout/workstation, reconcile dependencies to remove the previous
patch before reloading Pi (no bootstrap, integration install or pairing required):

```sh
bun install --cwd pi-extensions --frozen-lockfile
```

Then use `/reload` or start a new Pi session. Validate compatibility on dependency
upgrades; never edit `node_modules` to repair the protocol. Moshi behavior is
verified against **moshi-hook 0.3.19** and its
[category documentation](https://getmoshi.app/docs/hooks); notification delivery
policy belongs to [Moshi](https://getmoshi.app/docs/notifications), not this module.

## Validation

```sh
bun run --cwd pi-extensions test packages/agent-state
python3 pi-extensions/packages/agent-state/integration.test.py "$(mise which pi)"
mise run validate:agents
```

Unit tests cover full report sequences, overlap, restoration, outcome handling,
mode guards, unavailable evidence, registry ownership/reload, unmodified upstream
providers, transport failure, coalescing and shutdown. Isolated host tests load
both profile filters with and without legacy hooks, exercise Pi's actual native
prompt wrappers and the installed completion notifier. A separate full-entrypoint
test checks upstream registration and disposal across reloads in both extension
orders. Core activity, run records, dialog outcomes and socket transport are
fixtures; no LLM/child runs or live desktop/mobile delivery are claimed.

Optional local protocol smoke test (unpaired daemon, temporary home, loopback
only; no workstation service changes):

```sh
python3 pi-extensions/packages/agent-state/moshi-daemon.test.py "$(command -v moshi-hook)"
```

Manual acceptance: in a new root Pi session, inside and outside Herdr, launch
multiple async children, let the parent yield, and verify no completion until the
parent's final continuation. Open/answer a native question, reload during active
work, and check the actual desktop/mobile UI and notification preferences.

## Provenance

The Herdr adapter and transport derive from Herdr **0.8.2**, Pi integration
revision **8**, commit `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`:
[original source](https://github.com/herdrdev/herdr/blob/9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c/src/integration/assets/pi/herdr-agent-state.ts).
Original SHA-256: `9b1c41cd72520fc2abe5f2a2aec995c12a926cce844df472c7fd5fcae4f4dbfa`.
The Apache-2.0 [license](LICENSE) is retained. These are locally maintained files,
not an upstream-byte-parity copy. The Moshi adapter is locally authored against
the documented categories and installed generated hook's wire contract; it does
not vendor the generated hook.
