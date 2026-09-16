#!/bin/bash

# Default configuration
DEFAULT_TIMEOUT=300
DEFAULT_INTERVAL=2
DEFAULT_PORT=${MCP_HUB_PORT:-8079}
DEFAULT_CONFIG=${MCP_HUB_CONFIG:-/opt/gem/mcp-hub.json}

# Read configuration from environment variables, use defaults if not set
WAIT_MCP_SERVERS_PORTS=${MCP_HUB_WAIT_PORTS:-$MCP_SERVER_BROWSER_PORT,$MCP_SERVER_CHROME_DEVTOOLS_PORT,$SANDBOX_SRV_PORT}
WAIT_TIMEOUT=${WAIT_TIMEOUT:-$DEFAULT_TIMEOUT}
WAIT_INTERVAL=${WAIT_INTERVAL:-$DEFAULT_INTERVAL}

echo "$(date '+%Y-%m-%d %H:%M:%S') - Waiting for services to be ready..."
echo "Ports to check: $WAIT_MCP_SERVERS_PORTS"
echo "Timeout: ${WAIT_TIMEOUT}s, Check interval: ${WAIT_INTERVAL}s"

# Convert comma-separated string to array
IFS=',' read -ra PORTS_ARRAY <<<"$WAIT_MCP_SERVERS_PORTS"

# Record start time
start_time=$(date +%s)

# Main loop
while true; do
  all_ready=true

  for port in "${PORTS_ARRAY[@]}"; do
    # Remove leading/trailing whitespace
    port=$(echo "$port" | xargs)

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

  # Check timeout
  current_time=$(date +%s)
  elapsed=$((current_time - start_time))
  if [ $elapsed -ge $WAIT_TIMEOUT ]; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') - Timeout after ${WAIT_TIMEOUT}s waiting for services"
    exit 1
  fi

  sleep $WAIT_INTERVAL
done

# Start mcp-hub
echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting mcp-hub..."
exec /usr/bin/mcp-hub --port $DEFAULT_PORT --config /opt/gem/mcp-hub.json
