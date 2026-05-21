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

# sico -- one-click Kind cluster setup and deploy (local development only)
#
# Builds images into a local registry on localhost:5000 and installs Helm
# charts into a Kind cluster. For real clusters, push images to your own
# registry and run `helm upgrade` / `kubectl rollout restart` directly.
#
# Usage: ./deploy/kind/setup.sh [up|stop|down|restart] [backend|core|frontend]
set -euo pipefail

export PATH="${HOME}/go/bin:/usr/local/bin:/usr/local/go/bin:${PATH}"

CMD="${1:?"Usage: $0 [up|stop|down|restart] [backend|core|frontend]"}"
SVC="${2:-}"
SCRIPT_DIR="$(realpath "$(dirname "${BASH_SOURCE[0]}")")"
ROOT_DIR="$(realpath "${SCRIPT_DIR}/../..")"

case "${CMD}" in
  up|stop|down|restart) ;;
  *)
    echo "Usage: $0 [up|stop|down|restart] [backend|core|frontend]" >&2
    exit 1
    ;;
esac

# Load .env without evaluating values as shell code
if [[ -f "${ROOT_DIR}/.env" ]]; then
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    # skip blank lines, whitespace-only lines, and comments
    [[ -z "${line}" || "${line}" =~ ^[[:space:]]*$ || "${line}" =~ ^[[:space:]]*# ]] && continue
    if ! [[ "${line}" =~ ^[A-Za-z_][A-Za-z0-9_]*=.*$ ]]; then
      echo "ERROR: .env contains invalid line: ${line}" >&2
      exit 1
    fi
    key="${line%%=*}"
    value="${line#*=}"
    export "${key}=${value}"
  done < "${ROOT_DIR}/.env"
fi

CLUSTER_NAME="${CLUSTER_NAME:-sico}"
REGISTRY="${REGISTRY:-localhost:5000}"
KIND_CONFIG="${KIND_CONFIG:-${SCRIPT_DIR}/kind-config.yaml}"
KUBE_CONTEXT="${KUBE_CONTEXT:-kind-${CLUSTER_NAME}}"
VERSION="${VERSION:-local}"

# -- stop / down -----------------------------------------------------------------

stop_port_forwards() {
  pkill -f "kubectl.*port-forward.*svc/sico-" 2>/dev/null || true
}

stop_kind_nodes() {
  local nodes=""
  nodes="$(docker ps -q --filter "label=io.x-k8s.kind.cluster=${CLUSTER_NAME}" 2>/dev/null || true)"
  if [[ -z "${nodes}" ]]; then
    echo "No running Kind node containers found for cluster '${CLUSTER_NAME}'."
    return
  fi

  echo "Stopping Kind node containers for cluster '${CLUSTER_NAME}'..."
  while IFS= read -r node; do
    [[ -z "${node}" ]] && continue
    docker stop "${node}" >/dev/null
  done <<< "${nodes}"
}

stop_local_registry() {
  if ! docker inspect sico-registry >/dev/null 2>&1; then
    echo "Local registry container does not exist."
    return
  fi

  if [[ "$(docker inspect -f '{{.State.Running}}' sico-registry)" == "true" ]]; then
    echo "Stopping local registry container..."
    docker stop sico-registry >/dev/null
  else
    echo "Local registry container is already stopped."
  fi
}

ensure_local_registry() {
  if ! docker inspect sico-registry >/dev/null 2>&1; then
    echo "Starting local registry on port 5000..."
    docker run -d --restart=always -p 5000:5000 --name sico-registry registry:2
  elif [[ "$(docker inspect -f '{{.State.Running}}' sico-registry)" != "true" ]]; then
    echo "Starting existing local registry..."
    docker start sico-registry >/dev/null
  else
    echo "Local registry already running."
  fi
}

if [[ "${CMD}" == "down" ]]; then
  echo "Tearing down Kind cluster '${CLUSTER_NAME}'..."
  stop_port_forwards
  kind delete cluster --name "${CLUSTER_NAME}" 2>/dev/null || true
  docker rm -f sico-registry 2>/dev/null || true
  echo "Done."
  exit 0
fi

if [[ "${CMD}" == "stop" ]]; then
  echo "Stopping Kind cluster '${CLUSTER_NAME}' without deleting data..."
  stop_port_forwards
  stop_kind_nodes
  stop_local_registry
  echo "Done. Run 'make kind-up' to start it again."
  exit 0
fi

if [[ "${CMD}" == "restart" ]]; then
  case "${SVC}" in
    backend|core|frontend) ;;
    *)
      echo "Usage: $0 restart [backend|core|frontend]" >&2
      exit 1
      ;;
  esac
fi

# Validate that required passwords are set
for var in DB_PASSWORD REDIS_PASSWORD; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: ${var} is not set. Define it in .env" >&2
    exit 1
  fi
done

prepare_backend_helm_extra_args() {
  BACKEND_HELM_EXTRA_ARGS=()
  if [[ -n "${SANDBOX_EMULATOR_BASE_URL:-}" ]]; then
    EFFECTIVE_EMULATOR_URL="${SANDBOX_EMULATOR_BASE_URL}"
    if [[ "${SANDBOX_EMULATOR_BASE_URL}" == *"host.docker.internal"* ]]; then
      NODE_CONTAINER="${CLUSTER_NAME}-control-plane"
      HOST_IP="$(docker exec "${NODE_CONTAINER}" getent ahostsv4 host.docker.internal 2>/dev/null | awk '{print $1}' | head -n1 || true)"
      if [[ -z "${HOST_IP}" ]]; then
        HOST_IP="$(docker exec "${NODE_CONTAINER}" getent hosts host.docker.internal 2>/dev/null | awk '{print $1}' | head -n1 || true)"
      fi
      if [[ -z "${HOST_IP}" ]]; then
        echo "WARN: could not resolve host.docker.internal from kind node '${NODE_CONTAINER}'." >&2
        echo "      The backend pod will likely fail to reach the host emulator." >&2
        echo "      On Linux you may need Docker 20.10+ and host-gateway support, or set SANDBOX_EMULATOR_BASE_URL to your host LAN IP." >&2
      else
        if [[ "${HOST_IP}" == *:* ]]; then
          REPLACEMENT="[${HOST_IP}]"
        else
          REPLACEMENT="${HOST_IP}"
        fi
        EFFECTIVE_EMULATOR_URL="${SANDBOX_EMULATOR_BASE_URL//host.docker.internal/${REPLACEMENT}}"
        echo "Resolved host.docker.internal -> ${HOST_IP} (SANDBOX_EMULATOR_BASE_URL=${EFFECTIVE_EMULATOR_URL})"
      fi
    fi
    BACKEND_HELM_EXTRA_ARGS+=(--set-string "env.SANDBOX_EMULATOR_BASE_URL=${EFFECTIVE_EMULATOR_URL}")
  fi
}

prepare_core_helm_extra_args() {
  CORE_HELM_EXTRA_ARGS=()
  if [[ -n "${SICO_PORT:-}" ]]; then
    CORE_HELM_EXTRA_ARGS+=(--set-string "env.SICO_PORT=${SICO_PORT}")
  fi
}

build_kind_image() {
  local svc="$1"
  local dockerfile=""
  local image=""
  local context=""

  case "${svc}" in
    backend)
      dockerfile="backend/deployments/docker/Dockerfile"
      image="sico-backend"
      context="backend/"
      ;;
    core)
      dockerfile="core/deployments/docker/Dockerfile"
      image="sico-core"
      context="."
      ;;
    frontend)
      dockerfile="frontend/deployments/docker/Dockerfile"
      image="sico-frontend"
      context="frontend/"
      ;;
    *)
      echo "ERROR: unsupported service '${svc}'. Use backend, core, or frontend." >&2
      exit 1
      ;;
  esac

  echo "Building ${svc} image..."
  docker build -f "${dockerfile}" -t "${REGISTRY}/sico/${image}:${VERSION}" "${context}"
  echo "Pushing ${svc} image to local registry..."
  docker push "${REGISTRY}/sico/${image}:${VERSION}"
  echo "Loading ${svc} image directly into Kind nodes..."
  kind load docker-image "${REGISTRY}/sico/${image}:${VERSION}" --name "${CLUSTER_NAME}"
}

deploy_kind_service() {
  local svc="$1"

  case "${svc}" in
    backend)
      prepare_backend_helm_extra_args
      helm upgrade --install sico-backend backend/deployments/helm \
        --namespace sico \
        --set image.repository=${REGISTRY}/sico/sico-backend \
        --set image.tag=${VERSION} \
        "${BACKEND_HELM_EXTRA_ARGS[@]}" \
        --kube-context "${KUBE_CONTEXT}" \
        --wait --timeout 60s
      kubectl --context "${KUBE_CONTEXT}" -n sico rollout restart deployment/sico-backend
      kubectl --context "${KUBE_CONTEXT}" -n sico rollout status deployment/sico-backend --timeout=120s
      ;;
    core)
      prepare_core_helm_extra_args
      helm upgrade --install sico-core core/deployments/helm \
        --namespace sico \
        --set image.repository=${REGISTRY}/sico/sico-core \
        --set image.tag=${VERSION} \
        "${CORE_HELM_EXTRA_ARGS[@]}" \
        --kube-context "${KUBE_CONTEXT}" \
        --wait --timeout 120s
      kubectl --context "${KUBE_CONTEXT}" -n sico rollout restart deployment/sico-core
      kubectl --context "${KUBE_CONTEXT}" -n sico rollout status deployment/sico-core --timeout=120s
      ;;
    frontend)
      helm upgrade --install sico-frontend frontend/deployments/helm \
        --namespace sico \
        --set image.repository=${REGISTRY}/sico/sico-frontend \
        --set image.tag=${VERSION} \
        --kube-context "${KUBE_CONTEXT}" \
        --wait --timeout 60s
      kubectl --context "${KUBE_CONTEXT}" -n sico rollout restart deployment/sico-frontend
      kubectl --context "${KUBE_CONTEXT}" -n sico rollout status deployment/sico-frontend --timeout=120s
      ;;
    *)
      echo "ERROR: unsupported service '${svc}'. Use backend, core, or frontend." >&2
      exit 1
      ;;
  esac
}

if [[ "${CMD}" == "restart" ]]; then
  if ! kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
    echo "ERROR: Kind cluster '${CLUSTER_NAME}' does not exist. Run 'make kind-up' first." >&2
    exit 1
  fi

  echo "Restarting Kind service '${SVC}'..."
  ensure_local_registry
  docker network connect kind sico-registry 2>/dev/null || true
  cd "${ROOT_DIR}"
  build_kind_image "${SVC}"
  deploy_kind_service "${SVC}"
  echo "Done."
  exit 0
fi

# -- up -------------------------------------------------------------------------

echo "=========================================="
echo "  sico -- Kind Local Deployment"
echo "=========================================="
echo ""

# 1. Local registry (for kind to pull images)
ensure_local_registry

# 2. Create Kind cluster
EXISTING_KIND_NODES="$(docker ps -aq --filter "label=io.x-k8s.kind.cluster=${CLUSTER_NAME}" 2>/dev/null || true)"
if [[ -n "${EXISTING_KIND_NODES}" ]]; then
  while IFS= read -r node; do
    [[ -z "${node}" ]] && continue
    if [[ "$(docker inspect -f '{{.State.Running}}' "${node}")" != "true" ]]; then
      echo "Starting existing Kind node container ${node}..."
      docker start "${node}" >/dev/null
    fi
  done <<< "${EXISTING_KIND_NODES}"
fi

if kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
  echo "Kind cluster '${CLUSTER_NAME}' already exists."
else
  echo "Creating Kind cluster '${CLUSTER_NAME}'..."
  kind create cluster --name "${CLUSTER_NAME}" --config "${KIND_CONFIG}"
fi

# Connect registry to kind network
docker network connect kind sico-registry 2>/dev/null || true

# Tell Kind nodes about the local registry
kubectl --context "${KUBE_CONTEXT}" apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: local-registry-hosting
  namespace: kube-public
data:
  localRegistryHosting.v1: |
    host: "${REGISTRY}"
    help: "https://kind.sigs.k8s.io/docs/user/local-registry/"
EOF

# 3. Build and load images
echo ""
echo "Building images..."
cd "${ROOT_DIR}"
build_kind_image backend
build_kind_image core
build_kind_image frontend

# 4. Deploy infrastructure (MySQL + Redis)
echo ""
echo "Deploying infrastructure..."
# Create namespaces if they don't exist
kubectl --context "${KUBE_CONTEXT}" create namespace sico 2>/dev/null || true
kubectl --context "${KUBE_CONTEXT}" create namespace python-sandbox 2>/dev/null || true

# Create Kubernetes secret for credentials
kubectl --context "${KUBE_CONTEXT}" -n sico create secret generic sico-credentials \
  --from-literal=DB_NAME="${DB_NAME:-sico}" \
  --from-literal=DB_USER="${DB_USER:-sico}" \
  --from-literal=DB_PASSWORD="${DB_PASSWORD}" \
  --from-literal=REDIS_PASSWORD="${REDIS_PASSWORD}" \
  --from-literal=SANDBOX_CLIENT_SECRET_TEST_CLIENT="${SANDBOX_CLIENT_SECRET_TEST_CLIENT:-}" \
  --dry-run=client -o yaml | kubectl --context "${KUBE_CONTEXT}" -n sico apply -f -

# Delete previous Kafka init Job if it exists (Jobs are immutable)
kubectl --context "${KUBE_CONTEXT}" -n sico delete job sico-kafka-init --ignore-not-found

# Infrastructure: MySQL, Redis, Kafka, SeaweedFS, Nginx
kubectl --context "${KUBE_CONTEXT}" apply -f "${SCRIPT_DIR}/infra.yaml"
echo "Waiting for MySQL to be ready..."
kubectl --context "${KUBE_CONTEXT}" -n sico rollout status deployment/sico-mysql --timeout=300s
echo "Waiting for Redis to be ready..."
kubectl --context "${KUBE_CONTEXT}" -n sico rollout status deployment/sico-redis --timeout=120s
echo "Waiting for Kafka to be ready..."
kubectl --context "${KUBE_CONTEXT}" -n sico rollout status deployment/sico-kafka --timeout=120s
echo "Waiting for SeaweedFS to be ready..."
kubectl --context "${KUBE_CONTEXT}" -n sico rollout status deployment/sico-seaweedfs-master --timeout=120s
kubectl --context "${KUBE_CONTEXT}" -n sico rollout status deployment/sico-seaweedfs-volume --timeout=120s
kubectl --context "${KUBE_CONTEXT}" -n sico rollout status deployment/sico-seaweedfs-filer --timeout=120s
echo "Waiting for Qdrant to be ready..."
kubectl --context "${KUBE_CONTEXT}" -n sico rollout status deployment/sico-qdrant --timeout=120s

# 5. Deploy app services
echo ""
echo "Deploying sico services..."
deploy_kind_service core
deploy_kind_service backend
deploy_kind_service frontend

# 6. Apply network policies
echo ""
echo "Applying network policies..."
kubectl --context "${KUBE_CONTEXT}" apply -f "${SCRIPT_DIR}/network-policies.yaml"

# 7. Wait for nginx
echo ""
echo "Waiting for Nginx to be ready..."
kubectl --context "${KUBE_CONTEXT}" -n sico rollout restart deployment/sico-nginx
kubectl --context "${KUBE_CONTEXT}" -n sico rollout status deployment/sico-nginx --timeout=60s
# Allow endpoint propagation after the rollout so the port-forward below
# connects to the new (not the terminating) pod.
sleep 3

# 8. Expose services via port-forward (matching docker-compose ports)
echo ""
echo "Setting up port-forwards..."
SICO_PORT="${SICO_PORT:-8080}"
# Kill any existing sico port-forwards to avoid port conflicts on re-runs
pkill -f "kubectl.*port-forward.*svc/sico-" 2>/dev/null || true
sleep 1
kubectl --context "${KUBE_CONTEXT}" -n sico port-forward svc/sico-nginx "${SICO_PORT}:8080" >/dev/null 2>&1 &
kubectl --context "${KUBE_CONTEXT}" -n sico port-forward svc/sico-mysql 14000:3306 >/dev/null 2>&1 &
kubectl --context "${KUBE_CONTEXT}" -n sico port-forward svc/sico-kafka-ui 14001:8080 >/dev/null 2>&1 &
kubectl --context "${KUBE_CONTEXT}" -n sico port-forward svc/sico-seaweedfs-master 14002:9333 >/dev/null 2>&1 &
kubectl --context "${KUBE_CONTEXT}" -n sico port-forward svc/sico-seaweedfs-filer 14003:14003 >/dev/null 2>&1 &
kubectl --context "${KUBE_CONTEXT}" -n sico port-forward svc/sico-qdrant 14004:6333 >/dev/null 2>&1 &

echo ""
echo "=========================================="
echo "  sico is running!"
echo "=========================================="
echo ""
echo "  Home:             http://localhost:${SICO_PORT}/"
echo "  Frontend Login:   http://localhost:${SICO_PORT}/login"
echo "  Developer:        http://localhost:${SICO_PORT}/developer"
echo "  API docs:         http://localhost:${SICO_PORT}/api/sico/docs/index.html"
echo "    Default user:   operator@sico.local"
echo "    Default pass:   operator"
echo "  MySQL:            localhost:14000  (user: ${DB_USER:-sico})"
echo "  Kafka UI:         http://localhost:14001"
echo "  SeaweedFS Master: http://localhost:14002"
echo "  SeaweedFS Filer:  http://localhost:14003"
echo "  Qdrant Dashboard: http://localhost:14004/dashboard"
echo "  Cluster:          ${KUBE_CONTEXT}"
echo "  Stop:             make kind-stop"
echo "  Remove:           make kind-down"
echo ""
