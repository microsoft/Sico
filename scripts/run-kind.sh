#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" == CYGWIN* ]]; then
  git_bash="${GIT_BASH:-C:/Program Files/Git/bin/bash.exe}"
  git_bash="$(cygpath -u "${git_bash}")"
  if [[ ! -x "${git_bash}" ]]; then
    echo "ERROR: Git Bash was not found at '${git_bash}'. Set GIT_BASH to its bash.exe path." >&2
    exit 1
  fi
  exec "${git_bash}" deploy/kind/setup.sh "$@"
fi

exec bash deploy/kind/setup.sh "$@"
