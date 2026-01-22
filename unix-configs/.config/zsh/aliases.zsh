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

# pnpm/Npm/Node/JS aliases
alias yp="yarn run build && yarn dlx yalc push"
alias ypl="yarn run build:library && yarn dlx yalc push"
alias ydx="yarn dlx"
alias ywk="yarn workspace"
alias pp="pnpm run build && pnpm dlx yalc push"
alias pdx="pnpm dlx"
