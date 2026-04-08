# Abbreviation expansion functions (for dynamic command substitution)
function _abbr_groh; echo "git reset origin/(__git.current_branch) --hard"; end
function _abbr_gprom; echo "git pull --rebase origin (__git.default_branch)"; end
function _abbr_gprum; echo "git pull --rebase upstream (__git.default_branch)"; end
function _abbr_gluc; echo "git pull upstream (__git.current_branch)"; end
function _abbr_glum; echo "git pull upstream (__git.default_branch)"; end
function _abbr_gmum; echo "git merge upstream/(__git.default_branch)"; end
function _abbr_grbum; echo "git rebase upstream/(__git.default_branch)"; end
function _abbr_gswm; echo "git switch (__git.default_branch)"; end
function _abbr_dsta; echo "docker stop (docker ps -q)"; end
function _abbr_drma; echo "docker rm (docker ps -qa)"; end

# General
abbr -a vim nvim
abbr -a v nvim

# Git
abbr -a gdn 'git diff --name-only'
abbr -a gmc 'git merge --continue'
abbr -a --position anywhere -- nv --no-verify
abbr -a gav 'git add --verbose'
abbr -a gapt 'git apply --3way'
abbr -a gbm 'git branch --move'
abbr -a gbnm 'git branch --no-merged'
abbr -a gbr 'git branch --remote'
abbr -a gcor 'git checkout --recurse-submodules'
abbr -a gcB 'git checkout -B'
abbr -a gcmsg 'git commit --message'
abbr -a gcsm 'git commit --signoff --message'
abbr -a gcn 'git commit --verbose --no-edit'
abbr -a gdup 'git diff @{upstream}'
abbr -a ghh 'git help'
abbr -a glgm 'git log --graph --max-count=10'
abbr -a glgp 'git log --stat --patch'
abbr -a gfg 'git ls-files | grep'
abbr -a gms 'git merge --squash'
abbr -a gmff 'git merge --ff-only'
abbr -a gpd 'git push --dry-run'
abbr -a gpod 'git push origin --delete'
abbr -a grbo 'git rebase --onto'
abbr -a grf 'git reflog'
abbr -a gru 'git reset --'
abbr -a grhk 'git reset --keep'
abbr -a grhs 'git reset --soft'
abbr -a greva 'git revert --abort'
abbr -a grevc 'git revert --continue'
abbr -a gsi 'git submodule init'
abbr -a gsts 'git stash --staged'
abbr -a gstall 'git stash --all'
abbr -a gstaa 'git stash apply'
abbr -a gstc 'git stash clear'
abbr -a gsps 'git show --pretty=short --show-signature'
abbr -a gta 'git tag --annotate'
abbr -a groh --function _abbr_groh
abbr -a gprom --function _abbr_gprom
abbr -a gprum --function _abbr_gprum
abbr -a gluc --function _abbr_gluc
abbr -a glum --function _abbr_glum
abbr -a gmum --function _abbr_gmum
abbr -a grbum --function _abbr_grbum
abbr -a gswm --function _abbr_gswm
abbr -a gpristine 'git reset --hard; and git clean --force -dfx'
abbr -a gwipe 'git reset --hard; and git clean --force -df'
abbr -a gbg 'git branch -vv | grep ": gone]"'
abbr -a gbgd 'git branch -vv | grep ": gone]" | awk \'{print $1}\' | xargs -r git branch -d'
abbr -a gbgD 'git branch -vv | grep ": gone]" | awk \'{print $1}\' | xargs -r git branch -D'

# Tmux (replaces OMZ tmux plugin aliases)
abbr -a ta 'tmux attach'
abbr -a ts 'tmux new-session -s'
abbr -a tl 'tmux list-sessions'
abbr -a tksv 'tmux kill-server'
abbr -a tkss 'tmux kill-session -t'

# Docker
abbr -a dbl 'docker build'
abbr -a dcin 'docker container inspect'
abbr -a dcls 'docker container ls'
abbr -a dclsa 'docker container ls -a'
abbr -a dib 'docker image build'
abbr -a dii 'docker image inspect'
abbr -a dils 'docker image ls'
abbr -a dipu 'docker image push'
abbr -a dirm 'docker image rm'
abbr -a dit 'docker image tag'
abbr -a dlo 'docker container logs'
abbr -a dlof 'docker container logs -f'
abbr -a dnc 'docker network create'
abbr -a dni 'docker network inspect'
abbr -a dnls 'docker network ls'
abbr -a dnrm 'docker network rm'
abbr -a dpo 'docker container port'
abbr -a dps 'docker ps'
abbr -a dpsa 'docker ps -a'
abbr -a dpu 'docker pull'
abbr -a dr 'docker container run'
abbr -a drit 'docker container run -it'
abbr -a drm 'docker container rm'
abbr -a dst 'docker container start'
abbr -a drs 'docker container restart'
abbr -a dstp 'docker container stop'
abbr -a dsts 'docker stats'
abbr -a dtop 'docker top'
abbr -a dvi 'docker volume inspect'
abbr -a dvls 'docker volume ls'
abbr -a dvprune 'docker volume prune'
abbr -a dxc 'docker container exec'
abbr -a dxcit 'docker container exec -it'
abbr -a dipru 'docker image prune -a'
abbr -a dncn 'docker network connect'
abbr -a dndcn 'docker network disconnect'
abbr -a dsta --function _abbr_dsta
abbr -a drma --function _abbr_drma

# Docker Compose
abbr -a dco 'docker compose'
abbr -a dcb 'docker compose build'
abbr -a dce 'docker compose exec'
abbr -a dcps 'docker compose ps'
abbr -a dcrestart 'docker compose restart'
abbr -a dcrm 'docker compose rm'
abbr -a dcr 'docker compose run'
abbr -a dcstop 'docker compose stop'
abbr -a dcup 'docker compose up'
abbr -a dcupb 'docker compose up --build'
abbr -a dcupd 'docker compose up -d'
abbr -a dcupdb 'docker compose up -d --build'
abbr -a dcdn 'docker compose down'
abbr -a dcl 'docker compose logs'
abbr -a dclf 'docker compose logs -f'
abbr -a dcpull 'docker compose pull'
abbr -a dcstart 'docker compose start'
abbr -a dck 'docker compose kill'

# Bun/Node/JS
abbr -a ydx 'yarn dlx'
abbr -a ywk 'yarn workspace'
abbr -a yp 'yarn run build && yarn dlx yalc push'
abbr -a ypl 'yarn run build:library && yarn dlx yalc push'
abbr -a bp 'bun run build && bunx yalc push'
abbr -a bx bunx

# Claude Code
abbr -a cc 'happier claude --dangerously-skip-permissions'
abbr -a ccc 'happier claude --dangerously-skip-permissions --continue'
abbr -a ccw 'happier claude --dangerously-skip-permissions --worktree'

# Codex
abbr -a cx 'happier codex --yolo'
abbr -a cxr 'happier codex --yolo resume'
