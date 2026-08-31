# General
abbr -a vim        nvim
abbr -a v          nvim
abbr -a l          ls -lAFh

########### START Git abbreviations
# Core
abbr -a g          git
abbr -a ghh        git help
# Add & Apply
abbr -a ga         git add
abbr -a gaa        git add --all
abbr -a gap        git apply
abbr -a gapa       git add --patch
abbr -a gapt       git apply --3way
abbr -a gau        git add --update
abbr -a gav        git add --verbose
# Bisect
abbr -a gbs        git bisect
abbr -a gbsb       git bisect bad
abbr -a gbsg       git bisect good
abbr -a gbsr       git bisect reset
abbr -a gbss       git bisect start
# Branch & Blame
abbr -a gb         git branch -vv
abbr -a gba        git branch -a -v
abbr -a gban       git branch -a -v --no-merged
abbr -a gbD        git branch -D
abbr -a gbd        git branch -d
abbr -a gbg        'git branch -vv | grep ": gone]"'
abbr -a gbgD       'git branch -vv | grep ": gone]" | awk \'{print $1}\' | xargs -r git branch -D'
abbr -a gbgd       'git branch -vv | grep ": gone]" | awk \'{print $1}\' | xargs -r git branch -d'
abbr -a gbl        git blame -b -w
abbr -a gbm        git branch --move
abbr -a gbnm       git branch --no-merged
abbr -a gbr        git branch --remote
abbr -a ggsup      git branch --set-upstream-to=origin/\(__git.current_branch\)
# Checkout & Switch
abbr -a gcB        git checkout -B
abbr -a gcb        git checkout -b
abbr -a gco        git checkout
abbr -a gcom       git checkout \(__git.default_branch\)
abbr -a gcor       git checkout --recurse-submodules
abbr -a gsw        git switch
abbr -a gswc       git switch --create
abbr -a gswm       git switch \(__git.default_branch\)
# Cherry-pick & Revert
abbr -a gcp        git cherry-pick
abbr -a gcpa       git cherry-pick --abort
abbr -a gcpc       git cherry-pick --continue
abbr -a grev       git revert
abbr -a greva      git revert --abort
abbr -a grevc      git revert --continue
# Clean
abbr -a gclean     git clean -di
abbr -a gclean!    git clean -dfx
abbr -a gclean!!   'git reset --hard; and git clean -dfx'
abbr -a gpristine  'git reset --hard; and git clean --force -dfx'
abbr -a gwipe      'git reset --hard; and git clean --force -df'
# Clone
abbr -a gbc        gbclone # Custom bare repositories clone script
abbr -a gcl        git clone
# Commit
abbr -a gc         git commit -v
abbr -a gc!        git commit -v --amend
abbr -a gca        git commit -v -a
abbr -a gca!       git commit -v -a --amend
abbr -a gcam       git commit -a -m
abbr -a gcan!      git commit -a --no-edit --amend
abbr -a gcav       git commit -a -v --no-verify
abbr -a gcav!      git commit -a -v --no-verify --amend
abbr -a gcfx       git commit --fixup
abbr -a gcm        git commit -m
abbr -a gcmsg      git commit --message
abbr -a gcn        git commit --verbose --no-edit
abbr -a gcn!       git commit --no-edit --amend
abbr -a gcs        git commit -S
abbr -a gcs!       git commit -S --amend
abbr -a gcsm       git commit --signoff --message
abbr -a gcv        git commit -v --no-verify
abbr -a gscam      git commit -S -a -m
# Config
abbr -a gcf        git config --list
# Diff
abbr -a gd         git diff
abbr -a gdca       git diff --cached
abbr -a gdg        git diff --no-ext-diff
abbr -a gdn        git diff --name-only
abbr -a gds        git diff --stat
abbr -a gdsc       git diff --stat --cached
abbr -a gdt        git diff-tree --no-commit-id --name-only -r
abbr -a gdto       git difftool
abbr -a gdup       git diff @{upstream}
abbr -a gdw        git diff --word-diff
abbr -a gdwc       git diff --word-diff --cached
# Fetch & Pull
abbr -a gf         git fetch
abbr -a gfa        git fetch --all --prune
abbr -a gfm        'git fetch origin (__git.default_branch) --prune; and git merge FETCH_HEAD'
abbr -a gfo        git fetch origin
abbr -a ggl        git pull origin \(__git.current_branch\)
abbr -a ggpnp      'git pull origin (__git.current_branch); and git push origin (__git.current_branch)'
abbr -a ggu        git pull --rebase origin \(__git.current_branch\)
abbr -a gl         git pull
abbr -a gll        git pull origin
abbr -a glr        git pull --rebase
abbr -a gluc       git pull upstream \(__git.current_branch\)
abbr -a glum       git pull upstream \(__git.default_branch\)
abbr -a gpr        git pull --rebase
abbr -a gpra       git pull --rebase --autostash
abbr -a gprav      git pull --rebase --autostash -v
abbr -a gprom      git pull --rebase origin \(__git.default_branch\)
abbr -a gpromi     git pull --rebase=interactive origin \(__git.default_branch\)
abbr -a gprum      git pull --rebase upstream \(__git.default_branch\)
abbr -a gprumi     git pull --rebase=interactive upstream \(__git.default_branch\)
abbr -a gprv       git pull --rebase -v
abbr -a gup        git pull --rebase
abbr -a gupa       git pull --rebase --autostash
abbr -a gupav      git pull --rebase --autostash -v
abbr -a gupv       git pull --rebase -v
# Log & Show
abbr -a gcount     git shortlog -sn
abbr -a glg        git log --stat
abbr -a glgg       git log --graph
abbr -a glgga      git log --graph --decorate --all
abbr -a glgm       git log --graph --max-count=10
abbr -a glgp       git log --stat --patch
abbr -a glo        git log --oneline --decorate --color
abbr -a glod       git log --oneline --decorate --color develop..
abbr -a glog       git log --oneline --decorate --color --graph
abbr -a gloga      git log --oneline --decorate --color --graph --all
abbr -a glom       git log --oneline --decorate --color \(__git.default_branch\)..
abbr -a gloo       'git log --pretty=format:"%C(yellow)%h %Cred%ad %Cblue%an%Cgreen%d %Creset%s" --date=short'
abbr -a grf        git reflog
abbr -a gsh        git show
abbr -a gsps       git show --pretty=short --show-signature
abbr -a gwch       git log -p --abbrev-commit --pretty=medium --raw --no-merges
# Merge
abbr -a gm         git merge
abbr -a gma        git merge --abort
abbr -a gmc        git merge --continue
abbr -a gmff       git merge --ff-only
abbr -a gmom       git merge origin/\(__git.default_branch\)
abbr -a gms        git merge --squash
abbr -a gmt        git mergetool --no-prompt
abbr -a gmum       git merge upstream/\(__git.default_branch\)
# Push & GitLab
abbr -a ggp        git push origin \(__git.current_branch\)
abbr -a ggp!       git push origin \(__git.current_branch\) --force-with-lease
abbr -a gmr        git push origin \(__git.current_branch\) --set-upstream -o merge_request.create
abbr -a gmwps      git push origin \(__git.current_branch\) --set-upstream -o merge_request.create -o merge_request.merge_when_pipeline_succeeds
abbr -a gp         git push
abbr -a gp!        git push --force-with-lease
abbr -a gpd        git push --dry-run
abbr -a gpo        git push origin
abbr -a gpo!       git push --force-with-lease origin
abbr -a gpoat      'git push origin --all; and git push origin --tags'
abbr -a gpod       git push origin --delete
abbr -a gpu        git push origin \(__git.current_branch\) --set-upstream
abbr -a gpv        git push --no-verify
abbr -a gpv!       git push --no-verify --force-with-lease
# Rebase
abbr -a grb        git rebase
abbr -a grba       git rebase --abort
abbr -a grbc       git rebase --continue
abbr -a grbd       git rebase develop
abbr -a grbdi      git rebase develop --interactive
abbr -a grbdia     git rebase develop --interactive --autosquash
abbr -a grbi       git rebase --interactive
abbr -a grbm       git rebase \(__git.default_branch\)
abbr -a grbmi      git rebase \(__git.default_branch\) --interactive
abbr -a grbmia     git rebase \(__git.default_branch\) --interactive --autosquash
abbr -a grbo       git rebase --onto
abbr -a grbom      'git fetch origin (__git.default_branch); and git rebase FETCH_HEAD'
abbr -a grbomi     'git fetch origin (__git.default_branch); and git rebase FETCH_HEAD --interactive'
abbr -a grbomia    'git fetch origin (__git.default_branch); and git rebase FETCH_HEAD --interactive --autosquash'
abbr -a grbs       git rebase --skip
abbr -a grbum      git rebase upstream/\(__git.default_branch\)
# Remote
abbr -a gr         git remote -vv
abbr -a gra        git remote add
abbr -a grmv       git remote rename
abbr -a grpo       git remote prune origin
abbr -a grrm       git remote remove
abbr -a grset      git remote set-url
abbr -a grup       git remote update
abbr -a grv        git remote -v
# Reset & Restore
abbr -a grh        git reset
abbr -a grhh       git reset --hard
abbr -a grhk       git reset --keep
abbr -a grhpa      git reset --patch
abbr -a grhs       git reset --soft
abbr -a groh       git reset origin/\(__git.current_branch\) --hard
abbr -a grs        git restore
abbr -a grss       git restore --source
abbr -a grst       git restore --staged
abbr -a gru        git reset --
# Remove
abbr -a grm        git rm
abbr -a grmc       git rm --cached
# Stash
abbr -a gsta       git stash
abbr -a gstaa      git stash apply
abbr -a gstall     git stash --all
abbr -a gstc       git stash clear
abbr -a gstd       git stash drop
abbr -a gstl       git stash list
abbr -a gstp       git stash pop
abbr -a gsts       git stash --staged
# Status
abbr -a gsb        git status -sb
abbr -a gss        git status -s
abbr -a gst        git status
# Submodules
abbr -a gsi        git submodule init
abbr -a gsu        git submodule update
abbr -a gsur       git submodule update --recursive
abbr -a gsuri      git submodule update --recursive --init
# Tags
abbr -a gta        git tag --annotate
abbr -a gts        git tag -s
abbr -a gtv        'git tag | sort -V'
# Ignore
abbr -a gignore    git update-index --assume-unchanged
abbr -a gunignore  git update-index --no-assume-unchanged
# Worktrees
abbr -a gwt        git worktree
abbr -a gwta       git worktree add
abbr -a gwtlo      git worktree lock
abbr -a gwtls      git worktree list
abbr -a gwtmv      git worktree move
abbr -a gwtpr      git worktree prune
abbr -a gwtrm      git worktree remove
abbr -a gwtulo     git worktree unlock
####### END Git abbreviations

# Tmux (replaces OMZ tmux plugin aliases)
abbr -a ta         tmux attach
abbr -a ts         tmux new-session -s
abbr -a tl         tmux list-sessions
abbr -a tksv       tmux kill-server
abbr -a tkss       tmux kill-session -t

# Docker
abbr -a dbl        docker build
abbr -a dcin       docker container inspect
abbr -a dcls       docker container ls
abbr -a dclsa      docker container ls -a
abbr -a dib        docker image build
abbr -a dii        docker image inspect
abbr -a dils       docker image ls
abbr -a dipu       docker image push
abbr -a dirm       docker image rm
abbr -a dit        docker image tag
abbr -a dlo        docker container logs
abbr -a dlof       docker container logs -f
abbr -a dnc        docker network create
abbr -a dni        docker network inspect
abbr -a dnls       docker network ls
abbr -a dnrm       docker network rm
abbr -a dpo        docker container port
abbr -a dps        docker ps
abbr -a dpsa       docker ps -a
abbr -a dpu        docker pull
abbr -a dr         docker container run
abbr -a drit       docker container run -it
abbr -a drm        docker container rm
abbr -a dst        docker container start
abbr -a drs        docker container restart
abbr -a dstp       docker container stop
abbr -a dsts       docker stats
abbr -a dtop       docker top
abbr -a dvi        docker volume inspect
abbr -a dvls       docker volume ls
abbr -a dvprune    docker volume prune
abbr -a dxc        docker container exec
abbr -a dxcit      docker container exec -it
abbr -a dipru      docker image prune -a
abbr -a dncn       docker network connect
abbr -a dndcn      docker network disconnect
abbr -a dsta       docker stop \(docker ps -q\)
abbr -a drma       docker rm \(docker ps -qa\)

# Docker Compose
abbr -a dco        docker compose
abbr -a dcb        docker compose build
abbr -a dce        docker compose exec
abbr -a dcps       docker compose ps
abbr -a dcrestart  docker compose restart
abbr -a dcrm       docker compose rm
abbr -a dcr        docker compose run
abbr -a dcstop     docker compose stop
abbr -a dcup       docker compose up
abbr -a dcupb      docker compose up --build
abbr -a dcupd      docker compose up -d
abbr -a dcupdb     docker compose up -d --build
abbr -a dcdn       docker compose down
abbr -a dcl        docker compose logs
abbr -a dclf       docker compose logs -f
abbr -a dcpull     docker compose pull
abbr -a dcstart    docker compose start
abbr -a dck        docker compose kill

# Bun/Node/JS
abbr -a ydx        yarn dlx
abbr -a ywk        yarn workspace
abbr -a yp         'yarn run build && yarn dlx yalc push'
abbr -a ypl        'yarn run build:library && yarn dlx yalc push'
abbr -a bp         'bun run build && bunx yalc push'
abbr -a bx         bunx
