# Herdr migration and acceptance

## Decision record

Both `personal-macos` and `work-macos` use the shared Herdr configuration.
This implements the fresh-session handoff: native navigation and **`last_pane`**,
Ctrl+Space prefix, command-style Fish autostart, and Pi's **regular** default now.
No custom workspace-MRU, sesh directory launcher, or Pi dashboard is retained.
Earlier custom-MRU and trial-gated-rendering proposals are superseded.
`herdr-migration-research.md` was not present in this checkout (including untracked
planning files); no missing research content was invented or deleted.

Implementation baseline: clean `main` at
`f98e49857d72938e1254f7331873d21472a54bed`, macOS arm64,
explicit `MISE_ENV=personal-macos`, Pi 0.85.1, mise 2026.9.1.
Baseline `mise run validate` passed; no pre-existing failures were found.
The intentional work HTTP security expected-failure remains unchanged.

## Installation and ownership

```sh
mise install aqua:herdrdev/herdr
mise run bootstrap:pi
```

The declared Aqua registry backend is `aqua:herdrdev/herdr`, pinned to **0.8.2**.
`mise run lock` generated release-asset checksums for Linux/macOS x64/arm64.
Only Herdr/tmux/sesh tool entries changed; both profile locks and all unrelated
versions stayed unchanged. No checksum was hand-authored, grouped update or
workstation bootstrap was run, or old binary uninstalled.

Only `~/.config/herdr/config.toml` links into this checkout. Never link the
whole directory: sockets, session snapshots, logs, plugins, and optional history
are runtime data. The existing native cwd policy is `follow`. Native restoration
and 10,000,000-byte scrollback defaults remain; optional `experimental.pane_history`
is disabled by default. Restored layouts/native agent conversations do **not**
mean arbitrary old processes survive a server restart.

The official revision **8** reporter is now vendored byte-for-byte in
[`pi-extensions/packages/herdr-agent-state`](../../../pi-extensions/packages/herdr-agent-state/README.md),
with its upstream license, source commit and checksum. The existing mise Pi-package
symlink and both profile filters deploy it; `bootstrap:pi` only runs Bun dependency
setup. The former `configure:herdr-pi` task has been removed.

Both profiles explicitly exclude the standalone `extensions/herdr-agent-state.ts`
path. This prevents a previously installed copy from loading twice, while leaving
that file and unrelated standalone extensions untouched. Do not run the upstream
installer for deployment. `herdr integration status` only checks the standalone
path, not the package; its markers do not prove byte integrity or runtime delivery.
Update the vendored reporter deliberately with the Herdr pin, not via Bun updates.

Alerter is included in the macOS-only Homebrew bootstrap/update tasks. The
notification plugin remains uninstalled and unconfigured. See the
[notification audit](notification-research.md) for routing limitations and
[mise plugin-management research](plugin-management-research.md) for why one
small guarded bootstrap task is preferable to tool hooks or a new mise adapter.

The local authorized setup installed Herdr, created the config-file link, and
installed the official extension after confirming those destinations were absent.
Both profile settings were unchanged by installer execution. Fish/Pi checkout
links make repository edits visible to **new** shells/sessions; existing tmux/Pi
processes were not stopped or reloaded.

## Keymap

**P** means press and release **Ctrl+Space**. Alt letters below are unshifted.
Arrays in `config.toml` are alternative shortcuts, not action sequences.

| Direct | Prefix | Action |
| --- | --- | --- |
| Alt+H / L | P h / l | Previous / next tab |
| Alt+J / K | P j / k | Next / previous pane, wrapping in active-tab layout order |
| — | P arrows | Spatial pane focus |
| Alt+V / S | P v / s | Side-by-side / stacked split, following cwd |
| Alt+T | P t | Native new-tab naming dialog; Enter accepts |
| Alt+X | P x | Close pane (see confirmation caveat below) |
| Alt+I / O | P i / o | Reorder tab backward / forward |
| Alt+Tab | P Tab | Native last focused pane, including within the same workspace |
| Alt+W | P w | Native workspace navigation |
| Alt+E / P | P g | Searchable goto navigator (aliases, not separate pickers) |
| — | P Enter / [ | Copy mode |
| — | P r / z | Resize mode / zoom |
| — | P d | Detach to outer Fish |
| — | P ? | Native keybinding help |
| — | P Shift+O / Shift+S | Notification target / settings (moved inherited conflicts) |

Native non-conflicting shortcuts remain, including P c (new tab), P q (detach),
P Shift+Tab (previous pane), P Shift+N/W/D (new/rename/close workspace),
P Shift+T/X (rename/close tab), P b (sidebar), P 1–9 (tab jumps), and
P Shift+G (worktree). Native navigate/search/copy modes keep their own keys.
Explicit directional/cycle/notification/settings overrides preserve those actions
rather than relying on Herdr's silent suppression of shadowed native defaults.

**Close carefully:** `ui.confirm_close=true` is native, but ordinary pane and tab
closing is immediate in 0.8.2. Workspace closure asks for confirmation; closing
the last pane/tab of a parent worktree group can also prompt. It is not a universal
"protect every running job" confirmation. Use detach, not close, to keep work alive.

Copy mode: Ctrl+U/D half-pages, Ctrl+B/F pages, hjkl cursor movement, **single g/G**
top/bottom of retained history, v/y select/copy, /? search, q exit. No Alt+U/D
translation or first-press scrolling guarantee. PageUp/PageDown/wheel behavior
can depend on the pane application. Outside copy mode, Ctrl+U/D reach the app.

Accepted conflicts: direct Alt shortcuts take precedence over shell uses.
Ctrl+Space also conflicts with Fish's literal-space and Blink's manual completion
shortcuts; double prefix forwards literal Ctrl+Space. Ghostty and Blink were not
changed. Mac input-source shortcut entries 60/61 were inspected and both disabled;
physical Ghostty/Blink key delivery still needs a human check. Do not change OS
hotkeys automatically on another machine.

## Pi behavior and compatibility

Both profile `tuiMode: "fullscreen"` overrides and the four fullscreen-only viewport
key overrides were removed. The shared keybinding file stays a valid `{}`.
The installed Pi 0.85.1 documentation confirms omission defaults to regular.
Visual acceptance is **not** a gate for this decision. Rendering-only fallback:

```sh
pi --tui-mode fullscreen
```

The official extension enables only with `HERDR_ENV=1`, a socket, and a pane ID.
It reports session identity (absolute session path preferred, otherwise UUID),
working on agent start, and idle only on `agent_settled` when Pi is truly idle.
The unchanged reporter consumes `herdr:blocked`. Both profiles now also load
[`herdr-ui-prompts`](../../../pi-extensions/packages/herdr-ui-prompts/README.md),
which bridges Pi 0.85.1's native `ui_prompt_start/end` into one counted blocked
contribution. It handles instrumented extension dialogs, including the question
tool's `ui.custom`, and releases on completion/cancel/error or session shutdown.
Closing a prompt does not clear independent subagent attention. It is TUI/pane-only,
ignores child runtimes, and uses a generic label rather than exposing prompt text.
A pending custom loader/inspector is also a UI span; arbitrary shell/browser input
and uninstrumented built-in UI are not covered. Screen fallback remains suppressed
while the official reporter is authoritative.
There is no replacement for the old terminal-notifier/Ghostty AppleScript bridge.
Native done/idle attention and focus behavior need not match that bridge exactly.

A `ctx.mode === "tui"` gate keeps fresh RPC/JSON/print instances harmless even
when they inherit Herdr variables (RPC's `hasUI=true` alone is not a safe guard).
The committed pi.nvim pin `aa80d385471226ebfefffc44248f3e5a4149c7e7` was independently
retrieved: it launches `pi --mode rpc --no-session` via `vim.system`, with no tmux
dependency. This corrects the handoff's JSON description. The plugin, its mappings,
and lazy lock remain unchanged. Auto-session-name, statusline, all independent
packages, and work-only aidev-track remain.

## Validation evidence (2026-09-06)

| Check | Result |
| --- | --- |
| Baseline and post-migration `mise run validate` | Passed, including isolated Neovim, Pi package/host suites and exact work HTTP expected-failure |
| `mise run lock`; `mise run validate:locks` | Passed on this Mac; four-platform generated entries reviewed; Linux CI execution not run locally |
| Both explicit `mise --env … bootstrap plan` commands | Passed; plans only, no apply/bootstrap |
| Native `herdr config check` | Repository config validates via explicit `HERDR_CONFIG_PATH`; no preference snapshots or tests of Herdr's validator |
| Fish `config.test.py` | 6 tests passed, with nested/editor marker subcases, isolated HOME/PATH, fake executables, secret sentinel, one launch and shell return |
| Pi-package `integration.test.py "$(mise which pi)"` | 3 tests; bundled-byte equality, four profile/legacy loader cases and six mode/lifecycle cases; no profile × mode cross-product |
| Native Pi loader/runner/UI wrappers + captured socket fixture | Reporter and companion loaded once; mode guards, prompt answer/cancel/error, overlapping spans, independent attention, identity and simulated shutdown/start cleanup passed |
| Pi extension package CI | 146 tests passed, including 9 prompt-bridge unit cases; Bun frozen install passed without changing its lock |
| `git diff --check`; scoped reference/lock audit | Passed; no runtime state or unrelated lock/config changes |

The host fixtures use the **installed** Pi loader, event runner and prompt wrappers.
Agent/session hooks, dialog outcomes and transport are fixture-driven; a full
interactive `/reload`, rendered keyboard/abort behavior, notifications and live
agent focus remain manual acceptance. Installed Pi
settings, extensions, packages, keybindings, TUI, session, RPC, SDK docs and
applicable examples were read completely during the integration audit.

A disposable PTY trial with temporary HOME/config, named `trial` server, no secrets,
and update checks disabled passed: Fish startup creates one pane; prefix help,
side-by-side/stacked splits and new tab work; all four panes follow the source
shell's changed project cwd and inherit `HERDR_ENV=1`. A scratch-only popup
reported `HERDR_ENV=1` without a pane ID, and sourced Fish without autostart.
Injected Alt/prefix tab and pane navigation, wrapping pane cycling, and
Alt+Tab/P Tab last-pane passed. Detach returns to the outer Fish; reattach
retains terminal IDs and four harmless sleep jobs. Scratch-only server
stop/restart restored the two-tab, four-pane layout with **new** terminal IDs.
All scratch servers/jobs/clients ended. Initial trial failures were harness
assumptions: missing controlling PTY, a new-tab dialog needing Enter, and popup
keys being forwarded to the popup rather than detaching Herdr. The final trial
closed only its own popup via the native API before testing detach.
Successful local artifacts: `/private/tmp/hdr-2g51t_rl/`;
disposable driver: `/tmp/herdr-scratch-trial.py`.
These paths are ephemeral evidence, not dependencies.

### Remaining human acceptance

| Handoff trial | Status / next check |
| --- | --- |
| 1. Fresh Ghostty/Fish, splits/tabs/popups | Isolated PTY startup/splits/tabs/popups and changed-cwd following passed; actual Ghostty **not run** |
| 2. Physical keys, Blink, Alt/cycle/last-pane | Injected Ctrl+Space/help/split/tab/detach, Alt navigation, wrapping cycles and last-pane passed; physical keys and double-prefix Blink **not run** |
| 3. Copy/search/clipboard/pinned history | **Not run**; test single g/G, /?, v/y, Ctrl+U/D outside copy mode, and history while output continues |
| 4. Regular Pi streaming/output/resize/flashing | **Not run**; compare identical runs with `pi --tui-mode fullscreen`; original flashing bug is not claimed fixed |
| 5. Visible official agent lifecycle/focus/notifications | Fixtures passed; real active/needs-input/completed agent and navigator focus **not run** |
| 6. Detach/reattach and restoration | Passed in isolated PTY scratch runtime only; no live user process survival/restoration trial |
| 7. SSH/thin client | **Not run**; no remote host was authorized or provisioned |

For GUI acceptance, open a fresh Ghostty window, use P ? to review the map, then
create scratch splits/tabs. Run a harmless output loop and a regular Pi session;
test navigation, copy/search/clipboard, streaming, tool output, resizing and
returning to current output. In Neovim insert mode, check double-prefix completion.
Use native goto to focus another agent and observe supported state transitions.
Detach and reattach rather than closing the scratch job. Do not stop the user's
server to test restoration; use a separately named scratch runtime only.

For an explicitly authorized SSH host: verify versions first; test Ctrl+Space,
Alt navigation/last-pane, copy/search, available clipboard/OSC52 behavior, detach,
connection loss and reattach with a harmless job. Document client/remote clipboard
limitations. No remote installation or provisioning is implied by this checklist.

## Reference audit, rollback and optional cleanup

No surviving managed consumer needs sesh, the custom tmux package, retired picker/
focus helpers, or terminal-notifier. Remaining first-party mentions are this
migration history, the intentional Fish coexistence guard/tests, a negative
retired-resource assertion, and the preserved `tmux` commit scope in `AGENTS.md`
and `commitlint.config.ts`. Dependencies/caches and vendored third-party material
are outside the active configuration audit; they are not pruned for word matches.

Local `~/.config/tmux` and `~/.config/sesh` still point to their now-retired checkout
directories. They were deliberately left alone. After all old sessions are no
longer needed, inspect `ls -ld`/`readlink` and optionally unlink **only those exact
stale symlinks**, never recursively remove a directory. Installed binaries and
`${XDG_STATE_HOME:-~/.local/state}/pi/tmux-sessions/` historical state remain.
Stopping sessions, deleting that state, or uninstalling binaries requires a
separate explicit cleanup decision.

For rendering problems, use the per-launch fullscreen fallback above. For a full
migration rollback, first preserve the current diff (including new untracked files)
and review it against the baseline commit. Restore **only migration-owned hunks**
and retired files from Git; do not reset the worktree or revert unrelated work.
Restoring the Fish config affects new shells; it does not stop existing Herdr or
tmux processes. For package rollback, restore the package manifest/profile filters
together; review the legacy standalone exclusion before enabling any old copy.
Unlink the new config-file link only after verifying ownership; keep Herdr runtime
state intact.
Do not invoke the upstream uninstaller blindly: it removes the destination without
an ownership check. No commit was made by this implementation.

## Sources

Release-scoped source takes precedence over advancing public docs:

- [Herdr v0.8.2 release](https://github.com/herdrdev/herdr/releases/tag/v0.8.2), annotated tag resolving to commit `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`.
- [Config model/defaults](https://github.com/herdrdev/herdr/blob/v0.8.2/src/config/model.rs) and [binding resolution](https://github.com/herdrdev/herdr/blob/v0.8.2/src/config/keybinds.rs).
- [Pane environment](https://github.com/herdrdev/herdr/blob/v0.8.2/src/pane.rs) and [nesting guard](https://github.com/herdrdev/herdr/blob/v0.8.2/src/main.rs).
- [Official installer](https://github.com/herdrdev/herdr/blob/v0.8.2/src/integration/targets.rs) and [Pi integration](https://github.com/herdrdev/herdr/blob/v0.8.2/src/integration/assets/pi/herdr-agent-state.ts).
- [Native key actions/closing](https://github.com/herdrdev/herdr/blob/v0.8.2/src/app/input/navigate.rs) and [copy mode](https://github.com/herdrdev/herdr/blob/v0.8.2/src/app/input/copy_mode.rs).
- [Committed pi.nvim RPC launch](https://github.com/pablopunk/pi.nvim/blob/aa80d385471226ebfefffc44248f3e5a4149c7e7/lua/pi/init.lua).
