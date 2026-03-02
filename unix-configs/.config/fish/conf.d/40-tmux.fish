# Auto-start tmux on interactive shell (replaces omz tmux plugin)
if status is-interactive
    and command -q tmux
    and not set -q TMUX
    and not set -q VSCODE_RESOLVING_ENVIRONMENT
    tmux new-session -A -s main
end
