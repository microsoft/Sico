#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

env_file="${repo_root}/.env"

dotenv_value() {
  local key="$1"
  local line=""
  if [[ -f "${env_file}" ]]; then
    line="$(grep -E "^${key}=" "${env_file}" | tail -n 1 || true)"
  fi
  line="${line#*=}"
  line="${line%$'\r'}"
  if [[ "${line}" == \"*\" && "${line}" == *\" ]]; then
    line="${line:1:${#line}-2}"
  elif [[ "${line}" == \'*\' && "${line}" == *\' ]]; then
    line="${line:1:${#line}-2}"
  fi
  printf '%s' "${line}"
}

context="${repo_root}/sandbox/linux-workstation-sandbox"
base_image="$(dotenv_value LINUX_WORKSTATION_SANDBOX_BASE_IMAGE)"
image="$(dotenv_value LINUX_WORKSTATION_SANDBOX_IMAGE)"
base_image="${base_image:-${LINUX_WORKSTATION_SANDBOX_BASE_IMAGE:-sico/linux-workstation-sandbox-base:local}}"
image="${image:-${LINUX_WORKSTATION_SANDBOX_IMAGE:-sico/linux-workstation-sandbox:local}}"
npm_registry="$(dotenv_value NPM_REGISTRY)"
pypi_index_url="$(dotenv_value PYPI_INDEX_URL)"
npm_registry="${npm_registry:-${NPM_REGISTRY:-https://registry.npmjs.org/}}"
pypi_index_url="${pypi_index_url:-${PYPI_INDEX_URL:-https://pypi.org/simple}}"

"${docker_bin}" build \
  -f "${context}/deployments/docker/linux-workstation/Dockerfile.base" \
  --build-arg "NPM_REGISTRY=${npm_registry}" \
  --build-arg "PYPI_INDEX_URL=${pypi_index_url}" \
  -t "${base_image}" \
  "${context}"
"${docker_bin}" build \
  -f "${context}/deployments/docker/linux-workstation/Dockerfile" \
  --build-arg "BASE_IMAGE=${base_image}" \
  -t "${image}" \
  "${context}"
