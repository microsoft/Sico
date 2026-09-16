#!/bin/bash

set -e

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S,%3N') INFO $@"
}

log "Starting browser..."

readarray -t cmd_args < <(xargs -n1 printf '%s\n' <<<"$BROWSER_COMMANDLINE_ARGS")
readarray -t extra_args < <(xargs -n1 printf '%s\n' <<<"$BROWSER_EXTRA_ARGS")

exec "${BROWSER_EXECUTABLE_PATH}" \
  --user-data-dir="/home/${USER}/.config/browser" \
  "${cmd_args[@]}" \
  "${extra_args[@]}"
