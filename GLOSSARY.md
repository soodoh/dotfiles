# Dotfiles

## Language

**Mise tool declaration**: The version requests for one named tool in a shared config, profile, or task. Each request can specify which operating systems it applies to and carry its own install options.

**Mise tool resolution**: The read-only mapping of this checkout’s declared tool version requests to the concrete versions reported by mise. It does not install tools or refresh lockfiles.

**Mise lock record**: A committed entry for one resolved tool version and its backend, with any backend options and per-platform download metadata.

**Herdr terminal control stream**: The exchange of control sequences between Herdr and the attached terminal, including mouse-mode changes, pixel reports, and status requests and replies. A status reply belongs to the oldest unanswered request that reached the terminal, whether from Herdr or from the SSH image proxy.

**SSH image lifecycle**: The progression of a Herdr pane image during an SSH attach. A newer frame may replace an unsent frame; a hidden image can retain its pixels for later reveal, while a released image needs a new upload.

**Workstation cleanup maintenance**: The macOS plan that stops user LaunchAgents, Herdr sessions, and blocking Fish shells holding pruned targets, verifies retained replacements, and refreshes stale ones afterward without mutating system daemons.

**Shared usage cache**: A disposable, cross-process disk snapshot of provider or CLIProxyAPI quota shared by Pi and SketchyBar, coordinated by a file lease and freshness policy so concurrent processes avoid duplicate lookups without storing credentials.

**Proxy target link**: The association between a direct OpenAI or legacy Codex provider target and its matching CLIProxyAPI account, tracked by hashed identity so Pi and external renderers merge quota into one entry without exposing raw credentials.
