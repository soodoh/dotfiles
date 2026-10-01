#!/usr/bin/env bash
set -euo pipefail

repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

mkdir -p "$tmp_dir/bin" "$tmp_dir/home"
cat > "$tmp_dir/bin/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

if [[ ${1:-} != clone || ${2:-} != --quiet || $# != 4 ]]; then
  printf 'unexpected git command: %s\n' "$*" >&2
  exit 1
fi

printf '%s\t%s\n' "$3" "$4" >> "$GIT_LOG"
if [[ ${FAIL_REPO:-} == "${4##*/}" ]]; then
  printf 'fatal: simulated clone failure for %s\n' "$FAIL_REPO" >&2
  exit 23
fi
mkdir -p "$4/.git"
EOF
chmod +x "$tmp_dir/bin/git"

export HOME="$tmp_dir/home"
export GIT_LOG="$tmp_dir/git-clones.log"
export PATH="$tmp_dir/bin:$PATH"

output=$(bash "$repository_root/dotfiles/work/bootstrap-repositories.sh" 2>&1)
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

# Derive expected folder names from actual clone calls, not the configured list.
names=''
count=0
while IFS=$'\t' read -r url destination; do
  names="${names:+$names, }${destination##*/}"
  count=$((count + 1))
done < "$GIT_LOG"
[[ $output == "bootstrap-repositories: successfully cloned repos: $names" ]]

cp "$GIT_LOG" "$tmp_dir/first-run.log"
output=$(bash "$repository_root/dotfiles/work/bootstrap-repositories.sh" 2>&1)
cmp "$tmp_dir/first-run.log" "$GIT_LOG"
[[ $output == "bootstrap-repositories: skipped $count repos because targets already exist" ]]

# A mixed run reports only new clones and skips existing files as well as repos.
{
  IFS=$'\t' read -r url first_destination
  IFS=$'\t' read -r url second_destination
  IFS=$'\t' read -r url existing_destination
} < "$tmp_dir/first-run.log"
rm -rf "$first_destination" "$second_destination" "$existing_destination"
printf 'user-owned file\n' > "$existing_destination"
: > "$GIT_LOG"
output=$(bash "$repository_root/dotfiles/work/bootstrap-repositories.sh" 2>&1)
expected=$(printf 'bootstrap-repositories: skipped %d repos because targets already exist\nbootstrap-repositories: successfully cloned repos: %s, %s' \
  "$((count - 2))" "${first_destination##*/}" "${second_destination##*/}")
[[ $output == "$expected" ]]
[[ $(wc -l < "$GIT_LOG") -eq 2 ]]
[[ $(< "$existing_destination") == 'user-owned file' ]]

# Fail fast without hiding diagnostics or losing the partial success summary.
export HOME="$tmp_dir/failing-home"
export FAIL_REPO="${second_destination##*/}"
: > "$GIT_LOG"
status=0
output=$(bash "$repository_root/dotfiles/work/bootstrap-repositories.sh" 2>&1) || status=$?
[[ $status -eq 23 ]]
expected=$(printf 'fatal: simulated clone failure for %s\nbootstrap-repositories: successfully cloned repos: %s' \
  "$FAIL_REPO" "${first_destination##*/}")
[[ $output == "$expected" ]]
[[ $(wc -l < "$GIT_LOG") -eq 2 ]]
[[ ! -e "$HOME/Projects/$FAIL_REPO" ]]
