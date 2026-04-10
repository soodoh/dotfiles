#!/bin/bash

provider_icon() {
  case "$1" in
    codex) echo "../assets/ai_usage/codex.png" ;;
    claude) echo "../assets/ai_usage/claude.png" ;;
    copilot) echo "../assets/ai_usage/copilot.png" ;;
    *) echo "../assets/ai_usage/codex.png" ;;
  esac
}

provider_icon "$1"
