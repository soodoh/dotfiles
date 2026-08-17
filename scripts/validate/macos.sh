#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
HOME="$work/home" scripts/bootstrap/macos/services.sh --render-only "$work/agents"

python3 - "$work/agents" <<'PY'
import plistlib
import sys
from pathlib import Path

root = Path(sys.argv[1])
expected = {
    "dev.soodoh.aerospace": "/Applications/AeroSpace.app/Contents/MacOS/AeroSpace",
    "dev.soodoh.sketchybar": "sketchybar-after-aerospace.sh",
    "dev.soodoh.borders": "/opt/homebrew/bin/borders",
    "dev.soodoh.colima-default": "/opt/homebrew/bin/colima",
}
for label, needle in expected.items():
    with (root / f"{label}.plist").open("rb") as handle:
        data = plistlib.load(handle)
    if data["Label"] != label or data.get("RunAtLoad") is not True:
        raise SystemExit(f"invalid launch agent: {label}")
    if needle not in " ".join(data["ProgramArguments"]):
        raise SystemExit(f"launch agent command mismatch: {label}")
    if "KeepAlive" in data:
        raise SystemExit(f"{label} must not use KeepAlive")
PY

python3 - <<'PY'
from pathlib import Path
import plistlib

with Path("packages/google-calendar/Google Calendar.app/Contents/Info.plist").open("rb") as handle:
    app = plistlib.load(handle)
assert app["CFBundleIdentifier"] == "dev.soodoh.google-calendar"

text = Path("dotfiles/darwin/.colima/default/colima.yaml").read_text()
for expected in ("cpu: 4", "memory: 8", "disk: 100", "arch: aarch64", "runtime: docker", "vmType: vz", "rosetta: true", "mountType: virtiofs", "mountInotify: true"):
    assert expected in text, expected
PY

for test in dotfiles/darwin/.config/sketchybar/plugins/tests/*_test.sh; do
  bash "$test"
done

mkdir -p "$work/bin"
cat > "$work/bin/brew" <<'BREW'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$BREW_LOG"
[[ $1 == list ]] && exit 0
exit 0
BREW
chmod +x "$work/bin/brew"
BREW_LOG="$work/brew.log" DOTFILES_PROFILE=personal-macos PATH="$work/bin:$PATH" \
  scripts/bootstrap/macos/third-party-homebrew.sh
if grep -E '^install( |$)' "$work/brew.log"; then
  printf 'error: normal bootstrap would upgrade an installed third-party Homebrew package\n' >&2
  exit 1
fi

rg -F 'show_recents = false' mise.toml >/dev/null
rg -F 'NSWindowShouldDragOnGesture = true' mise.toml >/dev/null
rg -F "'/Applications/Tailscale.app'" scripts/bootstrap/macos/dock.sh >/dev/null
rg -F 'Lunar|/Applications/Lunar.app' scripts/bootstrap/macos/login-items.sh >/dev/null
rg -F 'Tailscale|/Applications/Tailscale.app' scripts/bootstrap/macos/login-items.sh >/dev/null
