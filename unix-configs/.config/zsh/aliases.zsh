# Personal, general-purpose aliases
alias vim="nvim"
alias v="nvim"
alias l="ls -lAFh"
alias ze="zellij"
alias za='zellij a $(zellij ls -s | tail -1)'

# Personal git aliases
alias gdn="git diff --name-only"
alias gmc="git merge --continue"
alias -g nv="--no-verify"

# Yarn/Npm/Node/JS aliases
alias yp="yarn build && yarn dlx yalc push"
alias ypl="yarn build:library && yarn dlx yalc push"
alias ydx="yarn dlx"
alias ywk="yarn workspace"
