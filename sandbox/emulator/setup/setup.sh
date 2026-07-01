#!/usr/bin/env bash
# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

# ======================================================================
# Emulator Service — Setup & Management
#
# Unified script that detects OS/architecture, installs prerequisites,
# and manages the emulator API service lifecycle.
#
# Supported platforms:
#   Windows — x86_64 or ARM64 (via Git Bash / MSYS2 / PowerShell)
#             Uses MuMu Player as the Android emulator backend.
#   macOS   — Apple Silicon (M series) or Intel x86_64
#             Uses Android Studio AVD (emulator) as the backend.
#
# Usage:
#   ./setup.sh [COMMAND] [OPTIONS]
#
# Commands:
#   install          Install prerequisites and start the API service (default)
#   start            Start the emulator API service only (background)
#   stop             Stop the emulator API service only
#   restart          Restart the emulator API service only
#   status           Show whether the API service is running
#   bootstrap        Bootstrap the default emulator device; requires API service
#   stop-devices     Stop all running emulator devices
#   logs             Tail the service log file
#   help             Show this help message
#
# Install options:
#   --skip-mumu            Skip MuMu Player download/install (Windows)
#   --skip-sdk             Skip Android SDK installation (macOS)
#   --skip-adbkeyboard     Skip ADBKeyboard installation
#   --skip-edge            Skip Microsoft Edge APK installation
#   --skip-virtualization   Skip Hyper-V enablement (Windows only)
#   --skip-deps            Skip Python dependency installation
#   --no-start             Don't start the service after install
#   --bootstrap            After service start, bootstrap the default device
#   --foreground           Start service in foreground (not background)
#
# Service options:
#   --host <addr>          Bind address (default: 0.0.0.0)
#   --port <int>           Bind port    (default: 8000)
#
# Display options:
#   --width  <int>         Screen width  (default: 720)
#   --height <int>         Screen height (default: 1280)
#   --dpi    <int>         Screen DPI    (default: 320)
#
# Examples:
#   ./setup.sh                          # Full install + start API service
#   ./setup.sh install --no-start       # Install only, don't start
#   ./setup.sh start                    # Start service (background)
#   ./setup.sh bootstrap                # Bootstrap default device after service start
#   ./setup.sh stop-devices             # Stop emulator devices explicitly
#   ./setup.sh stop                     # Stop running service
#   ./setup.sh status                   # Check if service is running
#   ./setup.sh logs                     # Tail service logs
#   ./setup.sh start --foreground       # Start in foreground (Ctrl+C to stop)
# ======================================================================

set -euo pipefail

# ========================= Constants ========================
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EMULATOR_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$EMULATOR_ROOT/.emulator-service.pid"
STATE_FILE="$EMULATOR_ROOT/.emulator-service.env"
LOG_FILE="$EMULATOR_ROOT/.emulator-service.log"
HEALTH_PATH="/health"
DOCS_PATH="/docs"

# Windows — MuMu Player
MUMU_DOWNLOAD_PAGE="https://mumu.163.com/download/"
MUMU_DOWNLOAD_API_BASE="https://mumu.nie.netease.com/api/dl/win?channel="
MUMU_MANAGER_WIN='C:\Program Files\Netease\MuMu\nx_main\MuMuManager.exe'

# macOS — Android Studio AVD
AVD_DEFAULT_ANDROID_HOME="$HOME/Library/Android/sdk"
AVD_NAME_PREFIX="device"
AVD_DEVICE_PROFILE="pixel_6"
AVD_BASE_PORT=5554
ANDROID_API_LEVEL=35

# Direct-download fallbacks (used when Homebrew is not available)
ADOPTIUM_JDK_VERSION=21
CMDLINETOOLS_VERSION="11076708"

# ADBKeyboard
APK_URL="https://github.com/senzhk/ADBKeyBoard/releases/download/v2.4-dev/keyboardservice-debug.apk"
APK_NAME="ADBKeyboard.apk"
PACKAGE_NAME="com.android.adbkeyboard"
IME_ID="com.android.adbkeyboard/.AdbIME"

# Microsoft Edge
EDGE_PACKAGE="com.microsoft.emmx"
EDGE_APK_NAME="MicrosoftEdge.apk"
# Download sources — tried in order; first success wins.
EDGE_APK_URLS=(
    "https://d.apkpure.net/b/XAPK/com.microsoft.emmx?version=latest"
    "https://d.apkpure.net/b/APK/com.microsoft.emmx?version=latest"
)
EDGE_APK_HINT="https://apkpure.com/microsoft-edge/com.microsoft.emmx/download"

# ========================= Defaults =========================
COMMAND=""
SCREEN_WIDTH=720
SCREEN_HEIGHT=1280
SCREEN_DPI=320
SERVICE_HOST="0.0.0.0"
SERVICE_PORT=8000
SKIP_MUMU=false
SKIP_SDK=false
SKIP_ADBKEYBOARD=false
SKIP_EDGE=false
SKIP_VIRTUALIZATION=false
SKIP_DEPS=false
NO_START=false
FOREGROUND=false
BOOTSTRAP_DEVICE=false
MUMU_INSTALLED_THIS_RUN=false
CONFIGURED_MUMU_MANAGER_PATH="$MUMU_MANAGER_WIN"
CONFIGURED_ADB_PATH=""
CONFIGURED_ANDROID_HOME=""
SERVICE_STATE_PID=""
SERVICE_STATE_HOST=""
SERVICE_STATE_PORT=""

# ========================= Helpers ==========================
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[0;33m'
readonly CYAN='\033[0;36m'
readonly BOLD='\033[1m'
readonly RESET='\033[0m'

info()    { echo -e "${CYAN}▸${RESET} $*"; }
success() { echo -e "${GREEN}✓${RESET} $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET} $*"; }
error()   { echo -e "${RED}✗${RESET} $*" >&2; }
fatal()   { error "$@"; exit 1; }

step() {
    echo ""
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${BOLD}  $1${RESET}"
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

require_option_value() {
    local option_name="$1"
    local option_value="${2:-}"
    if [[ -z "$option_value" || "$option_value" == -* ]]; then
        fatal "Option $option_name requires a value."
    fi
}

require_positive_integer_value() {
    local option_name="$1"
    local option_value="$2"
    if [[ ! "$option_value" =~ ^[0-9]+$ || "$option_value" -le 0 ]]; then
        fatal "Option $option_name requires a positive integer. Got: $option_value"
    fi
}

require_port_value() {
    local option_name="$1"
    local option_value="$2"
    if [[ ! "$option_value" =~ ^[0-9]+$ || "$option_value" -lt 1 || "$option_value" -gt 65535 ]]; then
        fatal "Option $option_name requires an integer between 1 and 65535. Got: $option_value"
    fi
}

windows_path_exists() {
    local target_path="$1"
    local pwsh

    pwsh="$(find_powershell)" || return 1
    "$pwsh" -ExecutionPolicy Bypass -NoProfile -Command "if (Test-Path '$target_path') { exit 0 } else { exit 1 }" >/dev/null 2>&1
}

mumu_manager_exists() {
    if [[ "${OS:-}" == "windows" ]]; then
        windows_path_exists "$CONFIGURED_MUMU_MANAGER_PATH"
    else
        return 1
    fi
}

resolve_mumu_adb_path() {
    local pwsh
    local adb_path=""

    CONFIGURED_ADB_PATH=""

    if [[ "${OS:-}" == "macos" ]]; then
        # macOS uses Android SDK adb
        CONFIGURED_ADB_PATH="${CONFIGURED_ANDROID_HOME}/platform-tools/adb"
        return 0
    fi

    [[ "${OS:-}" == "windows" ]] || return 0

    pwsh="$(find_powershell)" || return 1
    adb_path=$("$pwsh" -ExecutionPolicy Bypass -NoProfile -Command "\$manager = '$CONFIGURED_MUMU_MANAGER_PATH'; if (-not \$manager) { exit 1 }; \$parent = Split-Path -Parent \$manager; if (-not \$parent) { exit 1 }; [Console]::Out.Write((Join-Path \$parent 'adb.exe'))" 2>/dev/null || true)
    adb_path="${adb_path//$'\r'/}"

    if [[ -n "$adb_path" ]]; then
        CONFIGURED_ADB_PATH="$adb_path"
    fi
}

adb_binary_exists() {
    if [[ -z "$CONFIGURED_ADB_PATH" ]]; then
        resolve_mumu_adb_path >/dev/null 2>&1 || return 1
    fi

    if [[ "${OS:-}" == "windows" ]]; then
        [[ -n "$CONFIGURED_ADB_PATH" ]] && windows_path_exists "$CONFIGURED_ADB_PATH"
    elif [[ "${OS:-}" == "macos" ]]; then
        [[ -n "$CONFIGURED_ADB_PATH" && -x "$CONFIGURED_ADB_PATH" ]]
    else
        return 1
    fi
}

auto_detect_mumu_manager_path() {
    local pwsh

    [[ "${OS:-}" == "windows" ]] || return 1

    pwsh="$(find_powershell)" || return 1
    "$pwsh" -ExecutionPolicy Bypass -NoProfile -Command "
        function Resolve-Candidate([string]\$candidate) {
            if ([string]::IsNullOrWhiteSpace(\$candidate)) { return \$null }

            \$candidate = [Environment]::ExpandEnvironmentVariables(\$candidate.Trim().Trim([char]34))
            \$match = [regex]::Match(\$candidate, '(?i)[A-Z]:\\[^,]*MuMuManager\.exe')
            if (\$match.Success) {
                \$candidate = \$match.Value
            }

            \$paths = [System.Collections.Generic.List[string]]::new()
            [void]\$paths.Add(\$candidate)

            try {
                if ((Test-Path \$candidate) -and (Get-Item \$candidate).PSIsContainer) {
                    [void]\$paths.Add((Join-Path \$candidate 'MuMuManager.exe'))
                    [void]\$paths.Add((Join-Path \$candidate 'nx_main\\MuMuManager.exe'))
                }
            } catch {}

            foreach (\$path in (\$paths | Select-Object -Unique)) {
                try {
                    if ((Test-Path \$path) -and -not (Get-Item \$path).PSIsContainer -and ([IO.Path]::GetFileName(\$path) -ieq 'MuMuManager.exe')) {
                        return (Resolve-Path \$path).Path
                    }
                } catch {}
            }

            return \$null
        }

        \$sources = [System.Collections.Generic.List[string]]::new()

        foreach (\$keyPath in @(
            'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKCU:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
        )) {
            try {
                Get-ItemProperty \$keyPath -ErrorAction SilentlyContinue |
                    Where-Object { \$_.DisplayName -match 'MuMu' } |
                    ForEach-Object {
                        foreach (\$value in @(\$_.DisplayIcon, \$_.InstallLocation, \$_.InstallSource, \$_.UninstallString, \$_.QuietUninstallString)) {
                            if (-not [string]::IsNullOrWhiteSpace(\$value)) {
                                [void]\$sources.Add([string]\$value)
                            }
                        }
                    }
            } catch {}
        }

        try {
            Get-Process -ErrorAction SilentlyContinue |
                Where-Object { \$_.Path -and \$_.Path -match 'MuMu' } |
                ForEach-Object {
                    [void]\$sources.Add([string]\$_.Path)
                    [void]\$sources.Add((Split-Path -Parent \$_.Path))
                }
        } catch {}

        foreach (\$value in @(
            '$MUMU_MANAGER_WIN',
            (Join-Path \$env:ProgramFiles 'Netease\\MuMu\\nx_main\\MuMuManager.exe')
        )) {
            if (-not [string]::IsNullOrWhiteSpace(\$value)) {
                [void]\$sources.Add([string]\$value)
            }
        }

        if (\${env:ProgramFiles(x86)}) {
            [void]\$sources.Add((Join-Path \${env:ProgramFiles(x86)} 'Netease\\MuMu\\nx_main\\MuMuManager.exe'))
        }

        foreach (\$source in (\$sources | Select-Object -Unique)) {
            \$resolved = Resolve-Candidate \$source
            if (\$resolved) {
                [Console]::Out.Write(\$resolved)
                exit 0
            }
        }

        exit 1
    " 2>/dev/null
}

resolve_mumu_manager_path() {
    local env_file="$EMULATOR_ROOT/.env"
    local configured_path="${MUMU_MANAGER_PATH:-}"
    local default_path="$MUMU_MANAGER_WIN"
    local requested_path=""
    local detected_path=""

    CONFIGURED_MUMU_MANAGER_PATH="$default_path"

    if [[ -z "$configured_path" && -f "$env_file" ]]; then
        configured_path="$(grep -E '^[[:space:]]*MUMU_MANAGER_PATH=' "$env_file" | tail -1 | sed -E 's/^[[:space:]]*MUMU_MANAGER_PATH=//; s/\r$//' || true)"
        configured_path="${configured_path#\"}"
        configured_path="${configured_path%\"}"
        configured_path="${configured_path#\'}"
        configured_path="${configured_path%\'}"
    fi

    requested_path="${configured_path:-$default_path}"
    CONFIGURED_MUMU_MANAGER_PATH="$requested_path"

    if [[ "${OS:-}" == "windows" ]]; then
        if ! windows_path_exists "$requested_path"; then
            if [[ -n "$configured_path" ]]; then
                warn "Configured MUMU_MANAGER_PATH was not found: $configured_path"
            fi

            detected_path="$(auto_detect_mumu_manager_path || true)"
            detected_path="${detected_path//$'\r'/}"

            if [[ -n "$detected_path" ]]; then
                CONFIGURED_MUMU_MANAGER_PATH="$detected_path"
                if [[ -n "$configured_path" ]]; then
                    warn "Falling back to detected MuMu installation: $detected_path"
                elif [[ "$detected_path" != "$default_path" ]]; then
                    info "Auto-detected MuMu installation: $detected_path"
                fi
                _persist_mumu_path_to_env "$detected_path"
            elif [[ "$requested_path" != "$default_path" ]] && windows_path_exists "$default_path"; then
                warn "Configured MUMU_MANAGER_PATH was not found. Falling back to default: $default_path"
                CONFIGURED_MUMU_MANAGER_PATH="$default_path"
            fi
        fi
    fi

    resolve_mumu_adb_path >/dev/null 2>&1 || true
}

_persist_mumu_path_to_env() {
    local path="$1"
    local env_file="$EMULATOR_ROOT/.env"
    local default_path="$MUMU_MANAGER_WIN"

    [[ -n "$path" && "$path" != "$default_path" ]] || return 0

    if [[ -f "$env_file" ]] && grep -qE '^[[:space:]]*MUMU_MANAGER_PATH=' "$env_file" 2>/dev/null; then
        sed -i'' -e "s|^[[:space:]]*MUMU_MANAGER_PATH=.*|MUMU_MANAGER_PATH=$path|" "$env_file" 2>/dev/null || true
    else
        printf '\nMUMU_MANAGER_PATH=%s\n' "$path" >> "$env_file" 2>/dev/null || true
    fi
}

mumu_download_channel() {
    if [[ "${ARCH:-}" == "arm64" ]]; then
        echo "gw_arm"
    else
        echo "gw_win"
    fi
}

download_mumu_official_installer() {
    local pwsh download_channel installer_path installer_path_win

    pwsh="$(find_powershell)" || return 1
    download_channel="$(mumu_download_channel)"

    mkdir -p "$EMULATOR_ROOT/.cache"
    installer_path="$EMULATOR_ROOT/.cache/MuMuInstaller-${download_channel}.exe"
    installer_path_win=$(cygpath -w "$installer_path" 2>/dev/null || echo "$installer_path")

    info "Downloading official MuMu installer (${download_channel})..." >&2
    rm -f "$installer_path"
    if ! "$pwsh" -ExecutionPolicy Bypass -NoProfile -Command "
        \$ProgressPreference = 'SilentlyContinue'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri '${MUMU_DOWNLOAD_API_BASE}${download_channel}' -OutFile '$installer_path_win'
        if (-not (Test-Path '$installer_path_win')) { exit 1 }
        if ((Get-Item '$installer_path_win').Length -lt 1048576) { exit 1 }
    " 2>/dev/null; then
        rm -f "$installer_path"
        return 1
    fi

    if ! verify_mumu_installer_signature "$installer_path_win"; then
        warn "Downloaded MuMu installer failed signature verification. Falling back to manual installation."
        rm -f "$installer_path"
        return 1
    fi

    echo "$installer_path"
}

verify_mumu_installer_signature() {
    local installer_path_win="$1"
    local pwsh

    pwsh="$(find_powershell)" || return 1
    "$pwsh" -ExecutionPolicy Bypass -NoProfile -Command "
        \$path = '$installer_path_win'
        if (-not (Test-Path \$path)) { exit 1 }

        \$signature = Get-AuthenticodeSignature -FilePath \$path
        if (\$signature.Status -ne 'Valid') { exit 1 }

        \$subject = ''
        if (\$signature.SignerCertificate) {
            \$subject = [string]\$signature.SignerCertificate.Subject
        }

        \$company = ''
        try {
            \$company = [string](Get-Item \$path).VersionInfo.CompanyName
        } catch {
        }

        if ((\$subject -match 'NetEase') -or (\$company -match 'NetEase')) {
            exit 0
        }

        exit 1
    " >/dev/null 2>&1
}

launch_mumu_installer_interactive() {
    local installer_path_win="$1"
    local pwsh

    pwsh="$(find_powershell)" || return 1
    "$pwsh" -ExecutionPolicy Bypass -NoProfile -Command "
        try {
            Start-Process -FilePath '$installer_path_win'
            exit 0
        } catch {
            exit 1
        }
    " >/dev/null 2>&1
}

install_mumu_official_installer() {
    local installer_path="$1"
    local pwsh installer_path_win
    local arg_set
    local attempt_state=""

    pwsh="$(find_powershell)" || return 1
    installer_path_win=$(cygpath -w "$installer_path" 2>/dev/null || echo "$installer_path")

    info "Installing MuMu Player from official installer..."
    while IFS= read -r arg_set; do
        [[ -z "$arg_set" ]] && continue
        attempt_state=$("$pwsh" -ExecutionPolicy Bypass -NoProfile -Command "
            \$installer = '$installer_path_win'
            \$args = @(${arg_set})
            try {
                \$proc = Start-Process -FilePath \$installer -ArgumentList \$args -PassThru -WindowStyle Hidden
                if (-not \$proc) {
                    [Console]::Out.Write('start-failed')
                    exit 0
                }
                if (\$proc.WaitForExit(15000)) {
                    [Console]::Out.Write('exited')
                } else {
                    [Console]::Out.Write('interactive')
                }
            } catch {
                [Console]::Out.Write('start-failed')
            }
        " 2>/dev/null || true)

        if [[ "$attempt_state" == "interactive" ]]; then
            warn "Official MuMu installer requires interaction. Waiting for the current installer window to finish..."
            if wait_for_mumu_installation 900; then
                return 0
            fi
            return 1
        fi

        if [[ "$attempt_state" == "exited" ]]; then
            if wait_for_mumu_installation 60; then
                return 0
            fi
        fi
    done <<'EOF'
'/S'
'/silent'
'/verysilent'
'/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-'
'/quiet'
'/qn'
EOF

    warn "Official MuMu installer did not complete silently. Waiting for manual installation to finish..."
    info "Finish the installer window if it is open. Setup will continue automatically after MuMu is detected."
    if launch_mumu_installer_interactive "$installer_path_win"; then
        wait_for_mumu_installation 900
        return $?
    fi

    return 1
}

wait_for_mumu_installation() {
    local timeout_seconds="${1:-300}"
    local elapsed=0

    while [[ $elapsed -lt $timeout_seconds ]]; do
        resolve_mumu_manager_path
        if mumu_manager_exists; then
            # MuMuManager.exe exists, but the installer may still be running.
            # Wait for installer processes to finish before proceeding.
            _wait_for_mumu_installer_process_exit "$((timeout_seconds - elapsed))"
            return 0
        fi
        sleep 3
        elapsed=$((elapsed + 3))
    done

    return 1
}

_wait_for_mumu_installer_process_exit() {
    local remaining="${1:-300}"
    local pwsh

    [[ "${OS:-}" == "windows" ]] || return 0
    pwsh="$(find_powershell 2>/dev/null)" || return 0

    "$pwsh" -ExecutionPolicy Bypass -NoProfile -Command "
        \$remaining = $remaining
        \$elapsed = 0
        while (\$elapsed -lt \$remaining) {
            \$procs = Get-Process -ErrorAction SilentlyContinue |
                Where-Object { \$_.ProcessName -match 'MuMuInstall|MuMuSetup|MuMuPlayer.*Install' }
            if (-not \$procs -or \$procs.Count -eq 0) { exit 0 }
            if (\$elapsed -eq 0) {
                [Console]::Error.WriteLine('Waiting for MuMu installer process to finish...')
            }
            Start-Sleep -Seconds 3
            \$elapsed += 3
        }
        exit 0
    " 2>&1 | while IFS= read -r line; do info "$line"; done || true
}

stop_fresh_install_pad_device_direct() {
    local pwsh

    [[ "${OS:-}" == "windows" ]] || return 0
    [[ "$MUMU_INSTALLED_THIS_RUN" == true ]] || return 0
    [[ -n "$CONFIGURED_MUMU_MANAGER_PATH" ]] || return 0

    pwsh="$(find_powershell)" || return 0
    info "Stopping installer-started MuMu device-0..."
    "$pwsh" -ExecutionPolicy Bypass -NoProfile -Command "
        \$mgr = '$CONFIGURED_MUMU_MANAGER_PATH'
        if (-not (Test-Path \$mgr)) { exit 0 }

        for (\$i = 0; \$i -lt 5; \$i++) {
            try {
                & \$mgr control -v 0 shutdown 2>&1 | Out-Null
                if (\$LASTEXITCODE -eq 0) { exit 0 }
            } catch {
            }
            Start-Sleep -Seconds 1
        }
        exit 0
    " >/dev/null 2>&1 || true
}

resolve_android_home() {
    # Priority: ANDROID_HOME env var > .env file > default path
    local env_file="$EMULATOR_ROOT/.env"
    local ah="${ANDROID_HOME:-}"

    if [[ -z "$ah" && -f "$env_file" ]]; then
        ah="$(grep -E '^[[:space:]]*ANDROID_HOME=' "$env_file" | tail -1 | sed -E 's/^[[:space:]]*ANDROID_HOME=//; s/\r$//' || true)"
        ah="${ah#\"}"
        ah="${ah%\"}"
        ah="${ah#\'}"
        ah="${ah%\'}"
    fi

    CONFIGURED_ANDROID_HOME="${ah:-$AVD_DEFAULT_ANDROID_HOME}"

    # Derive tool paths
    SDKMANAGER="$CONFIGURED_ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
    AVDMANAGER="$CONFIGURED_ANDROID_HOME/cmdline-tools/latest/bin/avdmanager"
    EMULATOR_BIN="$CONFIGURED_ANDROID_HOME/emulator/emulator"
    CONFIGURED_ADB_PATH="$CONFIGURED_ANDROID_HOME/platform-tools/adb"

    # Determine system image based on architecture
    if [[ "$ARCH" == "arm64" ]]; then
        SYSTEM_IMAGE="system-images;android-${ANDROID_API_LEVEL};google_apis;arm64-v8a"
    else
        SYSTEM_IMAGE="system-images;android-${ANDROID_API_LEVEL};google_apis;x86_64"
    fi
}

configure_macos_java_env() {
    [[ "${OS:-}" == "macos" ]] || return 0

    local brew_prefix brew_openjdk_prefix
    if command_exists brew; then
        brew_prefix="$(brew --prefix 2>/dev/null || true)"
        brew_openjdk_prefix="${brew_prefix}/opt/openjdk"
        if [[ -n "$brew_prefix" && -d "$brew_openjdk_prefix/bin" ]]; then
            export PATH="$brew_openjdk_prefix/bin:$PATH"
            export JAVA_HOME="$brew_openjdk_prefix/libexec/openjdk.jdk/Contents/Home"
        fi
    fi

    local local_jdk_home="$CONFIGURED_ANDROID_HOME/jdk/Contents/Home"
    if [[ -x "$local_jdk_home/bin/java" ]]; then
        export PATH="$local_jdk_home/bin:$PATH"
        export JAVA_HOME="$local_jdk_home"
    fi
}

set_avd_config() {
    # macOS only — uses BSD sed syntax (sed -i '' ...)
    local config_file="$1"
    local key="$2"
    local value="$3"
    if grep -q "^${key}=" "$config_file" 2>/dev/null; then
        sed -i '' "s|^${key}=.*|${key}=${value}|" "$config_file"
    else
        echo "${key}=${value}" >> "$config_file"
    fi
}

find_powershell() {
    if command_exists powershell.exe; then
        echo "powershell.exe"
    elif command_exists pwsh; then
        echo "pwsh"
    else
        return 1
    fi
}

describe_python() {
    echo "${PYTHON_CMD[*]}"
}

python_eval() {
    "${PYTHON_CMD[@]}" -c "$1"
}

run_python_module() {
    "${PYTHON_CMD[@]}" -m "$@"
}

python_supports_min_version() {
    "$@" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 13) else 1)' >/dev/null 2>&1
}

venv_python_candidates() {
    printf '%s\n' \
        "$EMULATOR_ROOT/.venv/bin/python" \
        "$EMULATOR_ROOT/.venv/Scripts/python.exe"
}

ensure_local_venv() {
    local venv_dir="$EMULATOR_ROOT/.venv"
    local candidate=""

    while IFS= read -r candidate; do
        if [[ -x "$candidate" ]] && python_supports_min_version "$candidate"; then
            return 0
        fi
    done < <(venv_python_candidates)

    if [[ -d "$venv_dir" ]]; then
        info "Recreating local virtual environment at $venv_dir ..."
        if run_python_module venv --clear "$venv_dir" >/dev/null 2>&1; then
            success "Local virtual environment recreated."
            resolve_python
            return 0
        fi
    else
        info "Creating local virtual environment at $venv_dir ..."
        if run_python_module venv "$venv_dir" >/dev/null 2>&1; then
            success "Local virtual environment created."
            resolve_python
            return 0
        fi
    fi

    fatal "Failed to create sandbox/emulator/.venv using $(describe_python). Ensure the selected Python includes the venv module."
}

exec_service_foreground() {
    exec env MUMU_MANAGER_PATH="$CONFIGURED_MUMU_MANAGER_PATH" \
             ANDROID_HOME="${CONFIGURED_ANDROID_HOME:-}" \
             "${PYTHON_CMD[@]}" -m uvicorn app.main:app --host "$SERVICE_HOST" --port "$SERVICE_PORT"
}

launch_service_background() {
    nohup env MUMU_MANAGER_PATH="$CONFIGURED_MUMU_MANAGER_PATH" \
              ANDROID_HOME="${CONFIGURED_ANDROID_HOME:-}" \
              "${PYTHON_CMD[@]}" -m uvicorn app.main:app \
        --host "$SERVICE_HOST" \
        --port "$SERVICE_PORT" \
        >> "$LOG_FILE" 2>&1 &
}

resolve_python() {
    local kind="" bin="" candidate=""
    while IFS= read -r candidate; do
        if [[ -x "$candidate" ]] && python_supports_min_version "$candidate"; then
            kind="path"
            bin="$candidate"
            break
        fi
    done < <(venv_python_candidates)

    if [[ -z "$bin" ]]; then
        if [[ "${OS:-}" == "windows" ]] && command_exists py && python_supports_min_version "$(command -v py)" -3; then
            kind="launcher"
            bin="$(command -v py)"
        elif command_exists python3 && python_supports_min_version "$(command -v python3)"; then
            kind="path"
            bin="$(command -v python3)"
        elif command_exists python && python_supports_min_version "$(command -v python)"; then
            kind="path"
            bin="$(command -v python)"
        else
            fatal "Python 3.13+ is required but was not found. Create sandbox/emulator/.venv or install Python first."
        fi
    fi

    if [[ "$kind" == "launcher" ]]; then
        PYTHON_CMD=("$bin" -3)
    else
        PYTHON_CMD=("$bin")
    fi
}

save_service_state() {
    local pid="$1"
    printf 'PID=%s\nHOST=%s\nPORT=%s\n' "$pid" "$SERVICE_HOST" "$SERVICE_PORT" > "$STATE_FILE"
    printf '%s\n' "$pid" > "$PID_FILE"
    SERVICE_STATE_PID="$pid"
    SERVICE_STATE_HOST="$SERVICE_HOST"
    SERVICE_STATE_PORT="$SERVICE_PORT"
}

load_service_state() {
    SERVICE_STATE_PID=""
    SERVICE_STATE_HOST=""
    SERVICE_STATE_PORT=""

    if [[ ! -f "$STATE_FILE" ]]; then
        return 1
    fi

    SERVICE_STATE_PID="$(grep '^PID=' "$STATE_FILE" | head -1 | cut -d= -f2- || true)"
    SERVICE_STATE_HOST="$(grep '^HOST=' "$STATE_FILE" | head -1 | cut -d= -f2- || true)"
    SERVICE_STATE_PORT="$(grep '^PORT=' "$STATE_FILE" | head -1 | cut -d= -f2- || true)"

    [[ -n "$SERVICE_STATE_PID" ]]
}

clear_service_state() {
    SERVICE_STATE_PID=""
    SERVICE_STATE_HOST=""
    SERVICE_STATE_PORT=""
    rm -f "$PID_FILE" "$STATE_FILE"
}

terminate_pid() {
    local pid="$1"
    local waited=0

    kill "$pid" 2>/dev/null || true
    while kill -0 "$pid" 2>/dev/null && [[ $waited -lt 10 ]]; do
        sleep 1
        waited=$((waited + 1))
    done

    if kill -0 "$pid" 2>/dev/null; then
        warn "Process didn't exit gracefully, sending SIGKILL..."
        kill -9 "$pid" 2>/dev/null || true
    fi

    # Windows fallback: kill/kill -9 only work for MINGW PIDs from the same
    # session.  For a Windows-native PID (found via port lookup after a bash
    # session restart), use PowerShell Stop-Process instead.
    if [[ "${OS:-}" == "windows" ]] && _win_pid_alive "$pid" 2>/dev/null; then
        info "MINGW kill unavailable for this process, using Windows native termination..."
        _terminate_win_pid "$pid"
        return $?
    fi

    ! kill -0 "$pid" 2>/dev/null
}

service_url() {
    local host="$1"
    local port="$2"
    local display_host="$host"
    if [[ -z "$host" || -z "$port" ]]; then
        echo "unknown"
    else
        if [[ "$display_host" == *:* ]] && [[ "$display_host" != \[*\] ]]; then
            display_host="[$display_host]"
        fi
        echo "http://${display_host}:${port}"
    fi
}

service_docs_url() {
    local base_url
    base_url="$(service_url "$1" "$2")"
    if [[ "$base_url" == "unknown" ]]; then
        echo "unknown"
    else
        echo "${base_url}${DOCS_PATH}"
    fi
}

service_probe_host() {
    case "$1" in
        0.0.0.0|::|"") echo "127.0.0.1" ;;
        *) echo "$1" ;;
    esac
}

wait_for_service_ready() {
    local probe_host probe_url attempt
    probe_host="$(service_probe_host "$SERVICE_HOST")"
    probe_url="$(service_url "$probe_host" "$SERVICE_PORT")$HEALTH_PATH"

    # Give the process a moment to import modules and bind to the port.
    sleep 2

    for attempt in {1..20}; do
        if SERVICE_PROBE_URL="$probe_url" python_eval 'import json, os, urllib.request; response = urllib.request.urlopen(os.environ["SERVICE_PROBE_URL"], timeout=2); payload = json.loads(response.read().decode("utf-8")); raise SystemExit(0 if payload.get("status") == "ok" else 1)' 2>/dev/null; then
            return 0
        fi
        sleep 1
    done

    return 1
}

_find_win_pid_by_port() {
    local port="$1"
    local pwsh win_pid

    [[ "${OS:-}" == "windows" ]] || return 1
    pwsh="$(find_powershell 2>/dev/null)" || return 1

    win_pid=$("$pwsh" -ExecutionPolicy Bypass -NoProfile -Command "
        \$c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if (\$c) { [Console]::Out.Write([string]\$c.OwningProcess) }
    " 2>/dev/null) || return 1
    win_pid="${win_pid//$'\r'/}"

    [[ -n "$win_pid" && "$win_pid" =~ ^[0-9]+$ ]] || return 1
    echo "$win_pid"
}

_win_pid_alive() {
    local win_pid="$1"
    local pwsh
    [[ "${OS:-}" == "windows" ]] || return 1
    pwsh="$(find_powershell 2>/dev/null)" || return 1
    "$pwsh" -ExecutionPolicy Bypass -NoProfile -Command "
        if (Get-Process -Id $win_pid -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }
    " >/dev/null 2>&1
}

_win_service_process_matches() {
    local win_pid="$1"
    local pwsh cmdline=""
    [[ "${OS:-}" == "windows" ]] || return 1
    pwsh="$(find_powershell 2>/dev/null)" || return 1

    cmdline=$("$pwsh" -ExecutionPolicy Bypass -NoProfile -Command "
        \$p = Get-CimInstance Win32_Process -Filter 'ProcessId = $win_pid' -ErrorAction SilentlyContinue
        if (\$p -and \$p.CommandLine) { [Console]::Out.Write([string]\$p.CommandLine) }
    " 2>/dev/null) || return 1
    cmdline="${cmdline//$'\r'/}"

    [[ "$cmdline" == *"uvicorn app.main:app"* || "$cmdline" == *"-m app.main"* || "$cmdline" == *"app.main:app"* ]]
}

_terminate_win_pid() {
    local win_pid="$1"
    local pwsh waited=0
    [[ "${OS:-}" == "windows" ]] || return 1
    pwsh="$(find_powershell 2>/dev/null)" || return 1

    "$pwsh" -ExecutionPolicy Bypass -NoProfile -Command "
        Stop-Process -Id $win_pid -Force -ErrorAction SilentlyContinue
    " >/dev/null 2>&1 || true

    while _win_pid_alive "$win_pid" && [[ $waited -lt 10 ]]; do
        sleep 1
        waited=$((waited + 1))
    done
    ! _win_pid_alive "$win_pid"
}

service_process_matches() {
    local pid="$1"
    local cmdline=""

    if command_exists ps; then
        cmdline="$(ps -p "$pid" -o command= 2>/dev/null || true)"
        if [[ -n "$cmdline" ]]; then
            [[ "$cmdline" == *"uvicorn app.main:app"* || "$cmdline" == *"-m app.main"* || "$cmdline" == *"app.main:app"* ]]
            return $?
        fi
    fi

    if load_service_state && command_exists lsof && [[ -n "$SERVICE_STATE_PORT" ]]; then
        lsof -a -p "$pid" -iTCP:"$SERVICE_STATE_PORT" -sTCP:LISTEN >/dev/null 2>&1
        return $?
    fi

    return 1
}

install_python_deps() {
    if ! run_python_module pip --version >/dev/null 2>&1; then
        info "Selected Python environment does not provide pip. Bootstrapping pip with ensurepip ..."
        if run_python_module ensurepip --upgrade >/dev/null 2>&1; then
            success "pip bootstrapped successfully."
        else
            fatal "Python environment is missing pip and ensurepip failed: $(describe_python)"
        fi
    fi

    info "Installing Python packages (pip install -e .) ..."
    if run_python_module pip install -e .; then
        success "Python dependencies installed."
    else
        fatal "Python package installation failed. Check interpreter, pip, and build tooling: $(describe_python)"
    fi
}

start_default_emulator() {
    local probe_host api_base
    probe_host="$(service_probe_host "$SERVICE_HOST")"
    api_base="$(service_url "$probe_host" "$SERVICE_PORT")"

    local device_index=""

    if [[ "$OS" == "macos" ]]; then
        # macOS: start device-0 (AVD created by setup with pixel_6 profile)
        device_index=0
        if ! ensure_macos_default_avd; then
            return 1
        fi
        info "Starting emulator device-0 via API..."
        if curl -sf -X POST "${api_base}/api/v1/emulators/0/start" \
            -H "Content-Type: application/json" -d '{}' >/dev/null 2>&1; then
            success "Emulator device-0 started."
        else
            warn "Failed to start device-0 via API. You can start it manually:"
            echo "  curl -X POST ${api_base}/api/v1/emulators/0/start -H 'Content-Type: application/json' -d '{}'"
            return 1
        fi
    else
        # Windows (MuMu): device-0 is pad mode. Reuse an existing non-zero
        # device if one was created by a previous install, otherwise create
        # a new phone-mode device.
        local existing_index=""
        while IFS= read -r existing_index; do
            [[ -z "$existing_index" ]] && continue
            info "Found existing device-${existing_index}. Starting it..."
            if curl -sf -X POST "${api_base}/api/v1/emulators/${existing_index}/start" \
                -H "Content-Type: application/json" -d '{}' >/dev/null 2>&1; then
                device_index="$existing_index"
                success "Emulator device-${device_index} started."
                break
            fi
            warn "Failed to start existing device-${existing_index}. Trying the next available device..."
        done < <(list_reusable_mumu_device_indices "$api_base")

        if [[ -z "$device_index" ]]; then
            if ! device_index=$(create_mumu_phone_device "$api_base"); then
                warn "Failed to create the first phone-mode MuMu device. You can create one manually:"
                echo "  curl -X POST ${api_base}/api/v1/emulators/emulator -H 'Content-Type: application/json' -d '{\"count\": 1, \"start\": false}'"
                return 1
            fi

            info "Starting emulator device-${device_index} via API..."
            if curl -sf -X POST "${api_base}/api/v1/emulators/${device_index}/start" \
                -H "Content-Type: application/json" -d '{}' >/dev/null 2>&1; then
                success "Emulator device-${device_index} created and started."
            else
                warn "Failed to start device-${device_index} after creation."
                return 1
            fi
        fi
    fi

    # Install APKs after the device is actually running. This avoids the
    # temporary headless AVD boot/shutdown flow, which can trigger the
    # emulator crash reporter on macOS.
    if [[ -n "$device_index" ]]; then
        if _wait_for_device_ready "$api_base" "$device_index"; then
            if [[ "$OS" != "macos" ]]; then
                if ! _configure_device_display "$api_base" "$device_index"; then
                    warn "Failed to apply display settings on device-${device_index}."
                fi
            fi
            if ! install_apks_via_api "$api_base" "$device_index"; then
                warn "Failed to auto-install one or more APKs on device-${device_index}."
            fi
        else
            warn "Device-${device_index} did not become ready in time. Display/APK setup was skipped."
        fi
    fi
}

ensure_macos_default_avd() {
    [[ "$OS" == "macos" ]] || return 0

    local avd_name="${AVD_NAME_PREFIX}0"
    if "$AVDMANAGER" list avd -c 2>/dev/null | grep -q "^${avd_name}$"; then
        return 0
    fi

    info "AVD '$avd_name' not found. Creating it before bootstrap..."
    if echo "no" | "$AVDMANAGER" create avd \
        -n "$avd_name" \
        -k "$SYSTEM_IMAGE" \
        -d "$AVD_DEVICE_PROFILE" \
        --force >/dev/null; then
        success "AVD '$avd_name' created."
        return 0
    fi

    warn "Failed to create AVD '$avd_name'. Run 'make emulator-setup' to install the required SDK image and retry."
    return 1
}

create_mumu_phone_device() {
    local api_base="$1"
    local create_resp=""
    local created_index=""
    info "Creating a new phone-mode emulator device via API..." >&2
    if ! create_resp=$(curl -sf -X POST "${api_base}/api/v1/emulators/emulator" \
        -H "Content-Type: application/json" -d '{"count": 1, "start": false}' 2>/dev/null); then
        return 1
    fi

    created_index=$(CREATE_RESP="$create_resp" python_eval '
import json, os
payload = json.loads(os.environ["CREATE_RESP"])
created = payload.get("created", [])
print(created[0] if created else "")
' 2>/dev/null || true)

    [[ -n "$created_index" && "$created_index" != "0" ]] || return 1
    printf '%s\n' "$created_index"
}

# Poll until the emulator is responsive through the app API.
_wait_for_device_ready() {
    local api_base="$1" device_index="$2"

    info "Waiting for device-${device_index} to be ready..."
    local waited=0
    while [[ $waited -lt 90 ]]; do
        if curl -sf "${api_base}/api/v1/emulators/${device_index}/apps?include_system=false" >/dev/null 2>&1; then
            success "Device-${device_index} is ready."
            return 0
        fi
        sleep 3
        waited=$((waited + 3))
    done

    return 1
}

# Set the device display resolution via adb shell commands (wm size / wm density).
# Always apply, since MuMu's native default does not match our 720x1280@320 default.
# Re-applying values that already match is a harmless no-op.
_configure_device_display() {
    local api_base="$1" device_index="$2"

    info "Setting display to ${SCREEN_WIDTH}x${SCREEN_HEIGHT} @ ${SCREEN_DPI}dpi on device-${device_index}..."
    local failed=false

    if ! curl -sf -X POST "${api_base}/api/v1/emulators/${device_index}/adb/shell" \
        -H "Content-Type: application/json" \
        -d '{"command": "settings put system accelerometer_rotation 0"}' >/dev/null 2>&1; then
        failed=true
    fi
    if ! curl -sf -X POST "${api_base}/api/v1/emulators/${device_index}/adb/shell" \
        -H "Content-Type: application/json" \
        -d '{"command": "settings put system user_rotation 0"}' >/dev/null 2>&1; then
        failed=true
    fi
    if ! curl -sf -X POST "${api_base}/api/v1/emulators/${device_index}/adb/shell" \
        -H "Content-Type: application/json" \
        -d "{\"command\": \"wm size ${SCREEN_WIDTH}x${SCREEN_HEIGHT}\"}" >/dev/null 2>&1; then
        failed=true
    fi
    if ! curl -sf -X POST "${api_base}/api/v1/emulators/${device_index}/adb/shell" \
        -H "Content-Type: application/json" \
        -d "{\"command\": \"wm density ${SCREEN_DPI}\"}" >/dev/null 2>&1; then
        failed=true
    fi

    [[ "$failed" == false ]]
}

# Query the API for known emulator indices so setup orchestration does not
# depend on a hard-coded scan range.
list_known_emulator_indices() {
    local api_base="$1"
    local payload indices

    payload=$(curl -sf "${api_base}/api/v1/emulators/indices" 2>/dev/null) || return 1
    indices=$(printf '%s' "$payload" \
        | tr -d '[:space:]' \
        | sed -n 's/.*"indices":\[\([^]]*\)\].*/\1/p' \
        | tr ',' '\n' \
        | grep -E '^[0-9]+$' || true)

    [[ -n "$indices" ]] || return 1
    printf '%s\n' "$indices"
}

list_reusable_mumu_device_indices() {
    local api_base="$1"
    local idx
    while IFS= read -r idx; do
        [[ -z "$idx" || "$idx" == "0" ]] && continue
        printf '%s\n' "$idx"
    done < <(list_known_emulator_indices "$api_base")
}

install_apks_via_api() {
    local api_base="$1" device_index="$2"

    local failed=false

    # Install ADBKeyboard
    APK_PATH="$SCRIPT_DIR/$APK_NAME"
    if [[ "$SKIP_ADBKEYBOARD" == false ]]; then
        if _verify_package_installed_via_api "$api_base" "$device_index" "$PACKAGE_NAME"; then
            success "ADBKeyboard already installed. Skipping."
            # Ensure IME is enabled even if already installed
            curl -sf -X POST "${api_base}/api/v1/emulators/${device_index}/adb/shell" \
                -H "Content-Type: application/json" \
                -d "{\"command\": \"ime enable $IME_ID\"}" >/dev/null 2>&1
            curl -sf -X POST "${api_base}/api/v1/emulators/${device_index}/adb/shell" \
                -H "Content-Type: application/json" \
                -d "{\"command\": \"ime set $IME_ID\"}" >/dev/null 2>&1
        elif [[ -f "$APK_PATH" ]]; then
            info "Installing ADBKeyboard on device-${device_index}..."
            if curl -sf -X POST "${api_base}/api/v1/emulators/${device_index}/apps/install" \
                -F "file=@${APK_PATH}" >/dev/null 2>&1; then
                if _verify_package_installed_via_api "$api_base" "$device_index" "$PACKAGE_NAME"; then
                    success "ADBKeyboard installed."
                    # Enable ADBKeyboard IME only after verified install
                    curl -sf -X POST "${api_base}/api/v1/emulators/${device_index}/adb/shell" \
                        -H "Content-Type: application/json" \
                        -d "{\"command\": \"ime enable $IME_ID\"}" >/dev/null 2>&1
                    curl -sf -X POST "${api_base}/api/v1/emulators/${device_index}/adb/shell" \
                        -H "Content-Type: application/json" \
                        -d "{\"command\": \"ime set $IME_ID\"}" >/dev/null 2>&1
                    success "ADBKeyboard enabled as default IME."
                else
                    warn "ADBKeyboard install API returned success, but the package was not found afterward."
                    failed=true
                fi
            else
                warn "ADBKeyboard installation failed."
                failed=true
            fi
        else
            warn "ADBKeyboard APK is missing at $APK_PATH. Skipping installation."
            failed=true
        fi
    fi

    # Install Microsoft Edge
    EDGE_APK_PATH="$SCRIPT_DIR/$EDGE_APK_NAME"
    if [[ "$SKIP_EDGE" == false ]]; then
        if _verify_package_installed_via_api "$api_base" "$device_index" "$EDGE_PACKAGE"; then
            success "Microsoft Edge already installed. Skipping."
        elif [[ -f "$EDGE_APK_PATH" ]]; then
            info "Installing Microsoft Edge on device-${device_index}..."
            if curl -sf -X POST "${api_base}/api/v1/emulators/${device_index}/apps/install" \
                -F "file=@${EDGE_APK_PATH}" >/dev/null 2>&1; then
                if _verify_package_installed_via_api "$api_base" "$device_index" "$EDGE_PACKAGE"; then
                    success "Microsoft Edge installed."
                else
                    warn "Edge install API returned success, but the package was not found afterward."
                    failed=true
                fi
            else
                warn "Microsoft Edge installation failed."
                failed=true
            fi
        else
            warn "Edge APK is missing at $EDGE_APK_PATH. Skipping installation."
            echo "  Download from: $EDGE_APK_HINT"
            failed=true
        fi
    fi

    [[ "$failed" == false ]]
}

_verify_package_installed_via_api() {
    local api_base="$1" device_index="$2" package_name="$3"
    local out attempt

    for attempt in 1 2 3; do
        out=$(curl -sf -X POST "${api_base}/api/v1/emulators/${device_index}/adb/shell" \
            -H "Content-Type: application/json" \
            -d "{\"command\": \"pm list packages ${package_name}\"}" 2>/dev/null) || { sleep 3; continue; }

        if VERIFY_OUT="$out" VERIFY_PKG="$package_name" python_eval '
import json, os, sys
payload = json.loads(os.environ["VERIFY_OUT"])
output = payload.get("output", "")
pkg = os.environ["VERIFY_PKG"]
raise SystemExit(0 if f"package:{pkg}" in output.splitlines() else 1)
' >/dev/null 2>&1; then
            return 0
        fi
        sleep 3
    done
    return 1
}

stop_all_emulators() {
    # Best-effort explicit device shutdown. Service lifecycle commands do not
    # call this automatically because users may be running GUI emulators for
    # unrelated work.

    if [[ "$OS" == "macos" ]]; then
        # macOS AVD: find emulator-* serials in adb devices and kill them
        if [[ -n "$CONFIGURED_ADB_PATH" && -x "$CONFIGURED_ADB_PATH" ]]; then
            local serials
            serials=$("$CONFIGURED_ADB_PATH" devices 2>/dev/null \
                | grep -E '^emulator-[0-9]+\s+device' \
                | awk '{print $1}') || true
            if [[ -n "$serials" ]]; then
                info "Stopping emulator devices..."
                local serial
                while IFS= read -r serial; do
                    [[ -z "$serial" ]] && continue
                    "$CONFIGURED_ADB_PATH" -s "$serial" emu kill >/dev/null 2>&1 \
                        && success "  $serial stopped." \
                        || warn "  $serial stop failed."
                done <<< "$serials"
                # Wait briefly for processes to exit
                sleep 2
            fi
        fi
    else
        # Windows MuMu: try API first, fall back to MuMuManager CLI
        local api_stopped=false
        local api_failed=false

        if [[ -n "$CONFIGURED_MUMU_MANAGER_PATH" ]]; then
            local probe_host api_base
            probe_host="$(service_probe_host "$SERVICE_HOST")"
            api_base="$(service_url "$probe_host" "$SERVICE_PORT")"

            local known_indices=""
            if known_indices=$(list_known_emulator_indices "$api_base"); then
                info "Stopping emulator devices via API..."
                local idx http_code
                while IFS= read -r idx; do
                    [[ -z "$idx" ]] && continue
                    http_code=$(curl -s -o /dev/null -w '%{http_code}' \
                        -X POST "${api_base}/api/v1/emulators/${idx}/stop" 2>/dev/null) || true
                    if [[ "$http_code" == "200" ]]; then
                        success "  Device $idx stopped."
                        api_stopped=true
                    else
                        warn "  Device $idx stop via API failed (HTTP $http_code)."
                        api_failed=true
                    fi
                done <<< "$known_indices"
            fi

            # Fallback: if API was unreachable or didn't stop anything,
            # use MuMuManager CLI directly
            if [[ "$api_stopped" == false || "$api_failed" == true ]]; then
                info "Stopping emulator devices via MuMuManager CLI..."
                local pwsh
                pwsh="$(find_powershell 2>/dev/null)" || true
                if [[ -n "$pwsh" ]]; then
                    "$pwsh" -ExecutionPolicy Bypass -NoProfile -Command "
                        \$mgr = '$CONFIGURED_MUMU_MANAGER_PATH'
                        if (Test-Path \$mgr) {
                            # Scan a reasonable range. MuMu returns exit 0 even
                            # for non-existent indices, so we stop as soon as we
                            # see two consecutive failures to avoid false positives.
                            \$consecutiveFails = 0
                            for (\$i = 0; \$i -le 19; \$i++) {
                                try {
                                    & \$mgr control -v \$i shutdown 2>&1 | Out-Null
                                    \$consecutiveFails = 0
                                } catch {
                                    \$consecutiveFails++
                                    if (\$consecutiveFails -ge 2) { break }
                                }
                            }
                        }
                    " 2>/dev/null || true
                fi
            fi
        fi
    fi
}

validate_supported_runtime() {
    if [[ "${OS:-}" != "windows" && "${OS:-}" != "macos" ]]; then
        fatal "The emulator API service requires Windows or macOS. Current platform is not supported."
    fi
}

validate_runtime_prereqs() {
    local require_mumu="${1:-true}"

    validate_supported_runtime

    if [[ "$OS" == "windows" ]]; then
        find_powershell >/dev/null || fatal "PowerShell not found. Cannot proceed on Windows without PowerShell."
        if [[ "$require_mumu" == "true" ]]; then
            if ! mumu_manager_exists; then
                fatal "MuMu Player is required before setup can continue. Expected manager path: $CONFIGURED_MUMU_MANAGER_PATH"
            fi
            if ! adb_binary_exists; then
                fatal "MuMu bundled adb is required before setup can continue. Expected path: ${CONFIGURED_ADB_PATH:-<unknown>}"
            fi
        fi
    elif [[ "$OS" == "macos" ]]; then
        if [[ "$require_mumu" == "true" ]]; then
            configure_macos_java_env
            java -version >/dev/null 2>&1 \
                || fatal "Java is required before using Android SDK tools." \
                    "Run 'make emulator-setup' from the repo root first."
            [[ -n "$CONFIGURED_ANDROID_HOME" ]] || fatal "ANDROID_HOME is not configured. Run 'make emulator-setup' first."
            [[ -x "$CONFIGURED_ADB_PATH" ]] || fatal "Android SDK adb is required before start/restart. Expected path: ${CONFIGURED_ADB_PATH:-<unknown>}"
            [[ -x "$EMULATOR_BIN" ]] || fatal "Android emulator binary is required before start/restart. Expected path: ${EMULATOR_BIN:-<unknown>}"
            [[ -x "$AVDMANAGER" ]] || fatal "Android avdmanager is required before start/restart. Expected path: ${AVDMANAGER:-<unknown>}"
        fi
    fi
}

validate_device_stop_prereqs() {
    validate_supported_runtime

    if [[ "$OS" == "windows" ]]; then
        if ! find_powershell >/dev/null 2>&1; then
            warn "PowerShell not found. API-based device stop will be attempted, but MuMuManager fallback is unavailable."
        fi
    elif [[ "$OS" == "macos" ]]; then
        [[ -n "$CONFIGURED_ADB_PATH" && -x "$CONFIGURED_ADB_PATH" ]] \
            || fatal "Android SDK adb is required before stopping AVD devices. Expected path: ${CONFIGURED_ADB_PATH:-<unknown>}"
    fi
}

install_python_deps_step() {
    local label="$1"
    if [[ "$SKIP_DEPS" == false ]]; then
        step "$label"
        if [[ -f "$EMULATOR_ROOT/pyproject.toml" ]]; then
            pushd "$EMULATOR_ROOT" > /dev/null
            install_python_deps
            popd > /dev/null
        else
            fatal "pyproject.toml not found at $EMULATOR_ROOT. Cannot install Python dependencies for the emulator service."
        fi
    else
        info "Skipping Python dependencies (--skip-deps)"
    fi
}

download_adbkeyboard_apk() {
    APK_PATH="$SCRIPT_DIR/$APK_NAME"
    if [[ ! -f "$APK_PATH" ]]; then
        info "Downloading ADBKeyboard APK from GitHub..."
        curl -fSL --progress-bar -o "$APK_PATH" "$APK_URL" \
            || { rm -f "$APK_PATH"; warn "Failed to download ADBKeyboard APK."; }
    else
        info "ADBKeyboard APK already cached at $APK_PATH"
    fi
}

download_edge_apk() {
    EDGE_APK_PATH="$SCRIPT_DIR/$EDGE_APK_NAME"
    if [[ -f "$EDGE_APK_PATH" ]]; then
        info "Edge APK already cached at $EDGE_APK_PATH"
        return 0
    fi

    info "Downloading Microsoft Edge APK..."
    local tmp_file="${EDGE_APK_PATH}.tmp"

    # Helper: verify a file starts with ZIP/APK magic (PK\x03\x04)
    _is_zip() { head -c4 "$1" 2>/dev/null | od -A n -t x1 | tr -s ' ' | grep -q "50 4b 03 04"; }

    # Helper: if the downloaded file is an XAPK (zip wrapper), extract the base APK.
    _try_extract_xapk() {
        local xapk="$1" dest="$2"
        if ! _is_zip "$xapk"; then return 1; fi
        # XAPK is a zip containing one or more .apk files. Find the largest one (base APK).
        local best_apk=""
        best_apk=$(unzip -l "$xapk" 2>/dev/null | grep '\.apk$' | sort -rn -k1 | head -1 | awk '{print $NF}')
        if [[ -z "$best_apk" ]]; then
            # Not an XAPK — might be a plain APK already
            return 1
        fi
        info "  XAPK detected. Extracting base APK ($best_apk)..."
        local extract_dir="${xapk}.extract"
        rm -rf "$extract_dir"
        mkdir -p "$extract_dir"
        if unzip -o -q "$xapk" "$best_apk" -d "$extract_dir" 2>/dev/null; then
            if [[ -f "$extract_dir/$best_apk" ]] && _is_zip "$extract_dir/$best_apk"; then
                mv "$extract_dir/$best_apk" "$dest"
                rm -rf "$extract_dir"
                return 0
            fi
        fi
        rm -rf "$extract_dir"
        return 1
    }

    # Helper: try to save a downloaded file as the final APK.
    # Handles both bare APK and XAPK (zip-of-apks) transparently.
    _try_save_downloaded() {
        local src="$1" dest="$2"
        if ! _is_zip "$src"; then return 1; fi
        if unzip -l "$src" 2>/dev/null | grep -q '\.apk$'; then
            # XAPK — extract the base APK
            _try_extract_xapk "$src" "$dest" && return 0
            return 1
        fi
        # Bare APK
        mv "$src" "$dest"
        return 0
    }

    for url in "${EDGE_APK_URLS[@]}"; do
        info "  Trying: $url"
        if curl -fSL --progress-bar --connect-timeout 15 --max-time 600 \
                -o "$tmp_file" "$url" 2>&1; then
            if _try_save_downloaded "$tmp_file" "$EDGE_APK_PATH"; then
                rm -f "$tmp_file"
                success "Edge APK ready ($(du -h "$EDGE_APK_PATH" | cut -f1 | xargs))."
                return 0
            fi
            info "  Downloaded file is not a valid APK/XAPK. Trying next source..."
            rm -f "$tmp_file"
        else
            rm -f "$tmp_file"
            info "  Download failed. Trying next source..."
        fi
    done

    # Fallback: try to use Python to scrape APKPure download page
    info "  Trying APKPure page scraper as fallback..."
    local scraped_url=""
    scraped_url=$(python_eval '
import urllib.request, re, sys
try:
    req = urllib.request.Request(
        "https://apkpure.com/microsoft-edge/com.microsoft.emmx/download",
        headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}
    )
    html = urllib.request.urlopen(req, timeout=15).read().decode("utf-8", errors="replace")
    m = re.search(r"\"(https://d\.apkpure\.[^\"]+(?:\.apk|\.xapk)[^\"]*)\"", html)
    if m: print(m.group(1))
except Exception: pass
' 2>/dev/null || true)

    if [[ -n "$scraped_url" ]]; then
        info "  Found download link. Downloading..."
        if curl -fSL --progress-bar --connect-timeout 15 --max-time 600 \
                -o "$tmp_file" "$scraped_url" 2>&1; then
            if _try_save_downloaded "$tmp_file" "$EDGE_APK_PATH"; then
                rm -f "$tmp_file"
                success "Edge APK ready ($(du -h "$EDGE_APK_PATH" | cut -f1 | xargs))."
                return 0
            fi
        fi
        rm -f "$tmp_file"
    fi

    warn "Auto-download failed. Please download Edge APK manually."
    echo "  Place it at: $EDGE_APK_PATH"
    echo "  Download from: $EDGE_APK_HINT"
    return 1
}

# Install an APK on a running emulator via ADB.
# Usage: install_apk_on_avd <serial> <apk_path> <package_name> <label>
install_apk_on_avd() {
    local serial="$1" apk="$2" pkg="$3" label="$4"
    local adb="$CONFIGURED_ADB_PATH"

    # Check if already installed
    if "$adb" -s "$serial" shell pm list packages 2>/dev/null | grep -q "$pkg"; then
        success "$label already installed."
        return 0
    fi

    if [[ ! -f "$apk" ]]; then
        warn "$label APK not found at $apk. Skipping."
        return 1
    fi

    info "Installing $label ($(du -h "$apk" | cut -f1 | xargs))... This may take a moment."
    if "$adb" -s "$serial" install -r "$apk" 2>&1; then
        success "$label installed."
    else
        warn "$label installation failed."
        return 1
    fi
}

# Wait for the AVD to be fully booted before installing APKs.
# Usage: wait_for_avd_boot <serial> [timeout_seconds]
wait_for_avd_boot() {
    local serial="$1"
    local timeout="${2:-120}"
    local adb="$CONFIGURED_ADB_PATH"
    local waited=0

    info "Waiting for emulator ($serial) to boot..."
    while [[ $waited -lt $timeout ]]; do
        local boot_done
        boot_done=$("$adb" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
        if [[ "$boot_done" == "1" ]]; then
            echo ""
            success "Emulator booted (${waited}s)."
            return 0
        fi
        printf "."
        sleep 3
        waited=$((waited + 3))
    done
    echo ""
    warn "Emulator did not finish booting within ${timeout}s."
    return 1
}

print_install_banner() {
    if [[ "$NO_START" == false ]]; then
        prepare_service_runtime
        do_start || return $?

        if [[ "$BOOTSTRAP_DEVICE" == true ]]; then
            do_bootstrap || return $?
        fi

        echo ""
        echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
        if [[ "$BOOTSTRAP_DEVICE" == true ]]; then
            echo -e "${GREEN}${BOLD}  Installation, service startup, and device bootstrap complete!${RESET}"
        else
            echo -e "${GREEN}${BOLD}  Installation and service startup complete!${RESET}"
        fi
        echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
        echo ""
        if [[ "$BOOTSTRAP_DEVICE" == false ]]; then
            echo "  To start/create the default emulator device:"
            echo "    make emulator-bootstrap"
        fi
    else
        echo ""
        echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
        echo -e "${GREEN}${BOLD}  Installation complete!${RESET}"
        echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
        echo ""
        echo "  To start the service:"
        echo "    make emulator-start"
        echo "  To start/create the default emulator device after that:"
        echo "    make emulator-bootstrap"
    fi
}

prepare_service_runtime() {
    detect_platform
    if [[ "$OS" == "windows" ]]; then
        resolve_mumu_manager_path
    else
        resolve_android_home
    fi
    validate_runtime_prereqs true
    resolve_python
}

show_help() {
    sed -n '/^# Emulator Service/,/^# ====/p' "$0" | sed 's/^# \{0,1\}//' | sed '$d'
    exit 0
}

# ========================= Parse args =======================
# First arg may be a command
if [[ $# -gt 0 ]] && [[ "$1" != --* ]] && [[ "$1" != -* ]]; then
    COMMAND="$1"
    shift
fi

while [[ $# -gt 0 ]]; do
    case "$1" in
        --skip-adb)            fatal "--skip-adb is no longer supported. ADB verification is mandatory." ;;
        --skip-mumu)           SKIP_MUMU=true; shift ;;
        --skip-sdk)            SKIP_SDK=true; shift ;;
        --skip-adbkeyboard)    SKIP_ADBKEYBOARD=true; shift ;;
        --skip-edge)           SKIP_EDGE=true; shift ;;
        --skip-virtualization) SKIP_VIRTUALIZATION=true; shift ;;
        --skip-deps)           SKIP_DEPS=true; shift ;;
        --no-start)            NO_START=true; shift ;;
        --bootstrap)           BOOTSTRAP_DEVICE=true; shift ;;
        --foreground)          FOREGROUND=true; shift ;;
        --host)                require_option_value --host "${2:-}"; SERVICE_HOST="$2"; shift 2 ;;
        --port)                require_option_value --port "${2:-}"; require_port_value --port "$2"; SERVICE_PORT="$2"; shift 2 ;;
        --width)               require_option_value --width "${2:-}"; require_positive_integer_value --width "$2"; SCREEN_WIDTH="$2"; shift 2 ;;
        --height)              require_option_value --height "${2:-}"; require_positive_integer_value --height "$2"; SCREEN_HEIGHT="$2"; shift 2 ;;
        --dpi)                 require_option_value --dpi "${2:-}"; require_positive_integer_value --dpi "$2"; SCREEN_DPI="$2"; shift 2 ;;
        -h|--help|help)        show_help ;;
        *)
            error "Unknown option: $1"
            echo "Run './setup.sh help' for usage."
            exit 1
            ;;
    esac
done

# Default command
[[ -z "$COMMAND" ]] && COMMAND="install"

if [[ "$BOOTSTRAP_DEVICE" == true && "$NO_START" == true ]]; then
    fatal "--bootstrap cannot be used with --no-start. Run 'make emulator-bootstrap' after starting the service."
fi

if [[ "$BOOTSTRAP_DEVICE" == true && "$FOREGROUND" == true ]]; then
    fatal "--bootstrap cannot be used with --foreground because foreground mode execs the service process."
fi

if [[ "$FOREGROUND" == true && ( "$COMMAND" == "bootstrap" || "$COMMAND" == "device-bootstrap" ) ]]; then
    fatal "--foreground is not supported with bootstrap because bootstrap only manages emulator devices."
fi

if [[ "$BOOTSTRAP_DEVICE" == true && "$COMMAND" != "install" && "$COMMAND" != "start" && "$COMMAND" != "restart" ]]; then
    fatal "--bootstrap is only supported with install, start, or restart. Use 'make emulator-bootstrap' for a standalone device bootstrap."
fi

# ========================= OS / Arch Detection ==============
detect_platform() {
    local os arch
    os="$(uname -s)"
    arch="$(uname -m)"

    case "$os" in
        MINGW*|MSYS*|CYGWIN*)
            OS=windows
            case "$arch" in
                x86_64)  ARCH=x86_64 ;;
                aarch64) ARCH=arm64 ;;
                *)       ARCH=x86_64 ;;
            esac
            ;;
        Darwin)
            OS=macos
            case "$arch" in
                arm64)  ARCH=arm64 ;;
                x86_64) ARCH=x86_64 ;;
                *)      ARCH=arm64 ;;
            esac
            ;;
        Linux)
            if grep -qi microsoft /proc/version 2>/dev/null; then
                fatal "WSL is not supported for setup. Run this script on the Windows host where MuMu Player is installed."
            else
                fatal "The emulator API service requires Windows or macOS. Linux is not supported."
            fi
            ;;
        *)
            fatal "Unsupported OS: $os"
            ;;
    esac
}

# ========================= Service Management ===============
get_service_pid() {
    local pid=""

    load_service_state >/dev/null 2>&1 || true
    if [[ -n "$SERVICE_STATE_PID" ]]; then
        pid="$SERVICE_STATE_PID"
    elif [[ -f "$PID_FILE" ]]; then
        pid=$(cat "$PID_FILE")
    fi

    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null && service_process_matches "$pid"; then
        echo "$pid"
        return 0
    fi

    # Windows fallback: MINGW PID is stale (bash session was closed), but the
    # native Windows process may still be running.  Find it by port.
    if [[ "${OS:-}" == "windows" && -n "${SERVICE_STATE_PORT:-}" ]]; then
        local win_pid
        win_pid=$(_find_win_pid_by_port "$SERVICE_STATE_PORT" 2>/dev/null || true)
        if [[ -n "$win_pid" ]] && _win_pid_alive "$win_pid" && _win_service_process_matches "$win_pid"; then
            echo "$win_pid"
            return 0
        fi
    fi

    clear_service_state
    return 1
}

do_start() {
    local pid
    if pid=$(get_service_pid); then
        local running_host="${SERVICE_STATE_HOST:-$SERVICE_HOST}"
        local running_port="${SERVICE_STATE_PORT:-$SERVICE_PORT}"
        warn "Emulator service is already running (PID: $pid)"
        echo "  API docs:       $(service_docs_url "$(service_probe_host "$running_host")" "$running_port")"
        echo "  Stop it first:  make emulator-stop"
        echo "  Or restart:     make emulator-restart"
        return 0
    fi

    # Check if port is already in use
    if command_exists lsof; then
        if lsof -iTCP:"$SERVICE_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
            local blocking_pid
            blocking_pid=$(lsof -iTCP:"$SERVICE_PORT" -sTCP:LISTEN -t 2>/dev/null | head -1)
            error "Port $SERVICE_PORT is already in use (PID: $blocking_pid)"
            echo "  Use --port <other_port> or stop the occupying process."
            return 1
        fi
    fi

    if [[ "$FOREGROUND" == true ]]; then
        info "Starting emulator service in foreground..."
        echo -e "  Listening on: ${BOLD}$(service_url "$(service_probe_host "$SERVICE_HOST")" "$SERVICE_PORT")${RESET}"
        echo -e "  API docs:     ${BOLD}$(service_docs_url "$(service_probe_host "$SERVICE_HOST")" "$SERVICE_PORT")${RESET}"
        echo "  Press Ctrl+C to stop."
        echo ""
        save_service_state "$$"
        cd "$EMULATOR_ROOT"
        exec_service_foreground
    else
        info "Starting emulator service in background..."
        pushd "$EMULATOR_ROOT" > /dev/null
        launch_service_background
        local new_pid=$!
        save_service_state "$new_pid"
        popd > /dev/null

        if kill -0 "$new_pid" 2>/dev/null && wait_for_service_ready; then
            echo ""
            success "Emulator service started successfully!"
            echo ""
            echo -e "  ${BOLD}API docs:${RESET}  $(service_docs_url "$(service_probe_host "$SERVICE_HOST")" "$SERVICE_PORT")"
            echo -e "  ${BOLD}PID:${RESET}       $new_pid"
            echo -e "  ${BOLD}Log file:${RESET}  $LOG_FILE"
            echo ""
            echo "  Bootstrap default device: make emulator-bootstrap"
            echo "  View logs:    make emulator-logs"
            echo "  Stop service: make emulator-stop"
        else
            if kill -0 "$new_pid" 2>/dev/null; then
                warn "Service process did not become ready. Stopping residual process (PID: $new_pid)..."
                terminate_pid "$new_pid" || true
            fi
            clear_service_state
            error "Service failed to become ready. Check logs:"
            echo "  tail -20 $LOG_FILE"
            return 1
        fi
    fi
}

do_bootstrap() {
    local pid
    if pid=$(get_service_pid); then
        SERVICE_HOST="${SERVICE_STATE_HOST:-$SERVICE_HOST}"
        SERVICE_PORT="${SERVICE_STATE_PORT:-$SERVICE_PORT}"
        info "Using emulator service (PID: $pid) at $(service_url "$(service_probe_host "$SERVICE_HOST")" "$SERVICE_PORT")"
    else
        error "Emulator service is not running."
        echo "  Start it first: make emulator-start"
        echo "  Then bootstrap: make emulator-bootstrap"
        return 1
    fi

    if start_default_emulator; then
        success "Default emulator device bootstrap is complete."
    else
        error "Default emulator device bootstrap failed."
        return 1
    fi
}

do_stop() {
    local pid
    if pid=$(get_service_pid); then
        info "Stopping emulator service (PID: $pid)..."
        terminate_pid "$pid" || true
        clear_service_state
        success "Emulator service stopped."
    else
        warn "Emulator service is not running."
    fi
}

do_restart() {
    do_stop
    sleep 1
    do_start
}

do_stop_devices() {
    stop_all_emulators
    success "Emulator device stop request complete."
}

do_status() {
    local pid
    if pid=$(get_service_pid); then
        local running_host="${SERVICE_STATE_HOST:-}"
        local running_port="${SERVICE_STATE_PORT:-}"
        success "Emulator service is running"
        echo -e "  ${BOLD}PID:${RESET}  $pid"
        echo -e "  ${BOLD}API docs:${RESET}  $(service_docs_url "$(service_probe_host "$running_host")" "$running_port")"
        echo -e "  ${BOLD}Log:${RESET}  $LOG_FILE"
    else
        echo "Emulator service is not running."
    fi
}

do_logs() {
    if [[ -f "$LOG_FILE" ]]; then
        info "Tailing $LOG_FILE (Ctrl+C to exit)"
        tail -f "$LOG_FILE"
    else
        warn "No log file found at $LOG_FILE"
        echo "  Start the service first: make emulator-start"
    fi
}

# ========================= Handle non-install commands ======
case "$COMMAND" in
    start)   prepare_service_runtime
             do_start || exit $?
             if [[ "$BOOTSTRAP_DEVICE" == true ]]; then do_bootstrap; fi
             exit $? ;;
    stop)    detect_platform
             if [[ "$OS" == "windows" ]]; then resolve_mumu_manager_path; else resolve_android_home; fi
             load_service_state >/dev/null 2>&1 || true
             SERVICE_HOST="${SERVICE_STATE_HOST:-$SERVICE_HOST}"
             SERVICE_PORT="${SERVICE_STATE_PORT:-$SERVICE_PORT}"
             do_stop; exit $? ;;
    restart) prepare_service_runtime
             do_restart || exit $?
             if [[ "$BOOTSTRAP_DEVICE" == true ]]; then do_bootstrap; fi
             exit $? ;;
    status)  detect_platform
             if [[ "$OS" == "windows" ]]; then resolve_mumu_manager_path; else resolve_android_home; fi
             load_service_state >/dev/null 2>&1 || true
             SERVICE_HOST="${SERVICE_STATE_HOST:-$SERVICE_HOST}"
             SERVICE_PORT="${SERVICE_STATE_PORT:-$SERVICE_PORT}"
             do_status; exit $? ;;
    bootstrap|device-bootstrap)
             prepare_service_runtime; do_bootstrap; exit $? ;;
    stop-devices|devices-stop)
             detect_platform
             if [[ "$OS" == "windows" ]]; then resolve_mumu_manager_path; else resolve_android_home; fi
             load_service_state >/dev/null 2>&1 || true
             SERVICE_HOST="${SERVICE_STATE_HOST:-$SERVICE_HOST}"
             SERVICE_PORT="${SERVICE_STATE_PORT:-$SERVICE_PORT}"
             validate_device_stop_prereqs
             do_stop_devices; exit $? ;;
    logs)    do_logs; exit $? ;;
    help)    show_help ;;
    install) ;; # continue below
    *)
        error "Unknown command: $COMMAND"
        echo "Run './setup.sh help' for usage."
        exit 1
        ;;
esac

# ========================= Install Flow ====================
detect_platform
if [[ "$OS" == "windows" ]]; then
    resolve_mumu_manager_path
else
    resolve_android_home
fi
validate_runtime_prereqs false
resolve_python
ensure_local_venv
echo ""
echo -e "${BOLD}Emulator Service — Setup${RESET}"
echo -e "Platform: ${CYAN}$OS${RESET} (${CYAN}$ARCH${RESET})"
echo -e "Python:   ${CYAN}$(describe_python)${RESET}"
if [[ "$OS" == "windows" ]]; then
    echo -e "MuMu:     ${CYAN}$CONFIGURED_MUMU_MANAGER_PATH${RESET}"
else
    echo -e "SDK:      ${CYAN}$CONFIGURED_ANDROID_HOME${RESET}"
    echo -e "ADB:      ${CYAN}$CONFIGURED_ADB_PATH${RESET}"
fi

# ========================= Windows (Git Bash / PowerShell) ===
if [[ "$OS" == "windows" ]]; then
    PWSH=$(find_powershell)

    WIN_TOTAL=5
    WIN_STEP=0

    # --- Step 1: Enable Hyper-V & Virtualization ---
    WIN_STEP=$((WIN_STEP + 1))
    if [[ "$SKIP_VIRTUALIZATION" == false ]]; then
        step "Step $WIN_STEP/$WIN_TOTAL: Enabling Hyper-V & Virtualization"
        info "Checking and enabling virtualization features (requires admin)..."
        "$PWSH" -ExecutionPolicy Bypass -NoProfile -Command '
            $ErrorActionPreference = "Stop"
            $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
            if (-not $isAdmin) { Write-Host "WARNING: Not running as admin. Skipping virtualization setup." -ForegroundColor Yellow; exit 0 }
            $features = @("Microsoft-Hyper-V-All","VirtualMachinePlatform","HypervisorPlatform")
            $missing = @($features | Where-Object { (Get-WindowsOptionalFeature -Online -FeatureName $_).State -ne "Enabled" })
            if ($missing.Count -eq 0) { Write-Host "All virtualization features already enabled." -ForegroundColor Green; exit 0 }
            foreach ($f in $missing) {
                Write-Host "Enabling $f ..." -ForegroundColor Cyan
                Enable-WindowsOptionalFeature -Online -FeatureName $f -All -NoRestart | Out-Null
            }
            Write-Host "Done. A restart may be required." -ForegroundColor Yellow
        ' || warn "Virtualization setup requires admin. Run PowerShell as Administrator if needed."
    else
        info "Skipping virtualization (--skip-virtualization)"
    fi

    # --- Step 2: Download & install MuMu Player ---
    WIN_STEP=$((WIN_STEP + 1))
    step "Step $WIN_STEP/$WIN_TOTAL: MuMu Player"

    if mumu_manager_exists; then
        success "MuMu Player is already installed."
    else
        if [[ "$SKIP_MUMU" == false ]]; then
            info "MuMu Player not found. Attempting installation..."

            WIN_ARCH=$("$PWSH" -ExecutionPolicy Bypass -NoProfile -Command '
                Write-Output ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)
            ' 2>/dev/null || echo "X64")

            WINGET_OK=false
            OFFICIAL_OK=false
            HAS_WINGET=$( "$PWSH" -ExecutionPolicy Bypass -NoProfile -Command '
                if (Get-Command winget -ErrorAction SilentlyContinue) { Write-Output "yes" } else { Write-Output "no" }
            ' 2>/dev/null || echo "no" )
            if [[ "$HAS_WINGET" == *yes* ]]; then
                if [[ "$WIN_ARCH" == *Arm64* ]]; then
                    WINGET_PKG="Netease.MuMu.ARM"
                else
                    WINGET_PKG="Netease.MuMu"
                fi
                info "Trying: winget install $WINGET_PKG ..."
                if "$PWSH" -ExecutionPolicy Bypass -NoProfile -Command "
                    winget install --id $WINGET_PKG -e --source winget --silent --disable-interactivity --accept-source-agreements --accept-package-agreements
                " 2>/dev/null; then
                    WINGET_OK=true
                    MUMU_INSTALLED_THIS_RUN=true
                    success "MuMu Player installed via winget."
                else
                    warn "winget install failed."
                fi
            fi

            resolve_mumu_manager_path

            if [[ "$WINGET_OK" == false ]] || ! mumu_manager_exists; then
                installer_path=""
                if installer_path=$(download_mumu_official_installer); then
                    if install_mumu_official_installer "$installer_path"; then
                        OFFICIAL_OK=true
                        MUMU_INSTALLED_THIS_RUN=true
                        success "MuMu Player installed via official installer."
                    else
                        warn "Official MuMu installer did not complete automatically."
                    fi
                else
                    warn "Failed to download the official MuMu installer."
                fi
            fi

            if [[ "$WINGET_OK" == false && "$OFFICIAL_OK" == false ]] || ! mumu_manager_exists; then
                warn "Automatic installation did not finish MuMu setup."
                echo ""
                echo "  Please download MuMu Player manually from:"
                echo "    $MUMU_DOWNLOAD_PAGE"
                if [[ "$WIN_ARCH" == *Arm64* ]]; then
                    echo "    (Select the Windows ARM version)"
                fi
                echo ""
                echo "  After installing, re-run: ./setup.sh --skip-mumu"
                "$PWSH" -ExecutionPolicy Bypass -NoProfile -Command "Start-Process '$MUMU_DOWNLOAD_PAGE'" 2>/dev/null || true
            fi
        else
            info "Skipping MuMu installation (--skip-mumu)"
            fatal "MuMu Player is required before setup can continue. Expected manager path: $CONFIGURED_MUMU_MANAGER_PATH"
        fi
    fi

    stop_fresh_install_pad_device_direct

    # --- Step 3: Validate bundled ADB ---
    WIN_STEP=$((WIN_STEP + 1))
    step "Step $WIN_STEP/$WIN_TOTAL: Validating MuMu bundled ADB"
    if adb_binary_exists; then
        success "MuMu bundled ADB is available: $CONFIGURED_ADB_PATH"
    else
        fatal "MuMu bundled adb.exe not found. Expected path: ${CONFIGURED_ADB_PATH:-<unknown>}"
    fi

    # --- Step 4: Python dependencies ---
    WIN_STEP=$((WIN_STEP + 1))
    install_python_deps_step "Step $WIN_STEP/$WIN_TOTAL: Python dependencies"

    # --- Step 5: Download APKs ---
    WIN_STEP=$((WIN_STEP + 1))
    step "Step $WIN_STEP/$WIN_TOTAL: Downloading APKs"
    if [[ "$SKIP_ADBKEYBOARD" == false ]]; then
        info "[1/2] ADBKeyboard:"
        download_adbkeyboard_apk
    else
        info "[1/2] ADBKeyboard: skipped (--skip-adbkeyboard)"
    fi
    if [[ "$SKIP_EDGE" == false ]]; then
        info "[2/2] Microsoft Edge:"
        download_edge_apk || true
    else
        info "[2/2] Microsoft Edge: skipped (--skip-edge)"
    fi

    print_install_banner
    exit 0

# ========================= macOS (AVD — Android Studio Emulator) =============
elif [[ "$OS" == "macos" ]]; then
    MAC_TOTAL=7
    MAC_STEP=0

    # ---- Ensure Java is available (required by sdkmanager/avdmanager) ----
    configure_macos_java_env

    if ! java -version >/dev/null 2>&1; then
        info "Java not found. Installing OpenJDK ${ADOPTIUM_JDK_VERSION}..."

        JAVA_INSTALLED=false

        # Method 1: Homebrew (preferred — fast, version-managed)
        if command_exists brew; then
            if brew install openjdk 2>/dev/null \
                || brew install --cask temurin 2>/dev/null; then
                BREW_OPENJDK_PREFIX="$(brew --prefix)/opt/openjdk"
                if [[ -d "$BREW_OPENJDK_PREFIX/bin" ]]; then
                    export PATH="$BREW_OPENJDK_PREFIX/bin:$PATH"
                    export JAVA_HOME="$BREW_OPENJDK_PREFIX/libexec/openjdk.jdk/Contents/Home"
                fi
                JAVA_INSTALLED=true
            else
                warn "brew install failed. Falling back to direct download..."
            fi
        fi

        # Method 2: Direct download from Adoptium (no brew needed)
        if [[ "$JAVA_INSTALLED" == false ]]; then
            if [[ "$ARCH" == "arm64" ]]; then arch_label="aarch64"; else arch_label="x64"; fi
            jdk_url="https://api.adoptium.net/v3/binary/latest/${ADOPTIUM_JDK_VERSION}/ga/mac/${arch_label}/jdk/hotspot/normal/eclipse?project=jdk"
            jdk_dir="$CONFIGURED_ANDROID_HOME/jdk"
            tmp_tar="${jdk_dir}.tar.gz"

            info "Downloading Adoptium JDK ${ADOPTIUM_JDK_VERSION} (${arch_label})..."
            mkdir -p "$jdk_dir"
            curl -fSL --progress-bar -o "$tmp_tar" "$jdk_url" \
                || fatal "JDK download failed. Install Java manually: https://adoptium.net"

            info "Extracting JDK..."
            tar xzf "$tmp_tar" -C "$jdk_dir" --strip-components=1
            rm -f "$tmp_tar"

            if [[ -x "$jdk_dir/Contents/Home/bin/java" ]]; then
                export PATH="$jdk_dir/Contents/Home/bin:$PATH"
                export JAVA_HOME="$jdk_dir/Contents/Home"
            fi
        fi

        java -version >/dev/null 2>&1 \
            || fatal "Java installation failed. Install a JDK manually: https://adoptium.net"
        success "Java installed."
    fi

    # --- Step 1: Android SDK command-line tools ---
    MAC_STEP=$((MAC_STEP + 1))
    step "Step $MAC_STEP/$MAC_TOTAL: Android SDK command-line tools"

    if [[ -x "$SDKMANAGER" ]]; then
        success "Android SDK command-line tools already installed."
    elif [[ "$SKIP_SDK" == true ]]; then
        info "Skipping SDK installation (--skip-sdk)"
    else
        info "Android SDK command-line tools not found. Installing..."

        CMDLINE_INSTALLED=false

        # Method 1: Homebrew (preferred — fast, version-managed)
        if command_exists brew; then
            info "Trying: brew install --cask android-commandlinetools ..."
            if brew install --cask android-commandlinetools 2>/dev/null; then
                # Homebrew puts cmdline-tools in a special location.
                BREW_SDK_ROOT="$(brew --prefix)/share/android-commandlinetools"
                if [[ -x "$BREW_SDK_ROOT/cmdline-tools/latest/bin/sdkmanager" ]]; then
                    # Copy (not symlink) cmdline-tools into ANDROID_HOME.
                    # The SDK tools resolve APP_HOME from their real path; a symlink
                    # causes them to look for packages under the brew prefix instead
                    # of ANDROID_HOME, breaking avdmanager/sdkmanager --list_installed.
                    mkdir -p "$CONFIGURED_ANDROID_HOME/cmdline-tools"
                    if [[ -L "$CONFIGURED_ANDROID_HOME/cmdline-tools/latest" ]]; then
                        rm "$CONFIGURED_ANDROID_HOME/cmdline-tools/latest"
                    fi
                    if [[ ! -d "$CONFIGURED_ANDROID_HOME/cmdline-tools/latest" ]]; then
                        cp -R "$BREW_SDK_ROOT/cmdline-tools/latest" "$CONFIGURED_ANDROID_HOME/cmdline-tools/latest"
                    fi
                    resolve_android_home
                    CMDLINE_INSTALLED=true
                fi
            else
                warn "brew install failed. Falling back to direct download..."
            fi
        fi

        # Method 2: Direct download from Google (no brew needed)
        if [[ "$CMDLINE_INSTALLED" == false ]]; then
            cmdline_url="https://dl.google.com/android/repository/commandlinetools-mac-${CMDLINETOOLS_VERSION}_latest.zip"
            tmp_zip="${CONFIGURED_ANDROID_HOME}/cmdline-tools-tmp.zip"

            info "Downloading Android command-line tools from Google..."
            mkdir -p "$CONFIGURED_ANDROID_HOME/cmdline-tools"
            curl -fSL --progress-bar -o "$tmp_zip" "$cmdline_url" \
                || fatal "Android command-line tools download failed. Check network and retry."

            info "Extracting..."
            unzip -o -q "$tmp_zip" -d "$CONFIGURED_ANDROID_HOME/cmdline-tools/"
            rm -f "$tmp_zip"

            # Google's zip extracts to a cmdline-tools/ subfolder; rename to latest/
            if [[ -d "$CONFIGURED_ANDROID_HOME/cmdline-tools/cmdline-tools" ]]; then
                rm -rf "$CONFIGURED_ANDROID_HOME/cmdline-tools/latest"
                mv "$CONFIGURED_ANDROID_HOME/cmdline-tools/cmdline-tools" \
                   "$CONFIGURED_ANDROID_HOME/cmdline-tools/latest"
            fi
            resolve_android_home
        fi

        if [[ ! -x "$SDKMANAGER" ]]; then
            fatal "sdkmanager not found after installation. Expected: $SDKMANAGER"
        fi
        success "Android SDK command-line tools installed."
    fi

    # --- Step 2: SDK packages (platform-tools, emulator, system-image) ---
    MAC_STEP=$((MAC_STEP + 1))
    step "Step $MAC_STEP/$MAC_TOTAL: SDK packages (platform-tools, emulator, system image)"

    if [[ -x "$CONFIGURED_ADB_PATH" && -x "$EMULATOR_BIN" ]]; then
        success "Platform tools and emulator already installed."
        # Still ensure system image is present
        if ! "$SDKMANAGER" --list_installed 2>/dev/null | grep -q "$SYSTEM_IMAGE"; then
            info "Installing system image: $SYSTEM_IMAGE ..."
            yes | "$SDKMANAGER" --sdk_root="$CONFIGURED_ANDROID_HOME" "$SYSTEM_IMAGE" \
                || fatal "System image installation failed."
            success "System image installed."
        else
            success "System image already available."
        fi
    elif [[ "$SKIP_SDK" == true ]]; then
        info "Skipping SDK packages (--skip-sdk)"
    else
        info "Installing SDK packages (platform-tools, emulator, system-image)..."
        info "  Accepting SDK licenses..."
        yes | "$SDKMANAGER" --sdk_root="$CONFIGURED_ANDROID_HOME" --licenses >/dev/null 2>&1 || true
        info "  Downloading and installing packages... This may take several minutes."
        "$SDKMANAGER" --sdk_root="$CONFIGURED_ANDROID_HOME" \
            "platform-tools" "emulator" "$SYSTEM_IMAGE" \
            || fatal "SDK package installation failed."
        # Re-derive paths after install
        resolve_android_home
        success "SDK packages installed."
    fi

    # --- Step 3: Validate ADB ---
    MAC_STEP=$((MAC_STEP + 1))
    step "Step $MAC_STEP/$MAC_TOTAL: Validating ADB"
    if adb_binary_exists; then
        success "ADB available: $CONFIGURED_ADB_PATH"
    else
        fatal "ADB not found at expected path: ${CONFIGURED_ADB_PATH:-<unknown>}. Run install without --skip-sdk."
    fi

    # --- Step 4: Create AVD device0 ---
    MAC_STEP=$((MAC_STEP + 1))
    step "Step $MAC_STEP/$MAC_TOTAL: Creating AVD (${AVD_NAME_PREFIX}0)"

    AVD_NAME="${AVD_NAME_PREFIX}0"
    if "$AVDMANAGER" list avd -c 2>/dev/null | grep -q "^${AVD_NAME}$"; then
        success "AVD '$AVD_NAME' already exists."
    elif [[ "$SKIP_SDK" == true ]]; then
        info "Skipping AVD creation (--skip-sdk)"
    else
        info "Creating AVD '$AVD_NAME' (device: $AVD_DEVICE_PROFILE, image: $SYSTEM_IMAGE)..."
        echo "no" | "$AVDMANAGER" create avd \
            -n "$AVD_NAME" \
            -k "$SYSTEM_IMAGE" \
            -d "$AVD_DEVICE_PROFILE" \
            --force \
            || fatal "AVD creation failed."
        success "AVD '$AVD_NAME' created."
    fi

    # --- Step 5: Python dependencies ---
    MAC_STEP=$((MAC_STEP + 1))
    install_python_deps_step "Step $MAC_STEP/$MAC_TOTAL: Python dependencies"

    # --- Step 6: Configure display ---
    MAC_STEP=$((MAC_STEP + 1))
    step "Step $MAC_STEP/$MAC_TOTAL: Configuring display (${SCREEN_WIDTH}x${SCREEN_HEIGHT} @ ${SCREEN_DPI}dpi)"

    AVD_CONFIG="$HOME/.android/avd/${AVD_NAME}.avd/config.ini"
    if [[ -f "$AVD_CONFIG" ]]; then
        info "Updating AVD config: ${AVD_CONFIG}"
        set_avd_config "$AVD_CONFIG" "hw.lcd.width" "$SCREEN_WIDTH"
        set_avd_config "$AVD_CONFIG" "hw.lcd.height" "$SCREEN_HEIGHT"
        set_avd_config "$AVD_CONFIG" "hw.lcd.density" "$SCREEN_DPI"
        success "Display configured in AVD config."
    else
        warn "AVD config not found at $AVD_CONFIG. Display will use defaults."
    fi

    # --- Step 7: Download ADBKeyboard + Edge APKs ---
    MAC_STEP=$((MAC_STEP + 1))
    step "Step $MAC_STEP/$MAC_TOTAL: Downloading APKs (ADBKeyboard + Edge)"

    EDGE_APK_PATH="$SCRIPT_DIR/$EDGE_APK_NAME"
    NEED_APK_INSTALL=false

    if [[ "$SKIP_ADBKEYBOARD" == false || "$SKIP_EDGE" == false ]]; then
        NEED_APK_INSTALL=true
    fi

    # Pre-download APKs. They will be installed after the default device
    # is started via the API, which avoids the temporary headless AVD
    # boot/shutdown cycle and its crash dialog side effects.
    if [[ "$NEED_APK_INSTALL" == true ]]; then
        info "Downloading APKs before starting emulator..."
        if [[ "$SKIP_ADBKEYBOARD" == false ]]; then
            info "  [1/2] ADBKeyboard:"
            download_adbkeyboard_apk
        fi
        if [[ "$SKIP_EDGE" == false ]]; then
            info "  [2/2] Microsoft Edge:"
            download_edge_apk || true
        fi
    fi

    if [[ "$NEED_APK_INSTALL" == false ]]; then
        info "Skipping APK installation (--skip-adbkeyboard + --skip-edge)"
    fi

    print_install_banner
    exit 0
fi

fatal "Unexpected unsupported platform state."
