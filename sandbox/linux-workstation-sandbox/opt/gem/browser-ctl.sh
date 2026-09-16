#!/bin/bash

#
# A script to install and configure browser under supervisor.
#

# --- Configuration ---
# The location of your Supervisor program config.
SUPERVISOR_CONF="/opt/gem/supervisord/browser.conf"

# The target directory for installations from .zip files.
INSTALL_DIR="/opt/browser"

# The generic, system-wide link managed by update-alternatives.
# Supervisor should always point to this link.
ALT_LINK="/usr/local/bin/browser"
ALT_NAME="browser"

# --- Installation URLs ---
# URL for official chromium version.
CR_DOWNLOAD_URL_AMD64="https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/1155/chromium-linux.zip"
CR_DOWNLOAD_URL_ARM64="http://voffline.byted.org/download/tos/schedule/cloudbuild/playwright-chromium_133.0.6943.16_arm64.zip"

# URL for rs version.
RS_DOWNLOAD_URL_AMD64="http://voffline.byted.org/download/tos/schedule/cloudbuild/chromium-browser-stable_135.0.7049.78-2_amd64.deb"
RS_DOWNLOAD_URL_ARM64="http://voffline.byted.org/download/tos/schedule/cloudbuild/playwright-chromium_133.0.6943.16_arm64.zip" # This is a placeholder; replace with actual URL if provided.

# URL for Google Chrome (official build).
# Google Chrome is only available for amd64 on Linux.
GC_DOWNLOAD_URL_AMD64="https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_139.0.7258.127-1_amd64.deb"
GC_DOWNLOAD_URL_ARM64="http://voffline.byted.org/download/tos/schedule/cloudbuild/playwright-chromium_133.0.6943.16_arm64.zip" # This is a placeholder; replace with actual URL if provided.

# --- Script Setup ---
# Exit immediately if a command exits with a non-zero status.
set -e
# Treat unset variables as an error.
set -u

# --- Helper Functions ---

# Function to print usage information.
usage() {
  echo "Usage: $0 <command> [options]"
  echo
  echo "Commands:"
  echo "  install <source>      Install a browser. If Supervisor is running, it will restart the service."
  echo "                        <source> can be 'cr' (Chromium), 'gc' (Google Chrome), 'rs',"
  echo "                        or a direct URL to a .deb or .zip file."
  echo
  echo "  set-args '<args>'     Set command-line arguments in Supervisor and restart the service."
  echo "                        Example: $0 set-args '--no-sandbox --start-maximized'"
  echo
  echo "  append-args '<args>'  Append command-line arguments in Supervisor and restart the service."
  echo "                        Example: $0 append-args '--user-data-dir=/tmp/chrome-profile'"
  echo
  exit 1
}

# Function to restart the browser ONLY if the supervisord daemon is running.
# Ideal for build environments like Dockerfiles.
restart_browser_if_running() {
  # Check if supervisorctl can successfully connect to the supervisord process.
  if supervisorctl status >/dev/null 2>&1; then
    echo "Supervisor is running. Restarting the browser service..."
    supervisorctl restart browser
    echo "browser service restarted."
  else
    echo "Supervisor does not appear to be running. Skipping restart."
    echo "The new browser version will be used when the service starts."
  fi
}

# Function to reload supervisor config and restart the browser unconditionally.
# Used by arg-setting commands which run when the container is live.
reload_and_restart_supervisor() {
  echo "Reloading Supervisor configuration and restarting browser..."
  supervisorctl reread
  supervisorctl update
  supervisorctl restart browser
  echo "Supervisor reloaded and browser restarted successfully."
}

# Function to set up update-alternatives.
# $1: The path to the new executable.
# $2: The priority for the alternative.
setup_alternatives() {
  local executable_path="$1"
  local priority="$2"
  echo "Setting up update-alternatives for $executable_path..."
  # Install the new alternative
  update-alternatives --install "$ALT_LINK" "$ALT_NAME" "$executable_path" "$priority"
  # Set the new alternative as the default for this group
  update-alternatives --set "$ALT_NAME" "$executable_path"
  echo "Alternative '$ALT_LINK' now points to the new installation."
}

# --- Main Logic Functions ---

# Function to handle the installation of the browser.
install_browser() {
  local source="$1"
  local url=""

  # Detect CPU architecture and set a suffix for variable names
  local arch
  arch=$(uname -m)
  local arch_suffix

  if [ "$arch" = "aarch64" ]; then
    echo "Detected ARM64 architecture."
    arch_suffix="_ARM64"
  else
    echo "Detected AMD64 (x86_64) architecture."
    arch_suffix="_AMD64"
  fi

  # Determine the URL using a single, clean case statement
  case "$source" in
  cr)
    local url_var="CR_DOWNLOAD_URL${arch_suffix}"
    url="${!url_var}"
    ln -s /etc/browser /etc/chromium
    ;;
  rs)
    local url_var="RS_DOWNLOAD_URL${arch_suffix}"
    url="${!url_var}"
    ln -s /etc/browser /etc/chromium
    ;;
  gc)
    local url_var="GC_DOWNLOAD_URL${arch_suffix}"
    url="${!url_var}"
    mkdir -p /etc/opt/ && ln -s /etc/browser /etc/opt/chrome
    ;;
  http://* | https://*)
    url="$source"
    ;;
  *)
    echo "Error: Invalid source '$source'. Must be 'cr', 'rs', 'gc', or a valid URL." >&2
    usage
    ;;
  esac

  echo "Source set to: $source"

  local filename
  filename=$(basename "$url")
  local temp_file
  temp_file="/tmp/$filename"

  if [[ "$filename" == *.deb ]]; then
    :
  elif [[ "$filename" == *.zip ]]; then
    if [ -d "$INSTALL_DIR" ] && [ "$(ls -A "$INSTALL_DIR")" ]; then
      echo "Error: An existing installation was found in the target directory '$INSTALL_DIR'."
      echo "Please remove this directory manually before proceeding: rm -rf $INSTALL_DIR"
      exit 1
    fi
  else
    echo "Error: Unsupported file type '$filename'."
    exit 1
  fi

  echo "Downloading from: $url"
  curl -# -L -o "$temp_file" "$url"
  echo "Download complete."

  local executable_path=""
  if [[ "$filename" == *.deb ]]; then
    echo "Installing .deb package..."
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get -fy install "$temp_file"
    rm -rf /etc/apt/sources.list.d/*google*.list /etc/apt/sources.list.d/*chromium*.list
    executable_path=$(command -v google-chrome-stable || command -v chromium-browser || command -v chromium)
    if [ -z "$executable_path" ]; then
      echo "Error: Could not find executable after deb installation."
      exit 1
    fi
  elif [[ "$filename" == *.zip ]]; then
    echo "Installing from .zip package..."
    apt-get update

    # Steps to find Chromium dependencies on Ubuntu 22.04-x64 system
    # The following steps are used to obtain the dependency library information required by a specific version of Chromium on Ubuntu 22.04-x64 system
    #
    # 1. Clone the Playwright repository
    #    Clone the source code of Microsoft's Playwright project using the git command to get the complete codebase
    #       `git clone https://github.com/microsoft/playwright.git`
    #
    # 2. Enter the repository directory
    #    Switch to the cloned cloned playwright directory that was cloned to perform subsequent operations
    #       `cd playwright`
    #
    # 3. View the commit history of the browsers.json file
    #    This file records browser version information. By checking its commit history, you can find the commit record corresponding to the target Chromium version
    #       `git log packages/playwright-core/browsers.json`
    #
    # 4. Search for the commit corresponding to the target version
    #    In the log output from the above command, find the commit record that contains the target Chromium version (e.g., r1155) and get the corresponding commit id
    #
    # 5. View the content of the nativeDeps.ts file in that commit
    #    The nativeDeps.ts file stores dependency information for various browsers on different platforms. View the content of this file at the corresponding version by specifying the commit id
    #       `git show <corresponding-commitid>:packages/playwright-core/src/server/registry/nativeDeps.ts`
    #
    # 6. Extract Chromium dependencies corresponding to Ubuntu 22.04-x64
    #    In the content output from the above command, find the "chromium" dependency array under the "ubuntu22.04-x64" configuration, which contains the dependency libraries required to run Chromium in this environment
    #
    # 7. Copy the dependency information
    #    Copy the found Chromium dependency information to the required location for environment configuration or dependency installation
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libnspr4 libnss3 libpango-1.0-0 libwayland-client0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2
    local extracted_folder_name
    extracted_folder_name=$(unzip -l "$temp_file" | awk -v N=4 'NR==N{print $4}' | sed 's/\///')
    unzip -oq "$temp_file" -d /tmp
    # Ensure the install directory exists and is empty
    rm -rf "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
    mv "/tmp/$extracted_folder_name"/* "$INSTALL_DIR"/
    rm -r "/tmp/$extracted_folder_name"
    executable_path=$(find "$INSTALL_DIR" -maxdepth 2 -type f \( -name "chrome" -o -name "chromium" \) | head -n 1)
    if [ -z "$executable_path" ]; then
      echo "Error: Could not find 'chrome' or 'chromium' executable in the zip file."
      exit 1
    fi
  fi

  setup_alternatives "$executable_path" 150
  restart_browser_if_running

  echo "Cleaning up downloaded file..."
  rm "$temp_file"
  echo "Installation script finished successfully."
}

# Function to set/replace browser arguments.
set_browser_args() {
  if [ ! -f "$SUPERVISOR_CONF" ]; then
    echo "Error: Supervisor config file not found at $SUPERVISOR_CONF"
    exit 1
  fi
  local new_args="$1"
  echo "Setting new arguments: $new_args"
  sed -i.bak -E "s#(command=${ALT_LINK}).*#\1 $new_args#" "$SUPERVISOR_CONF"
  echo "Arguments have been set."
  reload_and_restart_supervisor
}

# Function to append arguments to the existing ones.
append_browser_args() {
  if [ ! -f "$SUPERVISOR_CONF" ]; then
    echo "Error: Supervisor config file not found at $SUPERVISOR_CONF"
    exit 1
  fi
  local extra_args="$1"
  echo "Appending arguments: $extra_args"
  sed -i.bak "/^command=/ s/$/ $extra_args/" "$SUPERVISOR_CONF"
  echo "Arguments have been appended."
  reload_and_restart_supervisor
}

# --- Main Logic ---

# Check for root privileges
if [ "$(id -u)" != 0 ]; then
  echo "This script must be run as root"
  exit 1
fi

# Check if a command is provided
if [ -z "${1:-}" ]; then
  echo "Error: No command specified."
  usage
fi

COMMAND=$1
shift # Remove the command from the arguments list

# Process the command
case "$COMMAND" in
install)
  if [ $# -ne 1 ]; then
    echo "Error: 'install' requires exactly one argument (source)."
    usage
  fi
  install_browser "$1"
  ;;
set-args)
  if [ $# -ne 1 ]; then
    echo "Error: 'set-args' requires exactly one argument (a string of arguments)."
    usage
  fi
  set_browser_args "$1"
  ;;
append-args)
  if [ $# -ne 1 ]; then
    echo "Error: 'append-args' requires exactly one argument (a string of arguments)."
    usage
  fi
  append_browser_args "$1"
  ;;
*)
  echo "Error: Unknown command '$COMMAND'"
  usage
  ;;
esac

exit 0
