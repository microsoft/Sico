#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

source "${SCRIPT_DIR}/load-env.sh"
load_env_file "${ROOT_DIR}/.env"
require_env_vars NPM_REGISTRY

cd "${ROOT_DIR}/frontend"
pnpm install --frozen-lockfile
pnpm build
