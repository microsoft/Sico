#!/usr/bin/env bash

generate_sandbox_service_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import secrets; print(secrets.token_hex(32))'
    return
  fi
  if [[ -r /dev/urandom ]] && command -v od >/dev/null 2>&1; then
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
    return
  fi
  echo "ERROR: cannot generate SICO_SANDBOX_SERVICE_TOKEN; install openssl or python3" >&2
  return 1
}

read_sandbox_service_token() {
  local env_file="$1"
  local key="SICO_SANDBOX_SERVICE_TOKEN"
  local token=""
  local first_char last_char

  if [[ -f "${env_file}" ]]; then
    token="$(awk -v key="${key}" '
      index($0, key "=") == 1 { value = substr($0, length(key) + 2) }
      END { print value }
    ' "${env_file}")"
  fi
  token="${token%$'\r'}"
  first_char="${token:0:1}"
  last_char="${token: -1}"
  if [[ ("${first_char}" == '"' && "${last_char}" == '"') ||
        ("${first_char}" == "'" && "${last_char}" == "'") ]]; then
    token="${token:1:${#token}-2}"
  fi
  printf '%s' "${token}"
}

validate_sandbox_service_token() {
  local token="$1"
  local source="${2:-configuration}"

  if ! [[ "${token}" =~ ^[0-9a-f]{64}$ ]]; then
    echo "ERROR: SICO_SANDBOX_SERVICE_TOKEN in ${source} must be exactly 64 lowercase hexadecimal characters" >&2
    return 1
  fi
}

ensure_sandbox_service_token() {
  local env_file="$1"
  local preferred_token="${2:-}"
  local key="SICO_SANDBOX_SERVICE_TOKEN"
  local token temp_file

  if [[ ! -f "${env_file}" ]]; then
    echo "ERROR: environment file not found: ${env_file}" >&2
    return 1
  fi

  token="$(read_sandbox_service_token "${env_file}")"
  if [[ -n "${token}" ]]; then
    validate_sandbox_service_token "${token}" "${env_file}" || return 1
    if [[ -n "${preferred_token}" ]]; then
      validate_sandbox_service_token "${preferred_token}" "the process environment" || return 1
      if [[ "${preferred_token}" != "${token}" ]]; then
        echo "ERROR: SICO_SANDBOX_SERVICE_TOKEN differs between the process environment and ${env_file}" >&2
        return 1
      fi
    fi
    return
  fi

  token="${preferred_token}"
  if [[ -z "${token}" ]]; then
    token="$(generate_sandbox_service_token)"
  fi
  validate_sandbox_service_token "${token}" "the process environment or token generator" || return 1

  temp_file="$(mktemp "${env_file}.tmp.XXXXXX")"
  awk -v key="${key}" -v token="${token}" '
    BEGIN { written = 0 }
    index($0, key "=") == 1 {
      if (!written) {
        print key "=" token
        written = 1
      }
      next
    }
    { print }
    END {
      if (!written) {
        print key "=" token
      }
    }
  ' "${env_file}" > "${temp_file}"
  mv "${temp_file}" "${env_file}"
  echo "Generated SICO_SANDBOX_SERVICE_TOKEN in ${env_file}"
}
