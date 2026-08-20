set -l profile_source (path resolve (status filename))
set -gx MISE_CONFIG_DIR (path resolve (dirname "$profile_source")/../..)
set -gx MISE_ENV personal-macos
