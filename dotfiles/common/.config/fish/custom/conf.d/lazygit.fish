# Keep LazyGit on the store-backed XDG config without changing global XDG paths.
# LG_CONFIG_FILE is LazyGit-specific and is inherited by Neovim/Snacks.
set -gx LG_CONFIG_FILE "$HOME/.config/lazygit/config.yml"
