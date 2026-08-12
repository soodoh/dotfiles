start_sudo_session() {
  if [ "$(id -u)" -eq 0 ]; then
    return
  fi

  /usr/bin/sudo --validate
  local session_pid="$$"
  (
    while /bin/kill -0 "$session_pid" 2>/dev/null; do
      /usr/bin/sudo --non-interactive --validate 2>/dev/null || exit
      /bin/sleep 30
    done
  ) &
  sudo_keepalive_pid=$!

  cleanup_sudo_session() {
    /bin/kill "$sudo_keepalive_pid" 2>/dev/null || true
    wait "$sudo_keepalive_pid" 2>/dev/null || true
  }
  trap cleanup_sudo_session EXIT
}
