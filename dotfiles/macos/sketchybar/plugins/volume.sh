#!/bin/sh

# The volume_change event supplies a $INFO variable in which the current volume
# percentage is passed to the script.

render_volume() {
  VOLUME="$1"

  case "$VOLUME" in
    ''|*[!0-9]*|1??|[2-9]??)
      exit 0
    ;;
    [6-9][0-9]|100) ICON="󰕾"
    ;;
    [3-5][0-9]) ICON="󰖀"
    ;;
    [1-9]|[1-2][0-9]) ICON="󰕿"
    ;;
    *) ICON="󰖁"
  esac

  sketchybar --set "$NAME" icon="$ICON" label="$VOLUME%"
}

if [ "$SENDER" = "volume_change" ] && [ -n "${INFO:-}" ]; then
  render_volume "$INFO"
elif [ -n "${VOLUME_FALLBACK:-}" ]; then
  render_volume "$VOLUME_FALLBACK"
else
  volume="$(osascript -e 'output volume of (get volume settings)' 2>/dev/null || true)"
  [ -n "$volume" ] || exit 0
  render_volume "$volume"
fi
