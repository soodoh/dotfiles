#!/bin/sh

# SketchyBar suppresses exit events when moving from the button into its
# popup. Hide only after leaving that combined hover region; updates/clicks
# must not toggle or pin the popup open.
case "${SENDER:-}" in
  mouse.entered)
    sketchybar --set "$NAME" popup.drawing=on
    ;;
  mouse.exited|mouse.exited.global)
    sketchybar --set "$NAME" popup.drawing=off
    ;;
esac
