#!/usr/bin/env bash
# Copyright (c) 2026 Sico Authors
#
# Local lint runner — mirrors CI configuration.
#
# Usage:
#   ./scripts/lint.sh                 # lint all subprojects
#   ./scripts/lint.sh --fix           # apply auto-fixes where possible (ruff, eslint)
#   ./scripts/lint.sh --backend       # lint backend only
#   ./scripts/lint.sh --core          # lint core only
#   ./scripts/lint.sh --frontend      # lint frontend only when frontend/package.json exists
#
# Flags may be combined: ./scripts/lint.sh --backend --core
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FIX=false
RUN_BACKEND=false
RUN_CORE=false
RUN_FRONTEND=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fix)      FIX=true; shift ;;
    --backend)  RUN_BACKEND=true; shift ;;
    --core)     RUN_CORE=true; shift ;;
    --frontend) RUN_FRONTEND=true; shift ;;
    -h|--help)
      sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

# Default: run all if nothing selected.
if ! $RUN_BACKEND && ! $RUN_CORE && ! $RUN_FRONTEND; then
  RUN_BACKEND=true
  RUN_CORE=true
  RUN_FRONTEND=true
fi

FAILED=0
section() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
missing() { printf '\033[1;33m==> %s\033[0m\n' "$*" >&2; FAILED=1; }
skipped() { printf '\033[1;33m==> %s\033[0m\n' "$*" >&2; }

if $RUN_BACKEND; then
  section "Backend: golangci-lint"
  if command -v golangci-lint >/dev/null 2>&1; then
    if command -v swag >/dev/null 2>&1; then
      (cd "$REPO_ROOT" && make openapi >/dev/null)
    else
      echo "swag not found — skipping OpenAPI regeneration."
      echo "Install: go install github.com/swaggo/swag/cmd/swag@latest"
    fi
    (cd "$REPO_ROOT/backend" && golangci-lint run ./...) || FAILED=1
  else
    missing "golangci-lint not found. Run 'make setup' or see https://golangci-lint.run/"
  fi
fi

if $RUN_CORE; then
  section "Core: ruff"
  if command -v ruff >/dev/null 2>&1; then
    if $FIX; then
      (cd "$REPO_ROOT/core" && ruff check --fix .) || FAILED=1
    else
      (cd "$REPO_ROOT/core" && ruff check .) || FAILED=1
    fi
    section "Examples: ruff"
    (cd "$REPO_ROOT/core" && ruff check ../examples --config pyproject.toml) || FAILED=1

    section "Examples: compileall"
    if command -v python3 >/dev/null 2>&1; then
      python3 -m compileall -q "$REPO_ROOT/examples" || FAILED=1
    elif command -v python >/dev/null 2>&1; then
      python -m compileall -q "$REPO_ROOT/examples" || FAILED=1
    else
      missing "python3/python not found. Required for examples compileall check."
    fi
  else
    missing "ruff not found. Run 'make setup' or: pip install ruff"
  fi
fi

if $RUN_FRONTEND; then
  section "Frontend: eslint + tsc"
  if [[ ! -f "$REPO_ROOT/frontend/package.json" ]]; then
    skipped "frontend/package.json is not included in this public checkout; skipping frontend lint because the frontend source package is distributed separately."
  elif command -v pnpm >/dev/null 2>&1; then
    if [[ ! -d "$REPO_ROOT/frontend/node_modules" ]]; then
      echo "frontend/node_modules missing — running 'pnpm install'..."
      (cd "$REPO_ROOT/frontend" && pnpm install --frozen-lockfile) || FAILED=1
    fi
    if $FIX; then
      (cd "$REPO_ROOT/frontend" && pnpm lint --fix) || FAILED=1
    else
      (cd "$REPO_ROOT/frontend" && pnpm lint) || FAILED=1
    fi
    (cd "$REPO_ROOT/frontend" && pnpm exec tsc --noEmit) || FAILED=1
  else
    missing "pnpm not found. Run 'make setup'."
  fi
fi

echo
if [[ $FAILED -ne 0 ]]; then
  echo "Lint issues found."
  exit 1
fi
echo "All lint checks passed."
