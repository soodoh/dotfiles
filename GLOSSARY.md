# Dotfiles

## Language

**Mise tool declaration**: The version requests for one named tool in a shared config, profile, or task. Each request can specify which operating systems it applies to and carry its own install options.

**Mise tool resolution**: The read-only mapping of this checkout’s declared tool version requests to the concrete versions reported by mise. It does not install tools or refresh lockfiles.

**Herdr terminal control stream**: The exchange of control sequences between Herdr and the attached terminal, including mouse-mode changes, pixel reports, and status requests and replies. A status reply belongs to the oldest unanswered request that reached the terminal, whether from Herdr or from the SSH image proxy.

**SSH image lifecycle**: The progression of a Herdr pane image during an SSH attach. A newer frame may replace an unsent frame; a hidden image can retain its pixels for later reveal, while a released image needs a new upload.
