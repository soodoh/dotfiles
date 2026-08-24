# tmux session status

Publishes a private heartbeat for the foreground Pi process in each tmux pane. The dedicated `Alt+P` tmux picker joins these records to live panes and displays lifecycle state without storing prompts, messages, tool arguments, or pane output.

State files live under `${XDG_STATE_HOME:-~/.local/state}/pi/tmux-sessions/`, are updated atomically, and are removed on graceful session shutdown. Stale or missing instrumentation is treated as `UNKNOWN` only when the live pane still has strong Pi identity.

Lifecycle states are `STARTING`, `THINKING`, `TOOL <name>`, `WAITING`, `IDLE`, and `ERROR`. `WAITING` is cleared when a focused tmux client visits the exact pane.

On macOS, a pane entering `WAITING` posts a grouped `terminal-notifier` notification unless that pane is visible in a focused terminal client. Its subtitle shows the tmux session and current Git branch, while its message shows the Pi session name or the project fallback when unnamed.

Clicking the notification validates the original tmux server and pane, focuses the front Ghostty terminal so tmux can identify its client, and explicitly selects the target window and pane before switching that client. If the tmux server has no attached client, the click opens a new Ghostty window attached directly to the pane. Focusing the pane, starting another run, or shutting down Pi removes the notification.
