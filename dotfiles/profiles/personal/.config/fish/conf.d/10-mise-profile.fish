set -l profile_source (path resolve (status filename))
set -gx DOTFILES_ROOT (path resolve (dirname "$profile_source")/../../../../../..)
set -gx MISE_GLOBAL_CONFIG_FILE "$DOTFILES_ROOT/mise.toml"
set -gx MISE_ENV personal-macos
