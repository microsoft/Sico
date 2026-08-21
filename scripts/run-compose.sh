#!/usr/bin/env bash
set -euo pipefail

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

# Compose gives process variables precedence over --env-file. Remove registry
# values inherited from the caller so the repository-root .env stays authoritative.
unset PYPI_INDEX_URL NPM_REGISTRY
exec "${docker_bin}" compose -p sico -f deploy/docker/docker-compose.yaml --env-file .env "$@"
