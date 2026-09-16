#!/bin/bash

set -e

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S,%3N') INFO $@"
}

sleep 3

log "Starting code-server..."
exec /usr/bin/code-server \
  --port ${CODE_SERVER_PORT} \
  --bind-addr=0.0.0.0:${PUBLIC_PORT} \
  --disable-update-check \
  --disable-getting-started-override \
  --trusted-origins "*" \
  --auth=none \
  --user-data-dir=/home/${USER}/.config/code-server/vscode \
  --disable-telemetry \
  --disable-workspace-trust \
  /home/${USER}
