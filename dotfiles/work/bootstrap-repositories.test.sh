#!/usr/bin/env bash
set -euo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
original_path=$PATH
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/bin" "$tmp_dir/home"
cat > "$tmp_dir/bin/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ $1 == clone && ${2:-} == -h ]]; then
  printf '    --ref-format <format>\n'
  exit 0
fi

if [[ $1 == clone ]]; then
  argument_count=$#
  target=${!argument_count}
  repo_url_index=$((argument_count - 1))
  repo_url=${!repo_url_index}
  printf '%s\n' "$repo_url" >> "$GIT_LOG"
  printf '%s\n' "$*" >> "$GIT_COMMAND_LOG"
  mkdir -p "$target"
  exit 0
fi

if [[ $2 == symbolic-ref ]]; then
  printf 'refs/heads/main\n'
  exit 0
fi

if [[ $2 == worktree && $3 == add ]]; then
  mkdir -p "$4"
fi
EOF
chmod +x "$tmp_dir/bin/git"

export HOME="$tmp_dir/home"
export GIT_LOG="$tmp_dir/git-clones.log"
export GIT_COMMAND_LOG="$tmp_dir/git-commands.log"
export PATH="$tmp_dir/bin:$PATH"

fish "$repository_root/dotfiles/work/bootstrap-repositories.fish" >/dev/null 2>&1
first_clone_count=$(wc -l < "$GIT_LOG" | tr -d ' ')
if [[ $first_clone_count != 33 ]]; then
  printf 'expected 33 initial clones, got %s\n' "$first_clone_count" >&2
  exit 1
fi

reftable_clone_count=$(grep -c '^clone --bare --ref-format=reftable ' "$GIT_COMMAND_LOG")
if [[ $reftable_clone_count != 33 ]]; then
  printf 'expected 33 reftable clones, got %s\n' "$reftable_clone_count" >&2
  exit 1
fi

cp "$GIT_LOG" "$tmp_dir/first-run.log"
fish "$repository_root/dotfiles/work/bootstrap-repositories.fish" >/dev/null 2>&1
cmp "$tmp_dir/first-run.log" "$GIT_LOG"

test -d "$HOME/Projects/1ds/main"
test -d "$HOME/Projects/ipg-engagements/infra/main"
test -d "$HOME/Projects/msf-dev/main"
test -d "$HOME/Projects/widget-starter-kit/main"

export PATH="$original_path"
clone_help=$(git clone -h 2>&1 || true)
if grep -q 'ref-format' <<< "$clone_help"; then
  collision_root="$tmp_dir/ref-collision"
  mkdir -p "$collision_root/clones"
  git init --initial-branch=main "$collision_root/source" >/dev/null
  git -C "$collision_root/source" config user.email test@example.com
  git -C "$collision_root/source" config user.name Test

  printf 'one\n' > "$collision_root/source/file"
  git -C "$collision_root/source" add file
  git -C "$collision_root/source" commit -m one >/dev/null
  first_oid=$(git -C "$collision_root/source" rev-parse HEAD)

  printf 'two\n' > "$collision_root/source/file"
  git -C "$collision_root/source" commit -am two >/dev/null
  second_oid=$(git -C "$collision_root/source" rev-parse HEAD)

  printf 'main\n' > "$collision_root/source/file"
  git -C "$collision_root/source" commit -am main >/dev/null
  main_oid=$(git -C "$collision_root/source" rev-parse HEAD)

  git clone --bare "$collision_root/source" "$collision_root/remote.git" >/dev/null 2>&1
  printf '# pack-refs with: peeled fully-peeled\n%s refs/heads/main\n%s refs/heads/rampEnableNotaryGroupRecipientsForSBS\n%s refs/heads/rampenableNotaryGroupRecipientsForSBS\n' \
    "$main_oid" "$first_oid" "$second_oid" > "$collision_root/remote.git/packed-refs"
  rm -rf "$collision_root/remote.git/refs/heads"
  mkdir -p "$collision_root/remote.git/refs/heads"
  git --git-dir="$collision_root/remote.git" symbolic-ref HEAD refs/heads/main

  fish -c 'source "$argv[1]"; cd "$argv[2]"; gbclone "$argv[3]" martini-app' \
    "$repository_root/dotfiles/common/fish/custom/functions/gbclone.fish" \
    "$collision_root/clones" \
    "$collision_root/remote.git" >/dev/null 2>&1

  cloned_git_dir="$collision_root/clones/martini-app/.git"
  test "$(git --git-dir="$cloned_git_dir" rev-parse --show-ref-format)" = reftable
  test "$(git --git-dir="$cloned_git_dir" rev-parse refs/remotes/origin/rampEnableNotaryGroupRecipientsForSBS)" = "$first_oid"
  test "$(git --git-dir="$cloned_git_dir" rev-parse refs/remotes/origin/rampenableNotaryGroupRecipientsForSBS)" = "$second_oid"
fi
