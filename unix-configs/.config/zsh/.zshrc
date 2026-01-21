source $HOME/.config/zsh/aliases.zsh
source $HOME/.config/zsh/opts.zsh

# Antidote ZSH plugin manager
ANTIDOTE_DIR="$HOME/.local/share/antidote"
# Auto install, if needed
if [[ ! -d $ANTIDOTE_DIR ]]; then
  mkdir -p $ANTIDOTE_DIR
  git clone --depth=1 https://github.com/mattmc3/antidote.git $ANTIDOTE_DIR
fi
source "$ANTIDOTE_DIR/antidote.zsh"
antidote load "$HOME/.config/zsh/plugins.txt" "$HOME/.config/zsh/plugins.zsh"

# neovim-remote setup
# if [ -n "$NVIM_LISTEN_ADDRESS" ]; then
#   alias nvim=nvr -cc split --remote-wait +'set bufhidden=wipe'
# else
#   alias nvim='nvim --listen /tmp/nvim-server.pipe'
# fi

# Preferred editor for local and remote sessions
export EDITOR="nvim"
export VISUAL="nvim"

# GPG can use stdin
export GPG_TTY="$(tty)"

# Use zoxide
eval "$(zoxide init zsh)"
# Use Starship for terminal prompt
eval "$(starship init zsh)"

# Include Cargo packages in $PATH
if command -v cargo &> /dev/null; then
  PATH="$PATH:$HOME/.cargo/bin"
fi
# tmux-sessionizer config location
export TMS_CONFIG_FILE="$HOME/.config/tms/config.toml"

# TPM (Tmux Plugin Manager) - auto install if needed
TPM_DIR="$HOME/.tmux/plugins/tpm"
if [[ ! -d $TPM_DIR ]]; then
  mkdir -p "$HOME/.tmux/plugins"
  git clone --depth=1 https://github.com/tmux-plugins/tpm.git "$TPM_DIR"
fi
# Include Go packages in $PATH
if command -v go &> /dev/null; then
  export GOPATH="$HOME/go"
  PATH="$PATH:$GOPATH/bin"
fi
# MacOS specific stuff
if command -v brew &> /dev/null; then
  PATH="$PATH:/opt/homebrew/bin"
  # Koreader dev dependencies
  PATH="$(brew --prefix)/opt/findutils/libexec/gnubin:$(brew --prefix)/opt/gnu-getopt/bin:$(brew --prefix)/opt/make/libexec/gnubin:$(brew --prefix)/opt/util-linux/bin:${PATH}"
  # Make sure Homebrew-installed apps take priority
  export PATH="/usr/local/bin:/usr/local/sbin:${PATH/:\/usr\/local\/bin/}"

  # ImageMagick + Nvim
  export DYLD_LIBRARY_PATH="$(brew --prefix)/lib/"
fi
