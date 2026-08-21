#!/usr/bin/env bash

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
    export "${key}=${value}"
  done < "${env_file}"
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
