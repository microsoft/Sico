#!/usr/bin/env sh
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
