#!/usr/bin/env sh
# Package the android-tester skill into a distributable zip.
#
# Output: android-tester-skill.zip in the repo root
#
# Contents (all at archive root):
#   android_tester/
#   data/
#   pyproject.toml
#   SKILL.md
#   config.env (copied from config.env.example if not present)
#
# Exclusions:
#   package-skill.sh
#   .git/**
#   .idea/**
#   .vscode/**
#   config.env.example
#   __pycache__/**
#   *.pyc
#
# Usage:
#   bash package-skill.sh

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$REPO_ROOT/build"
OUT_ZIP="$BUILD_DIR/android-tester-skill.zip"
TMP_WORKDIR="$(mktemp -d)"
STAGE_DIR="$TMP_WORKDIR/stage"

cleanup() {
    rm -rf "$TMP_WORKDIR"
}

trap cleanup EXIT

mkdir -p "$STAGE_DIR"

# Copy main directories and files
for item in android_tester data pyproject.toml SKILL.md README.md scripts; do
    if [ -e "$REPO_ROOT/$item" ]; then
        cp -r "$REPO_ROOT/$item" "$STAGE_DIR/"
    fi
done

# Copy config.env if present, otherwise fall back to config.env.example
if [ -f "$REPO_ROOT/config.env" ]; then
    cp "$REPO_ROOT/config.env" "$STAGE_DIR/config.env"
elif [ -f "$REPO_ROOT/config.env.example" ]; then
    cp "$REPO_ROOT/config.env.example" "$STAGE_DIR/config.env"
fi

# Remove build artifacts and unnecessary files
find "$STAGE_DIR" -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
find "$STAGE_DIR" -type f -name "*.pyc" -delete
find "$STAGE_DIR" -type f -name "config.env.example" -delete
find "$STAGE_DIR" -type f -name "package-skill.*" -delete
find "$STAGE_DIR" -type d -name ".git" -exec rm -rf {} + 2>/dev/null || true
find "$STAGE_DIR" -type d -name ".idea" -exec rm -rf {} + 2>/dev/null || true
find "$STAGE_DIR" -type d -name ".vscode" -exec rm -rf {} + 2>/dev/null || true

# Convert line endings to LF if dos2unix is available
if command -v dos2unix >/dev/null 2>&1; then
    find "$STAGE_DIR" -type f \( -name "*.py" -o -name "*.sh" -o -name "*.md" -o -name "*.toml" -o -name "*.json" -o -name "*.env" -o -name "Makefile" \) -exec dos2unix {} + 2>/dev/null || true
fi

# Clean previous build
mkdir -p "$BUILD_DIR"
rm -f "$OUT_ZIP"

# Create zip from staged temp dir
cd "$STAGE_DIR"
zip -r "$OUT_ZIP" . \
    -x "android_tester/__pycache__/*" \
    -x "android_tester/**/__pycache__/*" \
    -x "data/__pycache__/*" \
    -x "data/**/__pycache__/*"

echo ""
echo "Packaged: $OUT_ZIP"
echo "   Size: $(du -h "$OUT_ZIP" | cut -f1)"
echo "   Contents:"
unzip -l "$OUT_ZIP" | tail -1
