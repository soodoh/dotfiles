# Fisher plugin manager - auto install if needed
if not functions -q fisher
    curl -sL https://git.io/fisher | source && fisher install jorgebucaran/fisher
end

# Preferred editor
set -gx EDITOR nvim
set -gx VISUAL nvim

# GPG can use stdin
set -gx GPG_TTY (tty)

# Vi mode
fish_vi_key_bindings

# tmux-sessionizer config location
set -gx TMS_CONFIG_FILE "$HOME/.config/tms/config.toml"
