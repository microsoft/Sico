#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "${script_dir}/.." && pwd)"

docker_bin="${DOCKER_BIN:-}"
if [[ -z "${docker_bin}" ]]; then
  case "$(uname -s)" in
    CYGWIN*|MINGW*|MSYS*) docker_bin="$(command -v docker.exe || true)" ;;
    *) docker_bin="$(command -v docker || true)" ;;
  esac
fi

if [[ -z "${docker_bin}" ]]; then
  echo "ERROR: Docker was not found in PATH. Set DOCKER_BIN to the Docker executable path." >&2
  exit 1
fi

source "${script_dir}/load-env.sh"
ensure_sandbox_service_token "${root_dir}/.env" "${SICO_SANDBOX_SERVICE_TOKEN:-}"
unset SICO_SANDBOX_SERVICE_TOKEN

# Compose gives process variables precedence over --env-file. Keep registry
# values in .env authoritative for local image builds.
unset PYPI_INDEX_URL NPM_REGISTRY
exec "${docker_bin}" compose -p sico -f "${root_dir}/deploy/docker/docker-compose.yaml" \
  --env-file "${root_dir}/.env" "$@"
