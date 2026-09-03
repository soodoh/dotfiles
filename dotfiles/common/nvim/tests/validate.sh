#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)
config_source="$repo_root/dotfiles/common/nvim"
parser_source="$config_source/lua/treesitter-parsers.lua"
cache_root=${NVIM_VALIDATE_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/dotfiles-nvim-validation}

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

hash_input() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

nvim_version_output=$(nvim --version)
nvim_version=${nvim_version_output%%$'\n'*}
cache_key=$(
  printf '%s\n' \
    "$(uname -s)" \
    "$(uname -m)" \
    "$nvim_version" \
    "$(hash_file "$config_source/lazy-lock.json")" \
    "$(hash_file "$parser_source")" | hash_input
)
data_home="$cache_root/$cache_key"
lock_dir="${TMPDIR:-/tmp}/dotfiles-nvim-validation-$cache_key.lock"

work=$(mktemp -d)
lock_owned=false
cleanup() {
  rm -rf "$work"
  if [[ $lock_owned == true ]]; then
    rm -rf "$lock_dir"
  fi
}
trap cleanup EXIT

mkdir -p "$cache_root"
deadline=$((SECONDS + 300))
until mkdir "$lock_dir" 2>/dev/null; do
  if [[ -f "$lock_dir/pid" ]]; then
    lock_pid=$(<"$lock_dir/pid")
    if [[ $lock_pid =~ ^[0-9]+$ ]] && ! kill -0 "$lock_pid" 2>/dev/null; then
      rm -rf "$lock_dir"
      continue
    fi
  fi
  if ((SECONDS >= deadline)); then
    printf 'error: timed out waiting for Neovim validation cache lock: %s\n' "$lock_dir" >&2
    exit 1
  fi
  sleep 1
done
lock_owned=true
printf '%s\n' "$$" >"$lock_dir/pid"

mkdir -p "$work/home" "$work/config" "$work/cache" "$work/state" "$data_home"
cp -R "$config_source" "$work/config/nvim"
copied_lock="$work/config/nvim/lazy-lock.json"
lock_before=$(hash_file "$copied_lock")

export HOME="$work/home"
export XDG_CONFIG_HOME="$work/config"
export XDG_DATA_HOME="$data_home"
export XDG_CACHE_HOME="$work/cache"
export XDG_STATE_HOME="$work/state"

nvim --headless '+Lazy! restore' +qa
NVIM_VALIDATE_SCRIPT="$config_source/tests/validate.lua" \
  nvim --headless '+lua dofile(vim.env.NVIM_VALIDATE_SCRIPT)' +qa

lock_after=$(hash_file "$copied_lock")
[[ $lock_before == "$lock_after" ]] || {
  printf 'error: Neovim restore changed the copied lazy lock\n' >&2
  exit 1
}
