set -l profile_source (path resolve (status filename))
set -gx MISE_CONFIG_DIR (path resolve (dirname "$profile_source")/../..)
# Keep checkout tools global, including when inheriting the old settings-only override.
set -e MISE_GLOBAL_CONFIG_FILE
set -gx MISE_GITHUB_CREDENTIAL_COMMAND 'gh auth token --hostname "$MISE_CREDENTIAL_HOST"'
set -gx MISE_ENV personal-macos
set -gx MISE_AGE_STRICT true
