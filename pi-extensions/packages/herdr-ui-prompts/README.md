# Herdr UI prompt bridge

A companion to the unchanged official `herdr-agent-state` reporter. Requires
Pi 0.85.1's native `ui_prompt_start` / `ui_prompt_end` events. Both profiles load
it through the existing local Pi package; no installer, sockets or extra process.

The bridge owns one counted `herdr:blocked` contribution while Pi's coalesced
extension-UI prompt span is open. Ending the span releases only that contribution;
independent subagent attention remains blocked. The official reporter alone owns
Herdr lifecycle/session reports and chooses the resulting working/idle state.

- Handles instrumented `ctx.ui.select`, `confirm`, `input`, `editor`, and `custom`.
- Runs only after TUI session startup in a Herdr pane, never in RPC/JSON/print,
  popups or `PI_SUBAGENT_CHILD=1` children.
- Releases at most once on prompt end or session shutdown/reload. Native event
  registrations belong to Pi's extension runtime; no extra bus subscription.
- Uses a generic label, not potentially sensitive dialog titles or contents.
- Does not also translate the question tool's legacy RPIV events (double counting).

Scope is the host's UI span, not semantic analysis: `ui.custom` can also host an
async loader or inspector, which is marked blocked while its promise is pending.
Uninstrumented built-in menus/trust prompts, shell/browser input and remote UI
need separate producer signals. A normal assistant question after settlement is
idle/done, not an in-flight UI block. Native events are best-effort notifications,
not awaited UI hooks; no synchronous desktop-delivery guarantee is implied.

## Tests

`index.test.ts` covers guards, ownership, duplicate/late events, cleanup and label
privacy. The installed-host suite in `../herdr-agent-state/integration-host.test.mjs`
loads both actual package entries through each profile. It drives Pi's real event
runner and UI wrappers with fake dialog promises and captured socket transport:
answer/cancel/error, overlapping prompts, independent attention, idle/working
restoration and shutdown/start lifecycle cleanup. Lifecycle hooks are driven by
the fixture; a complete interactive `/reload` and physical notification clicks
still need acceptance testing. `mise run validate:agents` runs both suites.

Source contract: [Pi 0.85.1 prompt events](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/docs/extensions.md#ui_prompt_start--ui_prompt_end).
