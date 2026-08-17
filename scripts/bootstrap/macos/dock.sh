#!/usr/bin/env bash
set -euo pipefail

command -v dockutil >/dev/null || {
  printf 'error: dockutil is required for Dock reconciliation\n' >&2
  exit 69
}

profile=${DOTFILES_PROFILE:-${MISE_ENV:-}}
case $profile in
  personal-macos)
    apps=(
      '/Applications/Tailscale.app'
      '/Applications/Ghostty.app'
      '/Applications/Zen.app'
      '/Applications/Obsidian.app'
      '/System/Applications/Messages.app'
      '/Applications/Moonlight.app'
      '/Applications/PrusaSlicer.app'
      '/System/Applications/System Settings.app'
    )
    ;;
  work-macos)
    apps=(
      '/Applications/Tailscale.app'
      '/Applications/Ghostty.app'
      '/Applications/Google Chrome.app'
      '/Applications/Zen.app'
      '/Applications/Slack.app'
      "$HOME/Applications/Google Calendar.app"
      '/Applications/Obsidian.app'
      '/System/Applications/Messages.app'
      '/System/Applications/System Settings.app'
      '/Applications/Privileges.app'
    )
    ;;
  *)
    printf 'error: unsupported profile: %s\n' "${profile:-unset}" >&2
    exit 64
    ;;
esac

changed=false
position=1
for app in "${apps[@]}"; do
  if [[ ! -e $app ]]; then
    printf 'warning: Dock application is missing and was not added: %s\n' "$app" >&2
    ((position += 1))
    continue
  fi
  name=$(basename "$app" .app)
  if dockutil --find "$app" >/dev/null 2>&1; then
    dockutil --move "$name" --position "$position" --no-restart >/dev/null
    changed=true
  elif dockutil --find "$name" >/dev/null 2>&1; then
    dockutil --add "$app" --replacing "$name" --position "$position" --no-restart >/dev/null
    changed=true
  else
    dockutil --add "$app" --position "$position" --no-restart >/dev/null
    changed=true
  fi
  ((position += 1))
done

if ! dockutil --find "$HOME/Downloads" >/dev/null 2>&1; then
  dockutil --add "$HOME/Downloads" --section others --view grid --display folder --sort dateadded --no-restart >/dev/null
  changed=true
fi

if [[ $changed == true ]]; then
  killall Dock >/dev/null 2>&1 || true
fi
