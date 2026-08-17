# mise development environments

This repository is the canonical configuration for two explicit macOS profiles:

- `personal-macos`
- `work-macos`

The shared mise layer owns pinned runtimes, portable tools, common dotfiles, macOS defaults, packages, LaunchAgents, and lifecycle tasks. Each profile owns its identity, Pi configuration, complete agent skill catalog, applications, and credential policy.

> [!WARNING]
> Machine bootstrap is experimental. Rollback is a Git revert followed by another explicit bootstrap; there are no atomic generations.

## Prerequisite

Install mise using the [official instructions](https://mise.jdx.dev/getting-started.html), clone this repository, and trust it:

```bash
git clone https://github.com/soodoh/dotfiles.git
cd dotfiles
mise trust
```

There is no default profile. Always select one explicitly:

```bash
mise --env personal-macos run status
mise --env personal-macos bootstrap

# Or on the work Mac:
mise --env work-macos run status
mise --env work-macos bootstrap
```

An inline pre-package guard rejects a profile-less bootstrap. Normal bootstrap installs missing state without pruning undeclared software or broadly upgrading existing applications.

## Layout

```text
dotfiles/
├── common/    # portable Fish, Neovim, tmux, Pi, and CLI config
├── macos/     # AeroSpace, SketchyBar, and Colima
├── personal/  # personal identity, Pi config, and complete agent catalog
└── work/      # work identity, Pi config, complete agent catalog, and apps
```

Other canonical files:

- `mise.toml` — shared tools, bootstrap declarations, dotfiles, and tasks
- `mise.personal-macos.toml`, `mise.work-macos.toml` — profile differences
- `mise*.lock` — exact tool versions and checksums where supported
- `pi-extensions/` — repository-local Pi package with a committed npm lock
- `docs/migration-parity.md` — behavior and accepted-tradeoff ledger
- `docs/cutover.md` — workstation cutover procedure

There is intentionally no `packages/` container or top-level `scripts/` directory.

## Bootstrap behavior

Mise natively manages:

- system packages, casks, and App Store applications;
- dotfile symlinks;
- macOS defaults;
- the Fish login shell;
- AeroSpace, Borders, and Colima LaunchAgents;
- pinned language runtimes and command-line tools.

AeroSpace starts SketchyBar through `after-startup-command`, avoiding a service-order wrapper.

Four tapped Homebrew packages do not publish the API metadata required by mise's native package bootstrap. A small inline, missing-only task provisions the Homebrew CLI when necessary, then installs AeroSpace, SketchyBar, Borders, and the work Snowflake CLI through Homebrew. This is the only bootstrap native-gap logic.

Dock ordering and login items are intentionally user-owned. Bootstrap also no longer refreshes running tmux sessions or preflights the work CA file; new processes consume the declared environment naturally.

## Dotfiles and secrets

Mise links declared files directly into this checkout. Pi settings, workflows, and `~/.agents` are writable symlinks, so runtime tools may dirty tracked files. Review those changes with Git and commit or revert them deliberately.

Each profile owns a complete `agents/` directory containing `skills/` and `.skill-lock.json`. Shared skills are duplicated intentionally so profile updates do not require filtering or generation scripts.

Keep secrets outside the repository in:

```text
~/.config/fish/conf.d/00-secrets.fish
```

Authenticate App Store, GitHub, AWS/Azure/Google/Snowflake CLIs, Pi providers, MCP services, and TWG interactively. The work CA environment variables remain declared, but certificate existence is not preflighted.

## Pi and MCP

Pi is pinned through mise's npm backend. Bootstrap runs `npm ci` in `pi-extensions/`; its `package.json` explicitly lists local and dependency-provided extensions, skills, and prompts.

Work MCP servers are also direct mise npm tools:

- `@azure-devops/mcp`
- `figma-developer-mcp`
- `kusto-mcp`

Their executables are exposed by mise without a repository-local package or custom PATH entry. Exact top-level versions are locked; npm transitive dependency locking is an accepted tradeoff.

The work LiteLLM endpoint remains cleartext HTTP by explicit owner decision. Validation preserves the expected-failure security test until that endpoint supports TLS.

## Validation

Run the non-destructive native checks and colocated tests:

```bash
mise run validate
```

The suite parses and plans both profiles, checks shell syntax, runs the Pi package suite, exercises tmux and work workflow tests, verifies the expected work security failure, runs Neovim in an isolated environment, and executes colocated macOS configuration tests. CI never runs a workstation bootstrap.

## Updates

Updates remain explicit and grouped:

```bash
mise --env personal-macos run update
mise --env work-macos run update
```

The task updates mise tools, Pi dependencies, the active profile's skills, Neovim plugins, native bootstrap packages, and tapped Homebrew packages. TWG's versioned URLs and checksums are edited manually because its HTTP distribution has no native version metadata source.

## Rollback and cutover

Revert the configuration commit and bootstrap the same explicit profile again:

```bash
git revert <commit>
mise --env personal-macos bootstrap
```

Runtime and application data are not rolled back. Follow [`docs/cutover.md`](docs/cutover.md) before removing the previous machine manager.
