#!/usr/bin/env bash
# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

set -euo pipefail

# Unified proto code generation script.
#
# Usage:
#   ./gen.sh                  # run all targets
#   ./gen.sh all              # run all targets
#   ./gen.sh backend          # run all backend targets
#   ./gen.sh backend-grpc backend-http core   # run specific targets

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Optional extra include path(s) for protoc, e.g. when google/protobuf well-known
# protos live outside protoc's default search path (Winget Windows install).
# Multiple paths can be passed via colon-separated string.
EXTRA_PROTOC_INCLUDE="${EXTRA_PROTOC_INCLUDE:-}"
_protoc_extra_args=()
if [[ -n "${EXTRA_PROTOC_INCLUDE}" ]]; then
  IFS=':' read -ra _extra_paths <<<"${EXTRA_PROTOC_INCLUDE}"
  for _p in "${_extra_paths[@]}"; do
    [[ -n "$_p" ]] && _protoc_extra_args+=("-I" "$_p")
  done
fi

# ---------------------------------------------------------------------------
# backend-grpc
# ---------------------------------------------------------------------------
run_backend_grpc() {
  local out_rel="../backend/internal/transport/grpc/pb"
  mkdir -p "$out_rel"
  local out_abs
  out_abs="$(cd "$out_rel" && pwd)"

  local targets=(
    "llmhubs|llmhubs|rpc"
    "conversation|conversation|rpc"
    "knowledge|knowledge|rpc"
    "skill|skill|rpc"
  )

  _gen_go_grpc "$out_abs" "${targets[@]}"
}

# ---------------------------------------------------------------------------
# backend-reverse-rpc
# ---------------------------------------------------------------------------
run_backend_reverse() {
  local out_rel="../backend/internal/transport/reverse_grpc/pb"
  mkdir -p "$out_rel"
  local out_abs
  out_abs="$(cd "$out_rel" && pwd)"

  local targets=(
    "knowledge|knowledge|reverse_rpc"
    "sandbox|sandbox|reverse_rpc"
    "conversation|conversation|reverse_rpc"
    "taskruntime|taskruntime|reverse_rpc"
  )

  _gen_go_grpc "$out_abs" "${targets[@]}"
}

# Shared Go + gRPC generation for grpc/reverse_rpc targets.
# Args: <out_abs> <target...> where each target is "proto_subdir|out_subdir|space separated files"
_gen_go_grpc() {
  local out_abs="$1"
  shift

  local target proto_subdir out_subdir files full_out_dir file
  for target in "$@"; do
    IFS='|' read -r proto_subdir out_subdir files <<<"$target"
    full_out_dir="$out_abs/$out_subdir"
    mkdir -p "$full_out_dir"

    for file in $files; do
      local proto_path="$proto_subdir/$file.proto"
      echo "Processing $proto_path -> $full_out_dir"
      protoc \
        -I. \
        "${_protoc_extra_args[@]}" \
        --go_out=. --go_opt=paths=source_relative \
        --go-grpc_out=. --go-grpc_opt=paths=source_relative \
        "$proto_path"

      mv "$proto_subdir/$file.pb.go" "$full_out_dir/$file.pb.go"
      protoc-go-inject-tag -input="$full_out_dir/$file.pb.go" -remove_tag_comment

      if [[ -f "$proto_subdir/${file}_grpc.pb.go" ]]; then
        mv "$proto_subdir/${file}_grpc.pb.go" "$full_out_dir/${file}_grpc.pb.go"
        protoc-go-inject-tag -input="$full_out_dir/${file}_grpc.pb.go" -remove_tag_comment
      fi
    done
  done
}

# ---------------------------------------------------------------------------
# backend-http-dto
# ---------------------------------------------------------------------------
GO_HTTP_OUT_DIR_ABS=""

run_backend_http() {
  local out_rel="../backend/internal/transport/http/dto"
  mkdir -p "$out_rel"
  GO_HTTP_OUT_DIR_ABS="$(cd "$out_rel" && pwd)"

  _http_process_subdir "llmhubs" "llmhubs" \
    restful

  _http_process_subdir_gen "agent" "agent" \
    single_agent:single_agent \
    agent_common:common \
    single_agent_instance:single_agent

  _http_process_subdir "knowledge" "knowledge" \
    knowledge

  _http_process_subdir "skill" "skill" \
    skill

  _http_process_subdir "project" "project" \
    project

  _http_process_subdir "common" "common" \
    common

  _http_process_subdir "sandbox" "sandbox" \
    restful

  _http_process_subdir "conversation" "conversation" \
    conversation \
    msg \
    chat \
    plan \
    api

  _http_process_subdir_gen "rbac" "rbac" \
    rbac_common:common \
    role:role \
    user:user \
    user_role:user_role \
    token:token \
    casbin_rule:casbin_rule
}

_http_process_subdir() {
  local proto_subdir="$1"
  local out_subdir="$2"
  shift 2

  local full_go_out_dir="${GO_HTTP_OUT_DIR_ABS}/${out_subdir}"
  mkdir -p "$full_go_out_dir"

  local file
  for file in "$@"; do
    local proto_path="${proto_subdir}/${file}.proto"
    echo "Processing ${proto_path}"
    protoc \
      -I . \
      "${_protoc_extra_args[@]}" \
      --go_out=. --go_opt=paths=source_relative \
      "$proto_path"
    mv -f "${proto_subdir}/${file}.pb.go" "${full_go_out_dir}/${file}.pb.go"
    protoc-go-inject-tag -input="${full_go_out_dir}/${file}.pb.go" -remove_tag_comment
  done
}

_http_process_subdir_gen() {
  local proto_subdir="$1"
  local out_subdir="$2"
  shift 2

  local full_go_out_dir="${GO_HTTP_OUT_DIR_ABS}/${out_subdir}"
  mkdir -p "$full_go_out_dir"

  local pair file gen_subdir full_move_dir
  for pair in "$@"; do
    file="${pair%%:*}"
    gen_subdir="${pair##*:}"
    full_move_dir="${full_go_out_dir}/${gen_subdir}"
    mkdir -p "$full_move_dir"

    local proto_path="${proto_subdir}/${file}.proto"
    echo "Processing ${proto_path}"
    protoc \
      -I . \
      "${_protoc_extra_args[@]}" \
      --go_out=. --go_opt=paths=source_relative \
      "$proto_path"
    mv -f "${proto_subdir}/${file}.pb.go" "${full_move_dir}/${file}.pb.go"
    protoc-go-inject-tag -input="${full_move_dir}/${file}.pb.go" -remove_tag_comment
  done
}

# ---------------------------------------------------------------------------
# core (python betterproto2)
# ---------------------------------------------------------------------------
run_core() {
  local python_bin
  python_bin="${PYTHON_BIN:-$(command -v python || command -v python3 || true)}"
  if [[ -z "$python_bin" ]]; then
    echo "python or python3 is required to run this script" >&2
    exit 1
  fi

  local out_rel="../core/app/pb"
  mkdir -p "$out_rel"
  local out_abs
  out_abs="$(cd "$out_rel" && pwd)"

  # Each entry: "proto_subdir|out_subdir|space separated files[|extra_opts]"
  # extra_opts defaults to "server_generation=async" when omitted or empty.
  local targets=(
    "llmhubs|llmhubs|rpc reverse_rpc"
    "conversation|conversation|msg reverse_rpc chat plan api rpc"
    "common|common|common"
    "health|health|rpc"
    "knowledge|knowledge|knowledge rpc reverse_rpc"
    "skill|skill|skill rpc"
    "sandbox|sandbox|reverse_rpc"
    "taskruntime|taskruntime|reverse_rpc"
  )

  local target subdir out_subdir files extra_opts full_out_dir file opts
  local -a relink_args
  for target in "${targets[@]}"; do
    IFS='|' read -r subdir out_subdir files extra_opts <<<"$target"
    full_out_dir="$out_abs/$out_subdir"
    mkdir -p "$full_out_dir"
    opts="${extra_opts:-server_generation=async}"

    for file in $files; do
      echo "Generating code for $subdir/$file.proto"
      "$python_bin" -m grpc_tools.protoc \
        -I. \
        --python_betterproto2_out="$full_out_dir" \
        --python_betterproto2_opt="$opts" \
        "$subdir/$file.proto"
    done

    echo "Relinking dependencies for $subdir ($files)"
    relink_args=(--proto_subdir="$subdir" --out_subdir="$out_subdir")
    for file in $files; do
      relink_args+=(--file="$file.proto")
    done
    "$python_bin" gen_core_relink_dependencies.py "${relink_args[@]}"
  done
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------
usage() {
  cat <<EOF
Usage: $(basename "$0") [targets...]

Targets:
  all              (default) run every target below
  backend          run backend-grpc, backend-http, backend-reverse
  backend-grpc     Go gRPC stubs  -> backend/internal/transport/grpc/pb/
  backend-http     Go HTTP DTOs   -> backend/internal/transport/http/dto/
  backend-reverse  Go reverse RPC -> backend/internal/transport/reverse_grpc/pb/
  core             Python stubs   -> core/app/pb/
EOF
}

run_target() {
  case "$1" in
    all)
      run_backend_grpc
      run_backend_http
      run_backend_reverse
      run_core
      ;;
    backend)
      run_backend_grpc
      run_backend_http
      run_backend_reverse
      ;;
    backend-grpc)    run_backend_grpc ;;
    backend-http)    run_backend_http ;;
    backend-reverse) run_backend_reverse ;;
    core)            run_core ;;
    -h|--help|help)  usage; exit 0 ;;
    *)
      echo "Unknown target: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
}

if [[ $# -eq 0 ]]; then
  run_target all
else
  for t in "$@"; do
    run_target "$t"
  done
fi
