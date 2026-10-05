#!/bin/sh

# Treat the stats popup as a tooltip: leaving the button closes it, even
# when moving into the popup. Subscribe only to item enter/exit events;
# mouse.exited.global enables SketchyBar's combined button/popup hover region.
case "${SENDER:-}" in
  mouse.entered)
    sketchybar --set "$NAME" popup.drawing=on
    ;;
  mouse.exited)
    sketchybar --set "$NAME" popup.drawing=off
    ;;
esac
