# mise development environments

This repository is the canonical configuration for two explicit macOS profiles:

- `personal-macos`
- `work-macos`

The shared mise layer owns pinned runtimes, portable tools, common dotfiles, macOS defaults, packages, LaunchAgents, and lifecycle tasks. Each profile owns its identity, Pi configuration, complete agent skill catalog, applications, and credential policy.

## Prerequisite

Install mise using the [official instructions](https://mise.jdx.dev/getting-started.html), clone this repository, and trust it:

```bash
git clone https://github.com/soodoh/dotfiles.git
cd dotfiles
mise trust
```

Copy backed up age profile from Bitwarden, then save:
```bash
pbpaste > ~/.config/mise/age.txt
```

There is no default profile. Always select one explicitly:

```bash
mise --env personal-macos run status
MISE_ENV=personal-macos mise bootstrap

# Or on the work Mac:
mise --env work-macos run status
MISE_ENV=work-macos mise bootstrap
```

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
MISE_ENV=personal-macos mise bootstrap
```
