#!/usr/bin/env bash
set -euo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/bin" "$tmp_dir/home"
cat > "$tmp_dir/bin/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ ${1:-} != clone || $# != 3 ]]; then
  printf 'unexpected git command: %s\n' "$*" >&2
  exit 1
fi

printf '%s\t%s\n' "$2" "$3" >> "$GIT_LOG"
mkdir -p "$3/.git"
EOF
chmod +x "$tmp_dir/bin/git"

export HOME="$tmp_dir/home"
export GIT_LOG="$tmp_dir/git-clones.log"
export PATH="$tmp_dir/bin:$PATH"

bash "$repository_root/dotfiles/work/bootstrap-repositories.sh" >/dev/null 2>&1
first_clone_count=$(wc -l < "$GIT_LOG" | tr -d ' ')
if [[ $first_clone_count != 33 ]]; then
  printf 'expected 33 initial clones, got %s\n' "$first_clone_count" >&2
  exit 1
fi

projects_dir="$HOME/Projects"
grep -Fx $'git@github.docusignhq.com:Core/1ds.git\t'"$projects_dir/1ds" "$GIT_LOG" >/dev/null
grep -Fx $'git@github.docusignhq.com:Microservices/ipg-engagements-infra.git\t'"$projects_dir/ipg-engagements-infra" "$GIT_LOG" >/dev/null
grep -Fx $'https://github.docusignhq.com/Microservices/msf-dev\t'"$projects_dir/msf-dev" "$GIT_LOG" >/dev/null

test -d "$projects_dir/1ds/.git"
test -d "$projects_dir/ipg-engagements-infra/.git"
test -d "$projects_dir/msf-dev/.git"
test -d "$projects_dir/widget-starter-kit/.git"

cp "$GIT_LOG" "$tmp_dir/first-run.log"
bash "$repository_root/dotfiles/work/bootstrap-repositories.sh" >/dev/null 2>&1
cmp "$tmp_dir/first-run.log" "$GIT_LOG"
