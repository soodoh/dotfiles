#!/bin/sh

# Some events send additional information specific to the event in the $INFO
# variable. E.g. the front_app_switched event sends the name of the newly
# focused application in the $INFO variable:
# https://felixkratz.github.io/SketchyBar/config/events#events-and-scripting

render_front_app() {
  sketchybar --set "$NAME" label="$1"
}

if [ "$SENDER" = "front_app_switched" ]; then
  render_front_app "${INFO:-}"
elif [ -n "${FRONT_APP_FALLBACK:-}" ]; then
  render_front_app "$FRONT_APP_FALLBACK"
else
  front_app="$(aerospace list-windows --focused --format '%{app-name}' 2>/dev/null || true)"
  [ -n "$front_app" ] || exit 0
  render_front_app "$front_app"
fi
