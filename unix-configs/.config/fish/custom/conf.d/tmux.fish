# Auto-start tmux on interactive shell
if status is-interactive
    and command -q tmux
    and not set -q TMUX
    and not set -q VSCODE_RESOLVING_ENVIRONMENT
    and test "$TERM_PROGRAM" != vscode
    and test "$TERM_PROGRAM" != zed
    if command tmux has-session 2>/dev/null
        command tmux attach
    else
        command tmux new-session -s main
    end
end

# TPM (Tmux Plugin Manager) - auto install if needed
set -l tpm_dir "$HOME/.config/tmux/plugins/tpm"
if not test -d $tpm_dir
    mkdir -p "$HOME/.config/tmux/plugins"
    git clone --depth=1 https://github.com/tmux-plugins/tpm.git $tpm_dir
end
