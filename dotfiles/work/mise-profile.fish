set -l profile_source (path resolve (status filename))
set -gx DOTFILES_ROOT (path resolve (dirname "$profile_source")/../..)
set -gx MISE_CONFIG_DIR "$DOTFILES_ROOT"
set -gx MISE_ENV work-macos
