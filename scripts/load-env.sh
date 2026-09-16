#!/usr/bin/env bash

load_env_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${load_env_script_dir}/../sandbox/emulator/setup/token-env.sh"

load_env_file() {
  local env_file="$1"
  local line key value

  if [[ ! -f "${env_file}" ]]; then
    echo "ERROR: environment file not found: ${env_file}" >&2
    return 1
  fi

  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line}" || "${line}" =~ ^[[:space:]]*$ || "${line}" =~ ^[[:space:]]*# ]] && continue
    if ! [[ "${line}" =~ ^[A-Za-z_][A-Za-z0-9_]*=.*$ ]]; then
      echo "ERROR: ${env_file} contains invalid line: ${line}" >&2
      return 1
    fi
    key="${line%%=*}"
    value="${line#*=}"
    value="$(normalize_env_value "${value}" "${env_file}" "${key}")" || return 1
    export "${key}=${value}"
  done <"${env_file}"
}

normalize_env_value() {
  local value="$1"
  local source="${2:-environment file}"
  local key="${3:-value}"
  local first_char last_char

  first_char="${value:0:1}"
  last_char="${value: -1}"
  if [[ ("${first_char}" == '"' && "${last_char}" == '"') ||
    ("${first_char}" == "'" && "${last_char}" == "'") ]]; then
    printf '%s' "${value:1:${#value}-2}"
    return
  fi
  if [[ "${value}" =~ [[:space:]]# ]]; then
    echo "ERROR: ${key} in ${source} uses an unquoted inline comment, which is not supported" >&2
    return 1
  fi
  printf '%s' "${value}"
}

require_env_vars() {
  local name

  for name in "$@"; do
    if [[ -z "${!name:-}" ]]; then
      echo "ERROR: ${name} is not set. Define it in .env" >&2
      return 1
    fi
  done
}
