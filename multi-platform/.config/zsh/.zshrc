source $HOME/.config/zsh/aliases.zsh
source $HOME/.config/zsh/opts.zsh

# Add LF_ICONS env var for lf icons
# Strips comments from the file, trims whitespace, then formats for LF
LF_ICONS=$(cat ~/.config/lf/icons | sed \
  -e "/^[ \t]*#/d"   \
  -e "/^[ \s]*$/d"   \
  -e "s/^[ \s]*//"   \
  -e "s/[ \s]*$//"   \
  -e "s/  */=/g"     \
  -e "s/$/ /")
LF_ICONS=${LF_ICONS//$"\n"/:}
export LF_ICONS

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
  PATH+="$HOME/.cargo/bin"
fi
# Include Go packages in $PATH
if command -v go &> /dev/null; then
  export GOPATH="$HOME/go"
  PATH+="$GOPATH/bin"
fi
# Include Ruby in $PATH
if command -v brew &> /dev/null; then
    PATH+="/opt/homebrew/opt/ruby/bin"
fi
# ImageMagick + Nvim
if command -v brew &> /dev/null; then
    export DYLD_LIBRARY_PATH="$(brew --prefix)/lib:$DYLD_LIBRARY_PATH"
fi

# Settings for zsh-vi-mode
ZVM_VI_INSERT_ESCAPE_BINDKEY=jk

# ZSH plugins
ZSH_PLUGINS=$HOME/.config/zsh-plugins
load () {
  local GITHUB=$1
  local SOURCE=$2
  if [[ ! -d $ZSH_PLUGINS/$GITHUB ]]
  then
    git clone https://github.com/$GITHUB.git $ZSH_PLUGINS/$GITHUB
  else
    # Update repo
  fi
  source $ZSH_PLUGINS/$GITHUB/$SOURCE
}

# Setup for ZSH plugins
GIT_AUTO_FETCH_INTERVAL=1200 # in seconds
zstyle ':omz:plugins:nvm' autoload yes
fpath+="$ZSH_PLUGINS/ohmyzsh/ohmyzsh/plugins/docker/completions" 
fpath+="$ZSH_PLUGINS/ohmyzsh/ohmyzsh/plugins/docker-compose" 

autoload -U +X compinit && compinit
load "ohmyzsh/ohmyzsh" "lib/git.zsh" # Deps for git plugin
load "ohmyzsh/ohmyzsh" "lib/async_prompt.zsh" # Deps for git plugin
load "ohmyzsh/ohmyzsh" "plugins/git/git.plugin.zsh"
load "ohmyzsh/ohmyzsh" "plugins/nvm/nvm.plugin.zsh"
load "ohmyzsh/ohmyzsh" "plugins/git-auto-fetch/git-auto-fetch.plugin.zsh"
ZSH_CACHE_DIR="$ZSH_PLUGINS/ohmyzsh/ohmyzsh/plugins/docker" \
  load "ohmyzsh/ohmyzsh" "plugins/docker/docker.plugin.zsh" # Docker plugin uses this env var
load "ohmyzsh/ohmyzsh" "plugins/docker-compose/docker-compose.plugin.zsh"
load "ohmyzsh/ohmyzsh" "plugins/colored-man-pages/colored-man-pages.plugin.zsh"
load "zsh-users/zsh-autosuggestions" "zsh-autosuggestions.plugin.zsh"
load "zsh-users/zsh-completions" "zsh-completions.plugin.zsh"
load "jeffreytse/zsh-vi-mode" "zsh-vi-mode.plugin.zsh"
load "zdharma-continuum/fast-syntax-highlighting" "fast-syntax-highlighting.plugin.zsh"
load "MichaelAquilina/zsh-you-should-use" "you-should-use.plugin.zsh"
