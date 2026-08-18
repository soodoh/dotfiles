# Nix-to-mise parity ledger

This ledger records the final mise-based behavior after the repository simplification. Canonical mechanisms are:

1. native mise tools and locks;
2. native bootstrap packages, dotfiles, defaults, LaunchAgents, and login shell;
3. concise mise tasks for lifecycle composition;
4. colocated tests for maintained code and configuration;
5. explicitly accepted manual behavior.

The only supported profiles are `personal-macos` and `work-macos`. There is no inferred or default profile.

## Configuration and lifecycle

| Behavior | Final mechanism |
|---|---|
| Shared layer plus profile overlays | `mise.toml` plus `mise.personal-macos.toml` or `mise.work-macos.toml` |
| Explicit profile selection | Inline `pre-packages` guard rejects profile-less bootstrap |
| Installation and convergence | Native `mise bootstrap` |
| Declarative status | `mise bootstrap status --missing` through `mise run status` |
| Repository validation | Native mise parsing/planning plus colocated tests |
| Explicit updates | One grouped `mise run update` task |
| Rollback | Git revert followed by explicit-profile bootstrap |
| Atomic generations and immutable closures | Intentionally dropped |

Normal bootstrap adds or reconciles declared state without pruning undeclared software or broadly upgrading installed applications.

## Tools and packages

Portable runtimes, command-line tools, LSPs, formatters, and linters remain exact mise tools in `mise.toml`. Linux-compatible tools remain in the common layer; macOS packages remain platform-scoped.

Profile-only tools include:

| Tool | Profile | Mechanism |
|---|---|---|
| AWS CLI | personal | aqua tool |
| Azure CLI | work | pipx tool |
| Azure MCP | work | exact mise npm tool |
| Azure DevOps MCP | work | exact mise npm tool |
| Figma MCP | work | exact mise npm tool |
| Kusto MCP | work | exact mise npm tool |
| Google Cloud CLI | work | bootstrap cask |
| Snowflake CLI | work | missing-only inline Homebrew task |
| TWG | work | checksummed HTTP tool with manual metadata updates |

The former work MCP npm package and transitive lock were removed. Exact top-level npm tool pins and mise locks are accepted as sufficient reproducibility.

## Homebrew native gap

AeroSpace, SketchyBar, Borders, and Snowflake CLI come from taps that do not publish the API metadata required by mise's native bootstrap package fetcher. A short inline task provisions the Homebrew CLI when necessary and keeps these packages as missing-only Homebrew installs rather than restoring a standalone script.

All other supported system packages, casks, fonts, and App Store applications use `[bootstrap.packages]` directly.

## Dotfiles

The source tree is semantic rather than shaped like `$HOME`:

```text
dotfiles/
├── common/
├── macos/
├── personal/
└── work/
```

Mise dotfile declarations map these sources to their actual destinations. Common Fish, Neovim, tmux, Pi, and CLI configuration remains portable. AeroSpace, SketchyBar, and Colima remain macOS-only.

Profile Pi files and workflows remain writable links into the checkout. Runtime changes may dirty tracked files by design.

## Skills

Each profile now owns one complete `agents/` directory:

```text
dotfiles/personal/agents/{.skill-lock.json,skills/}
dotfiles/work/agents/{.skill-lock.json,skills/}
```

The seven personal skills are duplicated from the work catalog where shared. This intentionally trades repository size for independent catalogs, one dotfile mapping per profile, and removal of lock filtering and generation scripts.

## Pi extensions

`pi-extensions/` remains a real local package with a committed Bun lock because its TypeScript sources and runtime dependencies are maintained in this repository. Bootstrap runs its `bun ci` command through a mise task.

The package manifest now lists all extension, skill, and prompt resources explicitly. Dependency-resource aggregation and its generator were removed. Pi, tmux, workflow, and expected-failure security tests remain colocated with their maintained files.

## macOS applications and services

| Behavior | Final mechanism |
|---|---|
| Google Calendar web app | Chrome-installed PWA with a Chrome-managed app shim; intentionally user-owned |
| Login shell | Native `[bootstrap.user]` |
| macOS defaults | Native mise defaults declarations |
| AeroSpace | Native mise LaunchAgent |
| SketchyBar | Started by AeroSpace `after-startup-command` |
| Borders | Native mise LaunchAgent |
| Colima | Native mise LaunchAgent plus linked configuration |
| Dock ordering and Downloads stack | User-owned; no longer automated |
| Login items | User-owned; no longer automated |
| Running tmux refresh | Dropped; new sessions inherit current state |
| Work CA readability preflight | Dropped; consuming tools report missing certificates naturally |

Mise owns only its `dev.mise.*` LaunchAgents. MDM-owned work applications and settings remain outside repository management.

## Validation and CI

`mise run validate` performs:

- config parsing, task validation, and bootstrap planning for both profiles;
- Fish and shell syntax checks;
- the locked Pi extension package suite;
- tmux and work workflow tests;
- the documented work cleartext-HTTP expected-failure check;
- isolated Neovim loading and parser/tool validation;
- colocated Colima and SketchyBar tests;
- Git whitespace validation.

CI installs bounded dependencies on ephemeral macOS and Ubuntu runners but never runs a workstation bootstrap, changes a login shell, loads services, or installs GUI/App Store applications.

## Removed custom-script behaviors

The top-level `scripts/` directory was deleted. Its former responsibilities were resolved as follows:

- replaced by native mise: bootstrap sequencing, status, login shell, taps where compatible, LaunchAgents, package upgrades, dotfile application, and configuration planning;
- represented directly in TOML tasks: local `bun ci`, grouped updates, expected-failure orchestration, and the tapped Homebrew native gap;
- colocated as tests: Neovim, Pi, tmux, workflow, Calendar, Colima, and SketchyBar checks;
- intentionally dropped: Dock/login-item reconciliation, tmux live refresh, CA preflight, generated skill filtering, generated Pi resource aggregation, and automatic TWG metadata rewriting.
