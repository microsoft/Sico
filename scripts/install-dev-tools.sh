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

# Install developer tooling required to contribute to sico.
#
# Supports macOS (Homebrew), Debian/Ubuntu (apt), Fedora (dnf), Arch (pacman),
# and any other Linux with a working Python + Go toolchain (falls back to pip,
# `go install`, and the official Helm / kubectl installers).
#
# Usage:
#   ./scripts/install-dev-tools.sh                       # install default tools
#   ./scripts/install-dev-tools.sh --with-helm          # install default tools + Helm + kubectl + kind
#   ./scripts/install-dev-tools.sh --check              # verify default tools are present
#   ./scripts/install-dev-tools.sh --check --with-helm  # verify default tools + Kind toolchain are present
#
# Idempotent: safe to re-run.

set -euo pipefail

CHECK_ONLY=0
WITH_HELM=0

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m==>\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m==>\033[0m %s\n' "$*" >&2; exit 1; }

have() { command -v "$1" >/dev/null 2>&1; }

for arg in "$@"; do
  case "$arg" in
    --check)
      CHECK_ONLY=1
      ;;
    --with-helm)
      WITH_HELM=1
      ;;
    *)
      die "Unknown argument: $arg. Usage: $0 [--check] [--with-helm]"
      ;;
  esac
done

detect_os() {
  case "$(uname -s)" in
    Darwin) echo "mac" ;;
    Linux)
      if   have apt-get; then echo "debian"
      elif have dnf;     then echo "fedora"
      elif have pacman;  then echo "arch"
      else                    echo "linux-generic"
      fi
      ;;
    *) echo "unknown" ;;
  esac
}

OS="$(detect_os)"
log "Detected platform: ${OS}"

# ---------- package-manager helpers ----------

install_pkg() {
  local name="$1"
  case "$OS" in
    mac)          brew install "$name" ;;
    debian)       sudo apt-get update -qq && sudo apt-get install -y "$name" ;;
    fedora)       sudo dnf install -y "$name" ;;
    arch)         sudo pacman -S --needed --noconfirm "$name" ;;
    linux-generic) warn "Please install '$name' via your distro's package manager." ;;
    *)            die "Unsupported OS; cannot install '$name' automatically." ;;
  esac
}

# ---------- tool installers ----------

ensure_go() {
  have go && { log "go:          $(go version)"; return; }
  [[ $CHECK_ONLY -eq 1 ]] && { warn "go missing"; return 1; }
  log "Installing Go..."
  case "$OS" in
    mac)    install_pkg go ;;
    debian) install_pkg golang-go ;;
    *)      install_pkg go ;;
  esac
}

ensure_python() {
  have python3 && { log "python:      $(python3 --version)"; return; }
  [[ $CHECK_ONLY -eq 1 ]] && { warn "python3 missing"; return 1; }
  log "Installing Python 3..."
  case "$OS" in
    mac)    install_pkg python@3.13 ;;
    debian) install_pkg "python3 python3-pip python3-venv" ;;
    *)      install_pkg python3 ;;
  esac
}

ensure_uv() {
  have uv && { log "uv:          $(uv --version)"; return; }
  [[ $CHECK_ONLY -eq 1 ]] && { warn "uv missing"; return 1; }
  log "Installing uv (Python package manager)..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
}

ensure_node() {
  have node && { log "node:        $(node --version)"; return; }
  [[ $CHECK_ONLY -eq 1 ]] && { warn "node missing"; return 1; }
  log "Installing Node.js..."
  case "$OS" in
    mac)    install_pkg node ;;
    debian) install_pkg nodejs ;;
    *)      install_pkg nodejs ;;
  esac
}

ensure_pnpm() {
  have pnpm && { log "pnpm:        $(pnpm --version)"; return; }
  [[ $CHECK_ONLY -eq 1 ]] && { warn "pnpm missing"; return 1; }
  log "Installing pnpm..."
  if have corepack; then
    corepack enable
    corepack prepare pnpm@latest --activate
  else
    npm install -g pnpm
  fi
}

ensure_precommit() {
  have pre-commit && { log "pre-commit:  $(pre-commit --version)"; return; }
  [[ $CHECK_ONLY -eq 1 ]] && { warn "pre-commit missing"; return 1; }
  log "Installing pre-commit..."
  if have pipx; then
    pipx install pre-commit
  elif have brew; then
    brew install pre-commit
  else
    python3 -m pip install --user pre-commit
  fi
}

ensure_addlicense() {
  have addlicense && { log "addlicense:  $(addlicense -h 2>&1 | head -1 || true)"; return; }
  [[ $CHECK_ONLY -eq 1 ]] && { warn "addlicense missing"; return 1; }
  log "Installing addlicense..."
  GO111MODULE=on go install github.com/google/addlicense@v1.2.0
  local gobin
  gobin="$(go env GOBIN)"; [[ -z "$gobin" ]] && gobin="$(go env GOPATH)/bin"
  export PATH="$gobin:$PATH"
  warn "Make sure ${gobin} is on your PATH."
}

ensure_helm() {
  have helm && { log "helm:        $(helm version --short 2>/dev/null | head -1)"; return; }
  [[ $CHECK_ONLY -eq 1 ]] && { warn "helm missing"; return 1; }
  log "Installing Helm..."
  case "$OS" in
    mac|fedora|arch)
      install_pkg helm
      ;;
    debian|linux-generic)
      curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
      ;;
    *)
      install_pkg helm
      ;;
  esac
}

ensure_kubectl() {
  have kubectl && { log "kubectl:     $(kubectl version --client=true 2>/dev/null | head -1)"; return; }
  [[ $CHECK_ONLY -eq 1 ]] && { warn "kubectl missing"; return 1; }
  log "Installing kubectl..."
  case "$OS" in
    mac|fedora|arch)
      install_pkg kubectl
      ;;
    debian|linux-generic)
      if have brew; then
        install_pkg kubectl
      else
        local tmp dest stable arch
        case "$(uname -m)" in
          x86_64|amd64) arch="amd64" ;;
          aarch64|arm64) arch="arm64" ;;
          *)
            warn "Unsupported Linux architecture '$(uname -m)'. Install kubectl manually: https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/"
            return 1
            ;;
        esac
        tmp="$(mktemp)"
        stable="$(curl -fsSL https://dl.k8s.io/release/stable.txt)"
        curl -fsSL "https://dl.k8s.io/release/${stable}/bin/linux/${arch}/kubectl" -o "$tmp"
        chmod +x "$tmp"
        dest="$HOME/.local/bin"
        mkdir -p "$dest"
        mv "$tmp" "$dest/kubectl"
        warn "Make sure ${dest} is on your PATH."
      fi
      ;;
    *)
      install_pkg kubectl
      ;;
  esac
}

ensure_kind() {
  have kind && { log "kind:        $(kind version 2>/dev/null | head -1)"; return; }
  [[ $CHECK_ONLY -eq 1 ]] && { warn "kind missing"; return 1; }
  log "Installing kind..."
  case "$OS" in
    mac|fedora|arch)
      install_pkg kind
      ;;
    debian|linux-generic)
      if have brew; then
        install_pkg kind
      elif have go; then
        GO111MODULE=on go install sigs.k8s.io/kind@v0.26.0
        local gobin
        gobin="$(go env GOBIN)"; [[ -z "$gobin" ]] && gobin="$(go env GOPATH)/bin"
        warn "Make sure ${gobin} is on your PATH."
      else
        warn "Install kind manually: https://kind.sigs.k8s.io/docs/user/quick-start/#installation"
        return 1
      fi
      ;;
    *)
      install_pkg kind
      ;;
  esac
}

ensure_golangci() {
  have golangci-lint && { log "golangci:    $(golangci-lint --version | head -1)"; return; }
  [[ $CHECK_ONLY -eq 1 ]] && { warn "golangci-lint missing (optional)"; return 0; }
  log "Installing golangci-lint..."
  case "$OS" in
    mac) install_pkg golangci-lint ;;
    *)   curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b "$(go env GOPATH)/bin" v2.11.0 ;;
  esac
}

# ---------- run ----------

ensure_go
ensure_python
ensure_uv
ensure_node
ensure_pnpm
ensure_precommit
ensure_addlicense
if [[ $WITH_HELM -eq 1 ]]; then
  ensure_helm
  ensure_kubectl
  ensure_kind
fi
ensure_golangci

if [[ $CHECK_ONLY -eq 1 ]]; then
  log "Check complete."
  exit 0
fi

if [[ -f .pre-commit-config.yaml ]]; then
  log "Installing git pre-commit hook..."
  pre-commit install
fi

log "Done. Run 'pre-commit run --all-files' to verify headers on the full tree."
