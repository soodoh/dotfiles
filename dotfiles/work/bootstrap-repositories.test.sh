#!/usr/bin/env bash
set -euo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/bin" "$tmp_dir/home"
cat > "$tmp_dir/bin/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ $1 == clone ]]; then
  printf '%s\n' "$3" >> "$GIT_LOG"
  mkdir -p "$4"
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
export PATH="$tmp_dir/bin:$PATH"

fish "$repository_root/dotfiles/work/bootstrap-repositories.fish" >/dev/null 2>&1
first_clone_count=$(wc -l < "$GIT_LOG" | tr -d ' ')
if [[ $first_clone_count != 33 ]]; then
  printf 'expected 33 initial clones, got %s\n' "$first_clone_count" >&2
  exit 1
fi

cp "$GIT_LOG" "$tmp_dir/first-run.log"
fish "$repository_root/dotfiles/work/bootstrap-repositories.fish" >/dev/null 2>&1
cmp "$tmp_dir/first-run.log" "$GIT_LOG"

test -d "$HOME/Projects/1ds/main"
test -d "$HOME/Projects/ipg-engagements/infra/main"
test -d "$HOME/Projects/msf-dev/main"
test -d "$HOME/Projects/widget-starter-kit/main"
