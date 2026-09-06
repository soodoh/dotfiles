# Herdr plugin management with mise

## Recommendation

**Use mise's existing bootstrap task facility, with one small macOS-only guarded task calling `herdr plugin install`.** Keep Herdr 0.8.2 and Rust in `[tools]`; keep Git and other host dependencies in their existing platform-scoped provisioning. No custom mise backend, package-manager plugin, second checkout manager, or new orchestration layer is warranted for one Herdr plugin.

The precise answer to “is there a native mechanism?” is: **mise has native extension-management infrastructure (`[bootstrap.plugins]` plus `[bootstrap.packages]`), but no built-in Herdr manager in the reviewed release.** No maintained Herdr-specific mise adapter was identified in the reviewed primary materials; this is not an exhaustive claim about every third-party repository. The upstream Herdr notifier repository is a **Herdr plugin**, not itself a mise package-manager plugin. Declaring its URL under `[bootstrap.plugins]` does not adapt it automatically. [1][2]

## What was verified, versus documented

Read-only installed checks returned `2026.9.1 macos-arm64 (2026-09-02)`. `mise --no-config --no-env --no-hooks backends ls` lists `cargo`, `github`, and `aqua`, **not `git` or `herdr`**. Installed `bootstrap --help`, `bootstrap plugins --help`, `bootstrap packages --help`, and `run --help` confirm native repos, package plugins, final bootstrap task, and source/output task freshness facilities. These are **capability/help checks, not execution tests**.

Fetched primary docs from upstream `main`, and version-tagged mise source/docs where lifecycle semantics matter. Current web docs can describe newer behavior: for example, current Aqua docs discuss a newer backend priority system; no such priority claim is needed here. Package-plugin infrastructure and the distinction between project/tool postinstall are corroborated by **v2026.9.1** materials. Herdr behavior was inspected in `/tmp/herdr-audit-082`, plus the notifier's immutable manifest. No installs, builds, task execution, bootstrap execution, live Herdr queries, or runtime changes were performed. [1–7]

## Comparison

| Mechanism | What it manages | Why it does / does not fit |
| --- | --- | --- |
| `cargo:` | Rust CLI binaries in mise's versioned install directory; supports Git tag/branch/revision sources. | A declaration such as `"cargo:https://github.com/yankewei/herdr-focus-notify" = "rev:<SHA>"` can build/install a binary, but **does not install the Herdr manifest or register/enable the plugin**. Its manifest explicitly invokes `target/release/herdr-focus-notify` relative to the plugin checkout, not a PATH binary. Making these layouts agree needs extra adapter/copy/link logic. [3][8] |
| `git:` / Git sources | No standalone `git:` tool backend in installed backend list. Git is a source transport for Cargo and other facilities. | Native **`[bootstrap.repos]`** can clone a pinned checkout, but does not execute the Herdr manifest build or register/enable it. Repos + build task + `herdr plugin link` is valid for a deliberately developer-owned checkout, but adds ownership and upgrade bookkeeping here. Never point mise repos at the checkout that `herdr plugin install` itself replaces. [4][9] |
| `github:` | Downloads GitHub release assets into a mise tool installation. | Not a general Git clone/Cargo-build installer; cannot infer Herdr registration or enabled state. Even a future binary release still needs its manifest/layout and host registration. [5][8] |
| `aqua:` | Registry recipes for tool artifacts, platform selection, and available verification metadata. | Appropriate for the already-declared **Herdr executable**, not automatically for its plugins. No automatic Herdr manifest interpretation or registration. A custom recipe still leaves host-state reconciliation and is unnecessary here. [6] |
| Tool `postinstall` | Arbitrary work after that tool installs. | Supported, but wrong lifecycle for mutable host plugins: reusing installed Herdr will not run its per-tool hook; changing a plugin pin is independent of a Herdr version. Other tools can install concurrently, so Rust readiness also needs explicit dependencies. External registry/config state is not rolled back or owned as a mise tool artifact. [7] |
| Project `[hooks].postinstall` | Work after a tool-install pass. | Unlike tool postinstall, v2026.9.1 **does run this on a no-op `mise install`**, with `MISE_INSTALLED_TOOLS=[]`. Technically viable with guards, but unnecessarily couples host mutation to ordinary tool installs/CI; would still be custom reconciliation, not a declarative Herdr manager. [7] |
| Native bootstrap | Packages, repos, files/dotfiles, plus extension points. | Package-manager plugins are the correct general model for host-owned extensions, but require a real adapter. Built-in package manager list has no Herdr entry; unknown manager entries can warn/skip, so do not invent `herdr:...` declarations. The final `[tasks.bootstrap]` explicitly exists for setup not covered by declarations, runs after tools with their PATH, and runs every bootstrap. [1][2] |

## Minimal implementation policy for the parent

1. Add one named guarded task to the existing bootstrap task sequence, after required host dependencies. Restrict the notifier to macOS and retain explicit personal/work profile selection. Keep normal `mise install` and repository validation free of this host mutation.
2. Keep a reviewed **full commit SHA** in tracked desired configuration. The prior audit recommends `f931db5090ded54086e365dfb8db896c3a3e1a05`. On absence, call `herdr plugin install yankewei/herdr-focus-notify --ref <SHA> --yes` once. Herdr owns checkout, manifest build, registration, and initial `enabled=true`.
3. On subsequent bootstrap, inspect actual installed metadata and filesystem health; matching managed source/ref/resolved commit, usable manifest/executable, and enabled state should give a no-op. A linked/foreign plugin, disabled entry, mismatched pin, broken/dirty checkout, or malformed registry should produce a clear diagnostic rather than silent replacement/re-enabling. Preserve user disable decisions unless explicit enable reconciliation is separately authorized. Do not treat metadata alone as code/binary integrity verification.
4. Keep pin changes, reinstall/repair, and upgrades explicit; normal bootstrap must not upgrade or prune. Herdr 0.8.2 has no plugin update subcommand: reinstall fetches/builds/replaces even the same ref, refreshes metadata, and enables the plugin again. A guarded task is therefore necessary for no-op bootstrap behavior. [8][9]

Do not add a large state machine just to implement this policy. Reuse Herdr's installer and inspection interfaces, keep the guard understandable, and fail safely on ambiguous ownership. Pi vendoring and alerter provisioning remain separate parent-owned changes; this report makes no new provisioning recommendation for either.

## Sources/outputs are not runtime ownership

`tasks.sources`/`outputs` optimize file-based work, not semantic application-state convergence. The docs describe timestamp freshness; `outputs = { auto = true }` uses an internal completion marker. Neither proves that a plugin remains enabled, its source is correct, or its registry entry still exists. Using shared `plugins.json` as an output is especially misleading: unrelated plugin edits or disabling this one make the file *newer*, potentially leaving a task falsely “fresh.” Auto markers can survive plugin removal. Hash freshness, if selected, still requires complete semantic inputs and does not transfer ownership. [10]

**Run the cheap guard every bootstrap; omit source/output freshness and output caching for this host-state task.** Sources/outputs could help a separately owned pure build, but are unnecessary when delegating builds to Herdr. Never cache/restore or symlink its mutable registry and learned state as task build outputs.

Track desired pins/tasks and the selected static `config.toml` only. Leave `$XDG_CONFIG_HOME/herdr/plugins.json`, `plugins/github/<derived-id>`, `plugins/config/herdr-focus-notify`, and `$XDG_STATE_HOME/herdr/plugins/herdr-focus-notify` under Herdr/user ownership (default roots `~/.config` and `~/.local/state`). Do not symlink the whole Herdr directory into dotfiles. Learned bindings, scripts, icons, and other notification state are not declarative dotfiles. [11]

## Reproducibility and residual limits

Mise's lock for the Herdr CLI does **not** lock the plugin installed by an arbitrary task. The plugin source SHA must be explicit. Its manifest runs `cargo build --release`, **not `--locked`**; Rust version and committed Cargo.lock improve repeatability but are not an immutable binary proof. In contrast, mise's Cargo backend supports/defaults its own `cargo install --locked` option; that option does not change Herdr's build command. Source pinning/`--yes` is trust acceptance, not sandboxing. Git/network, Cargo dependencies, native compiler/linker availability, actual enabled-state reconciliation, and GUI notification behavior require later supervised validation. [3][8]

## Primary references

1. [mise v2026.9.1 package-manager plugins](https://github.com/jdx/mise/blob/v2026.9.1/docs/bootstrap/packages/plugins.md); [current docs](https://mise.jdx.dev/bootstrap/packages/plugins.html).
2. [mise v2026.9.1 supported package managers and unknown-manager semantics](https://github.com/jdx/mise/blob/v2026.9.1/docs/bootstrap/packages/index.md); [bootstrap docs](https://mise.jdx.dev/bootstrap.html). Installed `bootstrap --help` independently confirms ordering and final-task contract.
3. [Cargo docs](https://mise.jdx.dev/dev-tools/backends/cargo.html); [v2026.9.1 Cargo implementation](https://github.com/jdx/mise/blob/v2026.9.1/src/backend/cargo.rs), particularly lines 318–340 and 418–440 (`--git`, `--rev`, `--locked`, mise install root).
4. [Native repo declarations](https://mise.jdx.dev/bootstrap/repos.html).
5. [GitHub backend docs](https://mise.jdx.dev/dev-tools/backends/github.html).
6. [Aqua backend docs](https://mise.jdx.dev/dev-tools/backends/aqua.html).
7. [v2026.9.1 hooks documentation](https://github.com/jdx/mise/blob/v2026.9.1/docs/hooks.md); [tool postinstall implementation](https://github.com/jdx/mise/blob/v2026.9.1/src/backend/mod.rs#L3441-L3445); [no-op project postinstall implementation](https://github.com/jdx/mise/blob/v2026.9.1/src/cli/install.rs#L559-L587).
8. [Pinned notifier manifest](https://github.com/yankewei/herdr-focus-notify/blob/f931db5090ded54086e365dfb8db896c3a3e1a05/herdr-plugin.toml).
9. [Herdr v0.8.2 plugin CLI](https://github.com/herdrdev/herdr/blob/v0.8.2/src/cli/plugin.rs), locally inspected `plugin_install` lines 154–260, source/replacement checks and registration/list routines.
10. [Task sources/outputs](https://mise.jdx.dev/tasks/task-configuration.html#sources), including `outputs` and automatic completion markers. Installed `mise run --help` independently confirms file-freshness support, not detailed behavior execution.
11. [Herdr plugin paths](https://github.com/herdrdev/herdr/blob/v0.8.2/src/plugin_paths.rs); [registry persistence](https://github.com/herdrdev/herdr/blob/v0.8.2/src/persist/plugin_registry.rs). Existing local `dotfiles/common/herdr/notification-research.md` supplied prior audit context.

## Audit evidence

Only this report and fetched research files under `/tmp/herdr-mise-primary/` were written; **no repository files edited or staged by this researcher**. All existing staged migration work was preserved: `git diff --cached --binary | shasum -a 256` returned `a7b5617c25edf49c47488ebdacaa36c4ecb77c10709d667e837c06d51cac55fb` before and after research. Other concurrent work produced unstaged changes; those files were not touched here. Existing staged files mean an absolute “no staged files exist” assertion would be false.

Documentation retrieval initially encountered `.md` site/guessed-path 404s and a GitHub API 403; successful raw GitHub downloads at the cited paths supplied the evidence. Source snapshots are research scratch files, not installed dependencies. No behavioral tests were added or run because installation, builds, configuration edits, and runtime changes were out of scope.
