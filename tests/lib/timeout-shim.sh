# Portable `timeout` fallback for systems without GNU coreutils (e.g. stock macOS).
# Source this file; it defines a `timeout` shell function ONLY when neither
# `timeout` nor `gtimeout` is already on PATH.

if ! command -v timeout >/dev/null 2>&1; then
  if command -v gtimeout >/dev/null 2>&1; then
    timeout() { gtimeout "$@"; }
  else
    timeout() {
      local duration="$1"
      shift
      "$@" &
      local child=$!
      ( sleep "$duration"; kill -TERM "$child" 2>/dev/null ) &
      local watcher=$!
      local status
      wait "$child"
      status=$?
      kill "$watcher" 2>/dev/null
      wait "$watcher" 2>/dev/null
      return "$status"
    }
  fi
  # Make the function visible to child bash processes (e.g. sub-scripts run
  # by a runner that sourced this shim).
  export -f timeout
fi
