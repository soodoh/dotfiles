#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
render_only=false
if [[ ${1:-} == --render-only ]]; then
  [[ $# -eq 2 ]] || {
    printf 'usage: %s --render-only OUTPUT_DIR\n' "$0" >&2
    exit 64
  }
  render_only=true
  agents_dir=$2
  logs_dir="$agents_dir/logs"
else
  [[ $# -eq 0 ]] || {
    printf 'usage: %s [--render-only OUTPUT_DIR]\n' "$0" >&2
    exit 64
  }
  agents_dir="$HOME/Library/LaunchAgents"
  logs_dir="$HOME/Library/Logs"
fi
uid=$(id -u)
mkdir -p "$agents_dir" "$logs_dir"
if [[ $render_only == false ]]; then
  for executable in \
    /Applications/AeroSpace.app/Contents/MacOS/AeroSpace \
    /opt/homebrew/bin/sketchybar \
    /opt/homebrew/bin/borders \
    /opt/homebrew/bin/colima; do
    [[ -x $executable ]] || {
      printf 'error: service executable is missing: %s\n' "$executable" >&2
      exit 69
    }
  done
fi

python3 - "$repo_root" "$HOME" "$agents_dir" <<'PY'
import plistlib
import sys
from pathlib import Path

repo = Path(sys.argv[1])
home = Path(sys.argv[2])
out = Path(sys.argv[3])
path = f"{home}/.local/share/mise/shims:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
common = {"RunAtLoad": True, "EnvironmentVariables": {"PATH": path}}
agents = {
    "dev.soodoh.aerospace": {
        **common,
        "Label": "dev.soodoh.aerospace",
        "ProgramArguments": ["/Applications/AeroSpace.app/Contents/MacOS/AeroSpace"],
        "StandardOutPath": str(home / "Library/Logs/aerospace.log"),
        "StandardErrorPath": str(home / "Library/Logs/aerospace.error.log"),
    },
    "dev.soodoh.sketchybar": {
        **common,
        "Label": "dev.soodoh.sketchybar",
        "ProgramArguments": [str(repo / "scripts/bootstrap/macos/sketchybar-after-aerospace.sh")],
        "StandardOutPath": str(home / "Library/Logs/sketchybar.log"),
        "StandardErrorPath": str(home / "Library/Logs/sketchybar.error.log"),
    },
    "dev.soodoh.borders": {
        **common,
        "Label": "dev.soodoh.borders",
        "ProgramArguments": [
            "/opt/homebrew/bin/borders",
            "active_color=0xff7aa2f7",
            "inactive_color=0xff3b4261",
            "width=5.0",
        ],
        "StandardOutPath": str(home / "Library/Logs/jankyborders.log"),
        "StandardErrorPath": str(home / "Library/Logs/jankyborders.error.log"),
    },
    "dev.soodoh.colima-default": {
        **common,
        "Label": "dev.soodoh.colima-default",
        "ProgramArguments": [
            "/opt/homebrew/bin/colima",
            "start",
            "--foreground",
            "--profile",
            "default",
        ],
        "StandardOutPath": str(home / "Library/Logs/colima-default.log"),
        "StandardErrorPath": str(home / "Library/Logs/colima-default.error.log"),
    },
}
for label, data in agents.items():
    with (out / f"{label}.plist.new").open("wb") as handle:
        plistlib.dump(data, handle, sort_keys=True)
PY

for label in dev.soodoh.aerospace dev.soodoh.sketchybar dev.soodoh.borders dev.soodoh.colima-default; do
  new_plist="$agents_dir/$label.plist.new"
  target=${new_plist%.new}
  if [[ $render_only == true ]]; then
    mv "$new_plist" "$target"
    continue
  fi
  changed=false
  if [[ ! -f $target ]] || ! cmp -s "$new_plist" "$target"; then
    changed=true
    if launchctl print "gui/$uid/$label" >/dev/null 2>&1; then
      launchctl bootout "gui/$uid/$label" >/dev/null 2>&1 || true
    fi
    mv "$new_plist" "$target"
    chmod 600 "$target"
  else
    rm -f "$new_plist"
  fi
  if [[ $changed == true ]] || ! launchctl print "gui/$uid/$label" >/dev/null 2>&1; then
    launchctl bootstrap "gui/$uid" "$target"
  fi
done
