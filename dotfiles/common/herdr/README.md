# Herdr configuration and operation

## Installation and ownership

```sh
mise install aqua:herdrdev/herdr
mise run bootstrap:pi
```

The declared Aqua registry backend is `aqua:herdrdev/herdr`; `mise.toml` owns its
version and `mise.lock` owns release-asset checksums for Linux/macOS x64/arm64.

Only `~/.config/herdr/config.toml` links into this checkout. Never link the
whole directory: sockets, session snapshots, logs, plugins, and optional history
are runtime data. The existing native cwd policy is `follow`. Native restoration
and 10,000,000-byte scrollback defaults remain; optional `experimental.pane_history`
is disabled by default. Restored layouts/native agent conversations do **not**
mean arbitrary old processes survive a server restart.

The locally maintained [`agent-state`](../../../pi-extensions/packages/agent-state/README.md)
extension owns Pi lifecycle reporting to Herdr and Moshi. The Herdr adapter derives
from the official revision **8** reporter, with its license and provenance retained;
it is no longer an unmodified vendored asset. Both profiles deploy it through the
existing Pi-package symlink. An ownership-safe adapter consumes upstream's
versioned host-liveness protocol independently of Herdr, without a dependency patch.

Both profiles exclude `extensions/herdr-agent-state.ts` and `extensions/moshi-hooks.ts`.
This prevents generated hooks from reporting alongside our adapters without
removing those files or affecting unrelated extensions. Reconcile dependencies
with `bun install --cwd pi-extensions --frozen-lockfile`, then `/reload`. Do not run
a workstation bootstrap or upstream integration installer for this change.
`herdr integration status` checks the excluded standalone path, not our package.

## Notification plugin provisioning

`bootstrap:herdr-plugins` manages both `fullerzz/herdr-plugin-sesh` (Linux/macOS)
and `yankewei/herdr-focus-notify` (macOS only). Both macOS profiles run it after
the native mise package phase supplies the declared alerter formula. Desired full SHAs are
`vars.herdr_sesh_ref` and `vars.herdr_focus_notify_ref` in `mise.toml`.

- Bootstrap reconciles to the exact committed SHA, using Herdr's own
  `plugin install --ref <SHA> --yes` for absent plugins or healthy managed
  installations at a different pin. Matching healthy installations are no-ops,
  with no network/build. Reconciliation never resolves the latest upstream version.
- `mise --env personal-macos run update:herdr-plugins` (or `work-macos`) remains
  a plugin-only entry point with the same reconciliation behavior. The grouped
  `update` includes it after native package updates.
- An explicit profile is required on macOS. Linux manages only Sesh; no notifier
  dependency checks or installation run there.
- Disabled, linked/foreign, dirty, orphaned or broken installations fail even
  during update. They are never silently repaired or re-enabled.
- Healthy manual release installs can be adopted without rebuilding: Git HEAD
  and registry commit must equal the desired SHA, and the requested release must
  match the manifest version. Herdr does not retain local tag refs.
- `mise run update:herdr-plugin-pin` resolves both upstream `refs/heads/main`
  branches to full SHAs. The weekly repository-updates workflow proposes changes
  in its existing PR; it does not build/install/execute either plugin. This tracks
  reviewed main commits, not just releases. Review the upstream comparisons before
  merging, then pull and run `MISE_ENV=<profile> mise bootstrap` (or the plugin-only
  `mise --env <profile> run update:herdr-plugins`).

`plugin.py` reads the registry strictly (Herdr's offline list can mask corruption),
checks ownership, paths, Git HEAD/cleanliness, manifest ID and executable presence,
and delegates all installation/registration to Herdr. It does not write registry,
plugin config or learned state itself. Colocated behavioral tests cover both
plugins using disposable Git repositories and mocked installation, not upstream code.
The notifier requires Git, Cargo, alerter and Xcode Command Line Tools; Sesh requires
Git and Go >=1.26.4 (the shared mise pin satisfies this).
Do not run these tasks concurrently with manual plugin mutations. Checks are not
binary integrity verification; ignored build outputs are allowed. The notifier's
upstream build still lacks `--locked`. `--yes` approves executing pinned build code.
Applying a changed pin during bootstrap or update therefore runs upstream build
code and can upgrade or roll back the plugin, including after reverting a pin.

Test notification routing in a single window: clicks activate an app and focus
a Herdr pane, not necessarily the originating Ghostty window/client. To avoid
duplicate native desktop notifications, choose `[ui.toast] delivery = "herdr"`
(internal-only) or `"off"` when enabling the plugin. macOS notification permissions
require manual configuration.

## Sesh workspace picker

Alt+E opens `fullerzz/herdr-plugin-sesh` as a 90% session-modal popup through
`plugin pane open`. This bypasses the plugin action's temporary overlay pane so
workspace selection cannot leave native `last_pane` pointing at a pane that has
already exited. `$HERDR_BIN_PATH` ensures the detached custom command uses the
same Herdr binary and socket. Native `goto` is unbound.
Provision on macOS through mise (substitute `work-macos` as appropriate):

```sh
mise install cargo:eza
mise --env personal-macos run bootstrap:herdr-plugins
```

On Linux, `mise run bootstrap:herdr-plugins` installs only Sesh. Normal workstation
bootstrap includes this task; no separate manual Herdr installation is needed.
`eza` is pinned via Cargo because upstream does not publish macOS binaries; mise
already owns Rust, Go, zoxide and fzf. If a stale local `cargo-binstall` shim prevents
installation, use `MISE_CARGO_BINSTALL=false mise install cargo:eza` to build from source.

No plugin config is needed: running workspaces and zoxide history populate the
picker; `eza` supplies the default directory preview. fzf is optional for the
experimental picker, not required for the default native picker. The Yazi and
LazyGit launchers already use true popups and likewise stay out of pane focus
history.
Plugin checkouts/config/history stay in Herdr's runtime directory, not this repo.
After changing the binding, reload Herdr with Ctrl+Space, then Shift+R.
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
| Alt+E | — | Sesh workspace/session picker |
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

The shared [`agent-state`](../../../pi-extensions/packages/agent-state/README.md)
extension reports parent activity, pending continuations, subagent liveness and
completion delivery, native prompt spans, and independent counted external
busy contributions. Its Herdr adapter requires `HERDR_ENV=1`, a socket and
pane ID; its Moshi adapter also works outside Herdr. Native parent prompts take
precedence over work. Missing subagent evidence retains working
state instead of guessing completion. Initial idle waits for all restoration
handlers; teardown never manufactures completion.

The former `herdr-ui-prompts` companion is consolidated here. Native spans include
the question tool's `ui.custom` and custom loaders/inspectors. Arbitrary
shell/browser input and uninstrumented built-in UI are not covered. Neither
adapter sends prompt titles or sibling labels. Anonymous `herdr:blocked` events
are ignored, including third-party legacy blockers. A child asks its supervisor;
only when the parent opens a native prompt does either adapter signal human input.
The notification plugin's explicit `blocked`/`done` filter is unchanged.
The macOS notification plugin supplies app activation and Herdr-pane focus, not
exact parity with the old terminal-notifier/Ghostty-window AppleScript bridge.

A `ctx.mode === "tui"` gate keeps fresh RPC/JSON/print instances harmless even
when they inherit Herdr variables (RPC's `hasUI=true` alone is not a safe guard).
The committed pi.nvim pin `aa80d385471226ebfefffc44248f3e5a4149c7e7` was independently
retrieved: it launches `pi --mode rpc --no-session` via `vim.system`, with no tmux
dependency. This corrects the handoff's JSON description. The plugin, its mappings,
and lazy lock remain unchanged. Auto-session-name, statusline, all independent
packages, and work-only aidev-track remain.

## Manual validation

Automated fixtures do not establish rendered keyboard behavior, GUI notification
routing, or live session restoration. After relevant changes:

- Open a fresh Ghostty window and use P ? to review the map. In scratch splits
  and tabs, check cwd following, Alt navigation, pane cycling, last-pane focus,
  popups, and physical Ctrl+Space delivery. Check double-prefix completion in
  Neovim insert mode and key delivery in Blink when used.
- Test copy/search/clipboard, single g/G, v/y, Ctrl+U/D outside copy mode, and
  history while output continues.
- Run a regular Pi session; check streaming, tool output, resizing, and supported
  agent state transitions and notification focus. Compare rendering with
  `pi --tui-mode fullscreen` if needed; prior fixtures do not prove flashing fixed.
- Detach and reattach with a harmless job. Test server restoration only in a
  separately named scratch runtime, never by stopping the user's server.
- On an explicitly authorized SSH host, check keys, clipboard/OSC52 limitations,
  connection loss and reattach. This checklist does not authorize provisioning.

## Unmanaged legacy state

Bootstrap does not prune old tmux/sesh links, installed binaries, running sessions,
or `${XDG_STATE_HOME:-~/.local/state}/pi/tmux-sessions/` history. If
`~/.config/tmux` or `~/.config/sesh` still links to a retired checkout directory,
inspect ownership and wait until old sessions are no longer needed before
unlinking only that exact stale symlink. Never recursively delete a directory.
Stopping sessions, deleting history, or uninstalling binaries requires a separate
explicit decision. Keep Herdr runtime state intact; the upstream uninstaller
removes its destination without an ownership check.

## Sources

The v0.8.2 references below underpin the version-specific behavior notes above.
Check the release declared in `mise.toml` before relying on those details:

- [Herdr v0.8.2 release](https://github.com/herdrdev/herdr/releases/tag/v0.8.2), annotated tag resolving to commit `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`.
- [Config model/defaults](https://github.com/herdrdev/herdr/blob/v0.8.2/src/config/model.rs) and [binding resolution](https://github.com/herdrdev/herdr/blob/v0.8.2/src/config/keybinds.rs).
- [Pane environment](https://github.com/herdrdev/herdr/blob/v0.8.2/src/pane.rs) and [nesting guard](https://github.com/herdrdev/herdr/blob/v0.8.2/src/main.rs).
- [Official installer](https://github.com/herdrdev/herdr/blob/v0.8.2/src/integration/targets.rs) and [Pi integration](https://github.com/herdrdev/herdr/blob/v0.8.2/src/integration/assets/pi/herdr-agent-state.ts).
- [Native key actions/closing](https://github.com/herdrdev/herdr/blob/v0.8.2/src/app/input/navigate.rs) and [copy mode](https://github.com/herdrdev/herdr/blob/v0.8.2/src/app/input/copy_mode.rs).
- [Committed pi.nvim RPC launch](https://github.com/pablopunk/pi.nvim/blob/aa80d385471226ebfefffc44248f3e5a4149c7e7/lua/pi/init.lua).
