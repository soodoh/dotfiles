# Preferred editor
set -gx EDITOR nvim
set -gx VISUAL nvim

# Ensure terminal clients such as tmux detect UTF-8 support.
set -gx LANG en_US.UTF-8
set -gx LC_CTYPE en_US.UTF-8

# Disable the default fish welcome message
set -g fish_greeting

# GPG can use stdin
set -gx GPG_TTY (tty)

if status is-interactive
  # Load custom functions (checked into dotfiles, separate from Fisher-managed functions)
  set -a fish_function_path $__fish_config_dir/custom/functions

  # Source custom conf.d (checked into dotfiles, separate from Fisher-managed conf.d)
  set -l custom_conf_dir $__fish_config_dir/custom/conf.d
  set -l path_conf $custom_conf_dir/path.fish

  # Load PATH setup before integrations that depend on Homebrew binaries.
  if test -f $path_conf
      source $path_conf
  end

  for f in $custom_conf_dir/*.fish
      if test "$f" = "$path_conf"
          continue
      end
      source $f
  end

  # vim keybindings for shell input
  fish_vi_key_bindings

  # Re-init abbreviations after custom files are loaded
  __abbr_tips_init
end
