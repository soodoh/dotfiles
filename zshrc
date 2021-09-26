# Start Tmux automatically
if command -v tmux &> /dev/null && [ -z "$TMUX" ]; then
  tmux attach -t default || tmux new -s default
fi

# Path to your oh-my-zsh installation.
export ZSH="$HOME/.oh-my-zsh"

# Set name of the theme to load --- if set to "random", it will
# load a random theme each time oh-my-zsh is loaded, in which case,
# to know which specific one was loaded, run: echo $RANDOM_THEME
# See https://github.com/ohmyzsh/ohmyzsh/wiki/Themes
# ZSH_THEME="agnoster"

# Set list of themes to pick from when loading at random
# Setting this variable when ZSH_THEME=random will cause zsh to load
# a theme from this variable instead of looking in $ZSH/themes/
# If set to an empty array, this variable will have no effect.
# ZSH_THEME_RANDOM_CANDIDATES=( "robbyrussell" "agnoster" )

# Uncomment the following line to disable bi-weekly auto-update checks.
# DISABLE_AUTO_UPDATE="true"

# Uncomment the following line to automatically update without prompting.
# DISABLE_UPDATE_PROMPT="true"

# Uncomment the following line to change how often to auto-update (in days).
# export UPDATE_ZSH_DAYS=13

# Uncomment the following line if pasting URLs and other text is messed up.
# DISABLE_MAGIC_FUNCTIONS="true"

# Uncomment the following line to disable colors in ls.
# DISABLE_LS_COLORS="true"

# Uncomment the following line to disable auto-setting terminal title.
# DISABLE_AUTO_TITLE="true"

# Uncomment the following line to enable command auto-correction.
# ENABLE_CORRECTION="true"

# Uncomment the following line to display red dots whilst waiting for completion.
# Caution: this setting can cause issues with multiline prompts (zsh 5.7.1 and newer seem to work)
# See https://github.com/ohmyzsh/ohmyzsh/issues/5765
# COMPLETION_WAITING_DOTS="true"

# Uncomment the following line if you want to disable marking untracked files
# under VCS as dirty. This makes repository status check for large repositories
# much, much faster.
# DISABLE_UNTRACKED_FILES_DIRTY="true"

# Uncomment the following line if you want to change the command execution time
# stamp shown in the history command output.
# You can set one of the optional three formats:
# "mm/dd/yyyy"|"dd.mm.yyyy"|"yyyy-mm-dd"
# or set a custom format using the strftime function format specifications,
# see 'man strftime' for details.
# HIST_STAMPS="mm/dd/yyyy"

# Which plugins would you like to load?
# Standard plugins can be found in $ZSH/plugins/
# Custom plugins may be added to $ZSH_CUSTOM/plugins/
# Example format: plugins=(rails git textmate ruby lighthouse)
# Add wisely, as too many plugins slow down shell startup.
plugins=(
  git
  tmux
  docker
  docker-compose
  npm
  sudo
  colored-man-pages
  command-not-found
  # Custom ones
  zsh-syntax-highlighting
  zsh-autosuggestions
  zsh-vimode-visual
  vi-mode
)

source $ZSH/oh-my-zsh.sh

# Add LF_ICONS env var for lf icons
# Strips comments from the file, trims whitespace, then formats for LF
LF_ICONS=$(cat ~/.config/lf/icons | sed \
  -e '/^[ \t]*#/d'   \
  -e '/^[ \s]*$/d'   \
  -e 's/^[ \s]*//'    \
  -e 's/[ \s]*$//'    \
  -e 's/  */=/g'     \
  -e 's/$/ /')
LF_ICONS=${LF_ICONS//$'\n'/:}
export LF_ICONS

# User configuration

# Preferred editor for local and remote sessions
export EDITOR='nvim'
export VISUAL='nvim'

# Set personal aliases, overriding those provided by oh-my-zsh libs,
# plugins, and themes. Aliases can be placed here, though oh-my-zsh
# users are encouraged to define aliases within the ZSH_CUSTOM folder.
# For a full list of active aliases, run `alias`.
alias gsu="git submodule update --init --recursive"
alias vim="nvim"
alias gdn="git diff --name-only"

# Load z
[ -e ~/.config/z/z.sh ] && . ~/.config/z/z.sh

# Homebrew command not found
HB_CNF_HANDLER="$(command -v brew &> /dev/null && brew --repository)/Library/Taps/homebrew/homebrew-command-not-found/handler.sh"
[ -f "$HB_CNF_HANDLER" ] && source $HB_CNF_HANDLER

# Use Starship for terminal prompt
eval "$(starship init zsh)"

# Stuff for NVM (Node version manager)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
# Set node version
nvm use --lts
