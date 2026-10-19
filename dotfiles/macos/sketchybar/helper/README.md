# Sketchybar helper

The macOS-only Swift executable owns right-side sections, display/notch layout,
click guards, AI-usage items, and cached account/statistics popups. Unrelated
workspace, front-app, and system-metric plugins remain unchanged.

## Responsibilities

- `Usage.swift`: decodes the shared TypeScript CLI's sanitized JSON, formats
  popup rows, and invokes that CLI through the installed native mise profile.
  It never parses credentials, contacts providers itself, or consumes credits.
- `Controller.swift`: the single right-section declaration and native item
  lifecycle. Updates existing objects without closing hovered popups; removes
  obsolete children before parents. Maps stable display IDs to arrangement IDs.
- `Native.swift`: AppKit safe areas and CoreText glyph sizing. Chooses the largest
  fitting font, then proportionally bounded scrolling for combined usage.
- `Runtime.swift`: typed Sketchybar queries, argv-based subprocesses, and bounded
  diagnostics. `BarClient` is the process seam used by both native and fake tests.
- `Entry.swift`: event dispatch. `popup` only sets drawing on an existing item;
  it never queries provider data, invokes mise/Bun, or compiles anything.

Provider discovery, fetching, caching, and compact usage semantics remain in
`pi-extensions/packages/statusline`. Pi's renderer is not involved in this helper.
The CLI's optional `copilot` object renders as its own hoverable item alongside
proxy accounts; `directText` excludes that separately rendered badge. Copilot's
popover labels credits versus legacy requests, shows reported quota/reset/overage
details, and distinguishes account quotas from organization pools. Unknown,
unlimited, stale, and expired data stay explicit. Hover only toggles cached rows,
including when usage is unavailable; it never triggers another provider read.

## Build and run

Requires macOS Command Line Tools (`xcrun swiftc`), not full Xcode, SwiftPM,
third-party Swift packages, Python, or jq. Build/cache logic lives in one small
shell launcher; runtime and tests are Swift.

```sh
# Build only if sources changed; prints the executable path.
bash dotfiles/macos/sketchybar/helper/build.sh

# Setup is invoked by sketchybarrc, not during repository validation.
# Subsequent events run the cached executable directly:
"${XDG_CACHE_HOME:-$HOME/.cache}/sketchybar/sketchybar-helper" refresh
"${XDG_CACHE_HOME:-$HOME/.cache}/sketchybar/sketchybar-helper" layout
```

`sketchybarrc` builds once at startup/reload. Compilation uses a temporary file
and atomic replacement, so a failed build leaves the previous binary intact.
After source edits, rebuild and refresh (or reload Sketchybar). Scripts capture
only the binary/config paths and theme colors, never credentials. The normal
five-minute shared provider TTL still applies to explicit refreshes.

`refresh` resolves Bun through its configured path or mise, then uses native
`mise exec` profile discovery when `miserc.toml` exists. It does not infer a user
or default profile, run Fish, or install tools. Only the child receives mise's
secrets/proxy environment. Failed CLI/JSON reads preserve current items and
record bounded diagnostics under `~/.cache/sketchybar/ai-usage.log`.

## Tests

```sh
# Fast, isolated checks. No live bar access, pointer events, or network calls.
bash dotfiles/macos/sketchybar/helper/build.sh test

# Opt in against an already-running, refreshed bar.
SKETCHYBAR_LIVE_TESTS=1 bash dotfiles/macos/sketchybar/helper/build.sh test
```

Tests compile the production source with a small throwing-assertion runner;
no separately installed test framework or XCTest/Xcode is required. Fixtures
exercise meaningful behavior through the real renderer and process seam:
formatting/freshness, Copilot billing units and quota expiry, unknown vs zero
balances, item reuse/removal, independent
hover targets, native width composition, scrolling/recovery, display reassociation,
per-display guard extents, native mise invocation, failure preservation, and cleanup.

Live checks use the same native APIs directly, with no embedded Swift/Python
probes. They verify actual glyph containment, event delivery, popup geometry,
refresh/reflow while hovering, and notch overflow/recovery. Input checks require
existing permission (never request it), restore the pointer and timers on exit,
and skip notch checks without a notched display. CI runs only the fast checks;
the mise macOS validation task gates the Swift checks on Darwin.
