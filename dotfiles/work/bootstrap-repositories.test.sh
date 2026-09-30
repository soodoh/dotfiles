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
if [[ ! -s "$GIT_LOG" ]]; then
  printf 'expected at least one repository clone\n' >&2
  exit 1
fi

duplicate_destinations=$(cut -f2 "$GIT_LOG" | sort | uniq -d)
if [[ -n $duplicate_destinations ]]; then
  printf 'repository destinations must be unique:\n%s\n' "$duplicate_destinations" >&2
  exit 1
fi

while IFS=$'\t' read -r url destination; do
  [[ -n $url && $destination == "$HOME/Projects/"* ]]
  test -d "$destination/.git"
done < "$GIT_LOG"

cp "$GIT_LOG" "$tmp_dir/first-run.log"
bash "$repository_root/dotfiles/work/bootstrap-repositories.sh" >/dev/null 2>&1
cmp "$tmp_dir/first-run.log" "$GIT_LOG"
