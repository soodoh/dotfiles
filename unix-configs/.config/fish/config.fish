# Preferred editor
set -gx EDITOR nvim
set -gx VISUAL nvim

# GPG can use stdin
set -gx GPG_TTY (tty)

# tmux-sessionizer config location
set -gx TMS_CONFIG_FILE "$HOME/.config/tms/config.toml"

if status is-interactive
  # Load custom functions (checked into dotfiles, separate from Fisher-managed functions)
  set -a fish_function_path $__fish_config_dir/custom/functions

  # Source custom conf.d (checked into dotfiles, separate from Fisher-managed conf.d)
  for f in $__fish_config_dir/custom/conf.d/*.fish
      source $f
  end

  # vim keybindings for shell input
  fish_vi_key_bindings

  # Re-init abbreviations after custom files are loaded
  __abbr_tips_init
end
