#!/bin/bash

icon_map() {
  case "$1" in
    "Google Chrome") echo "󰊯" ;;
    "Firefox") echo "" ;;
    "Safari") echo "󰀹" ;;
    "Slack") echo "󰒱" ;;
    "kitty") echo "" ;;
    "Proton Mail") echo "󰴃" ;;
    "Todoist") echo "" ;;
    "Notion") echo "" ;;
    "Messages") echo "󰻞" ;;
    "Discord") echo "󰙯" ;;
    "System Settings") echo "" ;;
    "Zoom") echo "󰕧" ;;
    *) echo "" ;;
  esac
}
icon_map "$1"
