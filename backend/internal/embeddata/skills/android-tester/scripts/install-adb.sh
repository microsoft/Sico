#!/usr/bin/env sh
# Install ADB if not already available (Linux)
set -eu

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
        SUDO="sudo"
    else
        echo "Not running as root and sudo is not available. Install Android Platform Tools manually: https://developer.android.com/tools/releases/platform-tools" >&2
        exit 1
    fi
fi

if ! command -v adb >/dev/null 2>&1; then
    echo "adb not found, installing..."
    if command -v apt-get >/dev/null 2>&1; then
        $SUDO apt-get update -qq
        $SUDO apt-get install -y --no-install-recommends android-tools-adb
        $SUDO rm -rf /var/lib/apt/lists/*
    elif command -v apk >/dev/null 2>&1; then
        $SUDO apk add --no-cache android-tools
    elif command -v dnf >/dev/null 2>&1; then
        $SUDO dnf install -y --setopt=install_weak_deps=False android-tools
        $SUDO dnf clean all
    elif command -v pacman >/dev/null 2>&1; then
        $SUDO pacman -S --noconfirm --needed android-tools
        $SUDO pacman -Scc --noconfirm
    else
        echo "Install Android Platform Tools manually: https://developer.android.com/tools/releases/platform-tools" >&2
        exit 1
    fi
fi
echo "adb version: $(adb version)"
