#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

# --- Functions ---

# Function to display usage information
usage() {
  echo "Usage: $0 {install|enable|disable} [version]"
  echo ""
  echo "Commands:"
  echo "  install [version]   Install mcp server. If no version is specified, the latest version will be installed."
  echo "                      This command will automatically enable the service after installation."
  echo "  enable              Enable and start the mcp server by copying configuration files."
  echo "  disable             Disable the mcp server by removing configuration files."
  exit 1
}

# Function to enable mcp server
enable() {
  echo "--- Enabling mcp server ---"
  mkdir -p /opt/gem/supervisord
  mkdir -p /opt/gem/nginx
  cp /opt/gem/supervisord.mcp.conf /opt/gem/supervisord/mcp.conf
  envsubst '${MCP_SERVER_PORT}' <"/opt/gem/nginx.mcp.conf" >"/opt/gem/nginx/mcp.conf"
  echo "Configuration files copied successfully."

  echo "Reloading Supervisor configuration..."
  supervisorctl reread && supervisorctl update
  echo "mcp server has been enabled successfully."
}

# Function to disable mcp server
disable() {
  echo "--- Disabling mcp server ---"
  # Use -f to avoid errors if files do not exist
  rm -f /opt/gem/supervisord/mcp.conf /opt/gem/nginx/mcp.conf
  echo "Configuration files removed."

  echo "Reloading Supervisor configuration..."
  supervisorctl reread && supervisorctl update
  echo "mcp server has been disabled successfully."
}

# Function to install Node.js and mcp server
install() {
  local version=$1
  # Default Node.js setup URL
  local nodejs_setup_url=${NODEJS_SETUP_URL:-"https://deb.nodesource.com/setup_22.x"}

  echo "--- Starting installation process ---"

  # 1. Install Node.js
  echo "Downloading and setting up Node.js repository..."
  curl -fsSL ${nodejs_setup_url} | bash -
  echo "Updating package list and installing Node.js..."
  apt-get update && apt-get install -y nodejs
  echo "Node.js installation complete."

  # 2. Install mcp server
  if [ -z "$version" ]; then
    echo "Installing the latest version of mcp server globally..."
    npm i @agent-infra/mcp-server-browser -g
  else
    echo "Installing mcp server version $version globally..."
    npm i @agent-infra/mcp-server-browser@"$version" -g # [4, 6]
  fi
  echo "mcp server installation complete."

  # 3. Enable the service if in runtime environment
  if supervisorctl status >/dev/null 2>&1; then
    enable
  fi
}

# --- Main Logic ---

# Check for root privileges
if [ "$(id -u)" != "0" ]; then
  echo "This script must be run as root" 1>&2
  exit 1
fi

# Check if a command is provided
if [ -z "$1" ]; then
  echo "Error: No command specified."
  usage
fi

COMMAND=$1

# Process the command
case "$COMMAND" in
install)
  # The second argument ($2) is the optional version
  install "$2"
  ;;
enable)
  enable
  ;;
disable)
  disable
  ;;
*)
  # Handle unknown commands
  echo "Error: Unknown command '$COMMAND'"
  usage
  ;;
esac

exit 0
