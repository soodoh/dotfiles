# TPM (Tmux Plugin Manager) - auto install if needed
set -l tpm_dir "$HOME/.config/tmux/plugins/tpm"
if not test -d $tpm_dir
    mkdir -p "$HOME/.config/tmux/plugins"
    git clone --depth=1 https://github.com/tmux-plugins/tpm.git $tpm_dir
end
