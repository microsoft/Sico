#!/bin/bash

# Declare the array that will hold the final list of ports to check.
PORTS_ARRAY=()

if [ -n "$WAIT_PORTS" ]; then
  if [ -f /opt/gem/mcp.disabled ]; then
    if [ -n "$MCP_SERVER_PORT" ]; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') - /opt/gem/mcp.disabled found, removing port $MCP_SERVER_PORT from wait list."
      WAIT_PORTS=$(echo "$WAIT_PORTS" | sed -e "s/$MCP_SERVER_PORT,//g" -e "s/,$MCP_SERVER_PORT//g" -e "s/^$MCP_SERVER_PORT$//g")
    fi
  fi

  IFS=',' read -ra PORTS_ARRAY <<<"$WAIT_PORTS"
else
  [ -n "$GEM_SERVER_PORT" ] && PORTS_ARRAY+=("$GEM_SERVER_PORT")
  [ -n "$BROWSER_REMOTE_DEBUGGING_PORT" ] && PORTS_ARRAY+=("$BROWSER_REMOTE_DEBUGGING_PORT")

  if [ -n "$MCP_SERVER_PORT" ]; then
    if [ -f /opt/gem/mcp.disabled ]; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') - /opt/gem/mcp.disabled found, removing port $MCP_SERVER_PORT from wait list."
    else
      PORTS_ARRAY+=("$MCP_SERVER_PORT")
    fi
  fi
fi

if [ ${#PORTS_ARRAY[@]} -eq 0 ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') - No ports to wait for. Proceeding directly."
else
  echo "$(date '+%Y-%m-%d %H:%M:%S') - Waiting for services to be ready..."
  echo "Ports to check: $(IFS=,; echo "${PORTS_ARRAY[*]}")"
  echo "Timeout: ${WAIT_TIMEOUT}s, Check interval: ${WAIT_INTERVAL}s"

  start_time=$(date +%s)

  while true; do
    all_ready=true

    for port in "${PORTS_ARRAY[@]}"; do
      port=$(echo "$port" | xargs)
      if [ -z "$port" ]; then
        continue
      fi

      if ! nc -z localhost "$port" >/dev/null 2>&1; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') - Waiting for localhost:$port..."
        all_ready=false
        break
      fi
    done

    if [ "$all_ready" = true ]; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') - All services are ready!"
      break
    fi

    current_time=$(date +%s)
    elapsed=$((current_time - start_time))
    if [ $elapsed -ge ${WAIT_TIMEOUT:-300} ]; then
      echo "$(date '+%Y-%m-%d %H:%M:%S') - Timeout after ${WAIT_TIMEOUT}s waiting for services"
      exit 1
    fi

    sleep ${WAIT_INTERVAL:-0.25}
  done
fi

# Start nginx
echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting nginx..."
exec /usr/sbin/nginx -c /opt/gem/nginx.conf -g 'daemon off;'
