# Development environment automation

`site.yml` converges one local machine. OS and profile differences are data and role branches, not duplicated playbooks.

## Composition

| Target | Package inheritance | Stow packages |
| --- | --- | --- |
| Personal macOS | shared + macOS + personal | `unix-configs`, `mac-configs`, `personal` |
| Work macOS | shared + macOS + personal + work | `unix-configs`, `mac-configs`, `work` |
| Arch | shared + Arch + personal | `unix-configs`, `personal` |
| Debian 13+ | shared + Debian + personal | `unix-configs`, `personal` |

Set `ENABLE_SWAY=1` when applying a Linux profile to also stow `sway-configs`.

## Source of truth

`vars/catalog.yml` contains logical tools and their per-platform install mappings. Add shared intent once, then map it to Brew, APT, Pacman, Bun, Cargo, Go, uv, or an idempotent installer.

Normal applies upgrade managed dependencies. Arch uses a full system upgrade; Debian and macOS upgrade only declared packages.

## Drift and cleanup

Every apply writes:

- `~/.local/state/dotfiles-ansible/desired-state.json`
- `~/.local/state/dotfiles-ansible/audit.json`

The audit compares explicitly installed/top-level packages rather than dependency closure. macOS application records use bundle ID and installation source.

Cleanup commands always rerun convergence and audit, display a fresh plan, and require typing `CLEAN`. Package-manager-owned extras are uninstalled; unmanaged non-Apple application bundles are moved to Trash. Vendor support files and privileged helpers may remain. Go tools stay report-only.

APT/Pacman/system prerequisites and Apple system applications are protected. Review the complete plan even with those safeguards.

## Validation

Run `./bin/validate-ansible`. GitHub Actions validates the personal macOS, work macOS, Arch, and Debian catalog combinations, syntax, lint, and audit parser tests.
