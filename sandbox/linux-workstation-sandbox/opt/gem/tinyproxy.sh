#!/bin/bash

set -e

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S,%3N') INFO $@"
}

sleep 3

log "Starting tinyproxy..."
exec tinyproxy -d -c /etc/tinyproxy.conf
