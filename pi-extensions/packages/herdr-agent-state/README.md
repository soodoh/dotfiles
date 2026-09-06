# Official Herdr Pi integration

`index.ts` is an **unmodified vendored copy** of Herdr's official Pi reporter,
not a custom integration. This repository owns deployment and version updates.

- Herdr release: **0.8.2**; integration revision: **8**.
- Upstream commit: `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`.
- [Original source](https://github.com/herdrdev/herdr/blob/9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c/src/integration/assets/pi/herdr-agent-state.ts).
- SHA-256: `9b1c41cd72520fc2abe5f2a2aec995c12a926cce844df472c7fd5fcae4f4dbfa`.
- [Upstream license](https://github.com/herdrdev/herdr/blob/9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c/LICENSE): Apache-2.0; copied in `LICENSE`.

## Deployment

The local Pi package manifest exposes this extension, and both profile filters
select it. Mise's existing `~/.pi/agent/pi-extensions` symlink supplies the package;
`bootstrap:pi` only installs Bun dependencies. There is no integration installer
or separate extension-file symlink.

Both profiles explicitly disable `extensions/herdr-agent-state.ts` through Pi's
`-path` resource filter. This prevents an old upstream-installed copy from loading
alongside the package without deleting or overwriting user files. Other standalone
extensions remain enabled. Existing Pi processes are not automatically reloaded.

Do **not** run `herdr integration install pi` for normal deployment. It writes a
second, excluded file. `herdr integration status` checks that legacy destination,
not this package: it may say missing, or report the stale copy's version. It does
not establish whether the package reporter loaded or delivered events.

## Maintenance and tests

Update this copy deliberately alongside the Herdr pin: review the release-scoped
source/license, copy the official file byte-for-byte, update the provenance and
checksum here, then run `mise run validate:agents`.
Bun dependency updates do not refresh vendored code. The upstream header still
says “installed by herdr”; it is retained for exact source equality, not ownership.
Biome excludes only `index.ts` to avoid formatting/lint-driven upstream drift.

`integration.test.py` compares the bytes with the asset extracted by the installed
Herdr binary **in a temporary HOME only**. Four loader cases exercise both profile
filters, with and without an excluded legacy copy and with an unrelated standalone
extension. Six mode/lifecycle cases then run once, rather than per profile/home.
The colocated host fixture uses the installed event runner and UI wrappers with
injected dialog promises and captured socket transport. Agent/session lifecycle
hooks are driven by the fixture, including shutdown/start cleanup (not a complete
interactive `/reload`). It checks mode silence, session identity, working/idle,
prompt completion/cancel/error, overlapping waits and independent attention.
The upstream file is excluded from Vitest coverage; the companion's own unit tests
are included and existing coverage thresholds remain unchanged.

The reporter requires `HERDR_ENV=1`, `HERDR_SOCKET_PATH`, and `HERDR_PANE_ID`.
It still consumes explicit `herdr:blocked` signals. The separately loaded
[`herdr-ui-prompts`](../herdr-ui-prompts/README.md) companion now translates Pi's
native prompt events into these signals without changing this upstream file.
See [Herdr acceptance](../../../dotfiles/common/herdr/README.md) and
[notification research](../../../dotfiles/common/herdr/notification-research.md).
