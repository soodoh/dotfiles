#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)
config_source="$repo_root/dotfiles/common/nvim"

rg -F 'vim.treesitter.language.register("json", "jsonc")' \
  "$config_source/lua/plugins/productivity/nvim-treesitter.lua" >/dev/null || {
  printf 'error: jsonc is not registered to use the JSON parser\n' >&2
  exit 1
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/home" "$work/config" "$work/data" "$work/cache" "$work/state"
cp -R "$config_source" "$work/config/nvim"
lock_before=$(shasum -a 256 "$config_source/lazy-lock.json" | awk '{print $1}')

export HOME="$work/home"
export XDG_CONFIG_HOME="$work/config"
export XDG_DATA_HOME="$work/data"
export XDG_CACHE_HOME="$work/cache"
export XDG_STATE_HOME="$work/state"

nvim --headless '+Lazy! sync' +qa
nvim --headless -l "$config_source/tests/validate.lua"

lock_after=$(shasum -a 256 "$config_source/lazy-lock.json" | awk '{print $1}')
[[ $lock_before == "$lock_after" ]] || {
  printf 'error: Neovim validation changed the checked-in lazy lock\n' >&2
  exit 1
}
