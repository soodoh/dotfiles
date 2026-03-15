#!/bin/bash

icon_map() {
  case "$1" in
  "Alacritty") echo "" ;;
  "App Store") echo "" ;;
  "Calendar") echo "󰸗" ;;
  "Chromium") echo "󰴂" ;; # Playwright
  "Discord") echo "󰙯" ;;
  "Finder") echo "󰀶" ;;
  "Firefox") echo "" ;;
  "Ghostty") echo "" ;;
  "Google Calendar") echo "󰸗" ;;
  "Google Chrome") echo "󰊯" ;;
  "Jellyfin") echo "󰼂" ;;
  "Messages") echo "󰻞" ;;
  "Music") echo "󰝚" ;;
  "Notion") echo "" ;;
  "Obsidian") echo "" ;;
  "Proton Mail") echo "󰴃" ;;
  "Safari") echo "󰀹" ;;
  "Slack") echo "󰒱" ;;
  "System Settings") echo "" ;;
  "Terminal") echo "" ;;
  "Todoist") echo "" ;;
  "kitty") echo "" ;;
  "WezTerm") echo "" ;;
  "Wispr Flow") echo "󰔊" ;;
  "zoom.us") echo "󰕧" ;;
  "Zen") echo "" ;;
  *) echo "󰀻" ;;
  esac
}
icon_map "$1"
