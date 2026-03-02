# Auto-start tmux on interactive shell (replaces omz tmux plugin)
if status is-interactive
    and command -q tmux
    and not set -q TMUX
    and not set -q VSCODE_RESOLVING_ENVIRONMENT
    tmux new-session -A -s main
end

# TPM (Tmux Plugin Manager) - auto install if needed
set -l tpm_dir "$HOME/.config/tmux/plugins/tpm"
if not test -d $tpm_dir
    mkdir -p "$HOME/.config/tmux/plugins"
    git clone --depth=1 https://github.com/tmux-plugins/tpm.git $tpm_dir
end
