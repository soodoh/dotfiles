#!/bin/bash

provider_icon() {
  case "$1" in
  codex) echo "../assets/codex.png" ;;
  claude) echo "../assets/claude.png" ;;
  copilot) echo "../assets/copilot.png" ;;
  *) echo "../assets/codex.png" ;;
  esac
}

provider_icon "$1"
