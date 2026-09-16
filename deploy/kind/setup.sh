#!/usr/bin/env bash
# sico -- one-click Kind cluster setup and deploy (local development only)
#
# Builds images into a local registry on localhost:5000 and installs Helm
# charts into a Kind cluster. For real clusters, push images to your own
# registry and run `helm upgrade` / `kubectl rollout restart` directly.
#
# Usage: ./deploy/kind/setup.sh [up|stop|down|restart] [backend|core|frontend|linux-workstation]
set -euo pipefail

export PATH="${HOME}/go/bin:/usr/local/bin:/usr/local/go/bin:${PATH}"

CMD="${1:?"Usage: $0 [up|stop|down|restart] [backend|core|frontend|linux-workstation]"}"
SVC="${2:-}"
SCRIPT_DIR="$(realpath "$(dirname "${BASH_SOURCE[0]}")")"
ROOT_DIR="$(realpath "${SCRIPT_DIR}/../..")"
REQUESTED_BACKEND_DOCKERFILE="${BACKEND_DOCKERFILE:-}"
REQUESTED_VERSION="${VERSION:-}"
REQUESTED_OBSERVABILITY_PERSISTENCE_ENABLED="${OBSERVABILITY_PERSISTENCE_ENABLED:-}"

case "${CMD}" in
  up|stop|down|restart) ;;
  *)
    echo "Usage: $0 [up|stop|down|restart] [backend|core|frontend]" >&2
    exit 1
    ;;
esac

source "${ROOT_DIR}/scripts/load-env.sh"
if [[ "${CMD}" == "up" || "${CMD}" == "restart" ]]; then
  ensure_sandbox_service_token "${ROOT_DIR}/.env" "${SICO_SANDBOX_SERVICE_TOKEN:-}"
fi
load_env_file "${ROOT_DIR}/.env"
SICO_SANDBOX_SERVICE_TOKEN="$(read_sandbox_service_token "${ROOT_DIR}/.env")"

CLUSTER_NAME="${CLUSTER_NAME:-sico}"
REGISTRY="${REGISTRY:-localhost:5000}"
KIND_CONFIG="${KIND_CONFIG:-${SCRIPT_DIR}/kind-config.yaml}"
KUBE_CONTEXT="${KUBE_CONTEXT:-kind-${CLUSTER_NAME}}"
VERSION="${REQUESTED_VERSION:-${VERSION:-local}}"
BACKEND_DOCKERFILE="${REQUESTED_BACKEND_DOCKERFILE:-${BACKEND_DOCKERFILE:-backend/deployments/docker/Dockerfile}}"
BACKEND_DEPLOY_TIMEOUT="${BACKEND_DEPLOY_TIMEOUT:-300s}"
BACKEND_ROLLOUT_TIMEOUT="${BACKEND_ROLLOUT_TIMEOUT:-300s}"
BACKEND_HELM_VALUES_FILE="${BACKEND_HELM_VALUES_FILE:-}"
CORE_HELM_VALUES_FILE="${CORE_HELM_VALUES_FILE:-}"
LINUX_WORKSTATION_HELM_VALUES_FILE="${LINUX_WORKSTATION_HELM_VALUES_FILE:-${SCRIPT_DIR}/linux-workstation-values.yaml}"
OBSERVABILITY_PERSISTENCE_ENABLED="${REQUESTED_OBSERVABILITY_PERSISTENCE_ENABLED:-${OBSERVABILITY_PERSISTENCE_ENABLED:-}}"
OBSERVABILITY_GRAFANA_PORT="${OBSERVABILITY_GRAFANA_PORT:-14005}"
OBSERVABILITY_OTLP_GRPC_PORT="${OBSERVABILITY_OTLP_GRPC_PORT:-14006}"
OBSERVABILITY_OTLP_HTTP_PORT="${OBSERVABILITY_OTLP_HTTP_PORT:-14007}"

if [[ "${CMD}" == "restart" && -z "${OBSERVABILITY_PERSISTENCE_ENABLED}" ]]; then
  observability_claim="$(kubectl --context "${KUBE_CONTEXT}" -n sico get deployment sico-otel-lgtm \
    -o jsonpath='{.spec.template.spec.volumes[?(@.name=="data")].persistentVolumeClaim.claimName}' \
    2>/dev/null || true)"
  if [[ "${observability_claim}" == "sico-otel-lgtm-data" ]]; then
    OBSERVABILITY_PERSISTENCE_ENABLED=true
  else
    OBSERVABILITY_PERSISTENCE_ENABLED=false
  fi
fi
OBSERVABILITY_PERSISTENCE_ENABLED="${OBSERVABILITY_PERSISTENCE_ENABLED:-false}"

case "${OBSERVABILITY_PERSISTENCE_ENABLED}" in
  true|false) ;;
  *)
    echo "ERROR: OBSERVABILITY_PERSISTENCE_ENABLED must be 'true' or 'false'," \
      "got '${OBSERVABILITY_PERSISTENCE_ENABLED}'." >&2
    exit 1
    ;;
esac

# -- stop / down -----------------------------------------------------------------

stop_port_forwards() {
  pkill -f "kubectl.*port-forward.*svc/sico-" 2>/dev/null || true
  pkill -f "kubectl.*port-forward.*svc/linux-workstation-sandbox" 2>/dev/null || true
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
  docker volume create sico-registry-data >/dev/null
  if ! docker inspect sico-registry >/dev/null 2>&1; then
    echo "Starting local registry on port 5000..."
    docker run -d --restart=always -p 5000:5000 --name sico-registry \
      -e REGISTRY_STORAGE_DELETE_ENABLED=true \
      -v sico-registry-data:/var/lib/registry \
      registry:2
  elif ! docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' sico-registry | grep -q '^REGISTRY_STORAGE_DELETE_ENABLED=true$'; then
    echo "Recreating local registry with manifest deletion enabled..."
    docker rm -f sico-registry >/dev/null
    docker run -d --restart=always -p 5000:5000 --name sico-registry \
      -e REGISTRY_STORAGE_DELETE_ENABLED=true \
      -v sico-registry-data:/var/lib/registry \
      registry:2
  elif [[ "$(docker inspect -f '{{.State.Running}}' sico-registry)" != "true" ]]; then
    echo "Starting existing local registry..."
    docker start sico-registry >/dev/null
  else
    echo "Local registry already running."
  fi
}

configure_kind_registry() {
  if [[ "${REGISTRY}" != "localhost:5000" ]]; then
    KIND_REGISTRY_ENDPOINT="${REGISTRY}"
    return
  fi

  KIND_REGISTRY_IP="$(docker inspect -f '{{(index .NetworkSettings.Networks "kind").IPAddress}}' sico-registry)"
  if [[ -z "${KIND_REGISTRY_IP}" ]]; then
    echo "ERROR: local registry has no IP on the Kind network." >&2
    exit 1
  fi
  KIND_REGISTRY_ENDPOINT="${KIND_REGISTRY_IP}:5000"

  local registry_dir="/etc/containerd/certs.d/${REGISTRY}"
  local node=""
  while IFS= read -r node; do
    [[ -z "${node}" ]] && continue
    docker exec "${node}" mkdir -p "${registry_dir}"
    printf '%s\n' \
      'server = "http://sico-registry:5000"' \
      '[host."http://sico-registry:5000"]' \
      '  capabilities = ["pull", "resolve", "push"]' \
      | docker exec -i "${node}" tee "${registry_dir}/hosts.toml" >/dev/null
  done < <(kind get nodes --name "${CLUSTER_NAME}")
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
    backend|core|frontend|linux-workstation) ;;
    *)
      echo "Usage: $0 restart [backend|core|frontend|linux-workstation]" >&2
      exit 1
      ;;
  esac
fi

require_env_vars DB_PASSWORD REDIS_PASSWORD PYPI_INDEX_URL NPM_REGISTRY SICO_SANDBOX_SERVICE_TOKEN

ensure_sandbox_auth_secret() {
  kubectl --context "${KUBE_CONTEXT}" -n sico create secret generic sandbox-service-auth \
    --from-literal=SICO_SANDBOX_SERVICE_TOKEN="${SICO_SANDBOX_SERVICE_TOKEN}" \
    --dry-run=client -o yaml | kubectl --context "${KUBE_CONTEXT}" -n sico apply -f -
}

prepare_backend_helm_extra_args() {
  BACKEND_HELM_EXTRA_ARGS=(
    --set-string "env.APP_ENV=development"
    --set-string "env.SEED_AGENT_INSTANCES=${SEED_AGENT_INSTANCES:-false}"
    --set-string "env.SANDBOX_LINUX_WORKSTATION_K8S=true"
    --set-string "env.SANDBOX_LINUX_WORKSTATION_K8S_NAMESPACE=sandbox"
    --set-string "env.SANDBOX_LINUX_WORKSTATION_K8S_SERVICE=linux-workstation-sandbox"
    --set-string "env.SANDBOX_LINUX_WORKSTATION_K8S_STATEFULSET=linux-workstation-sandbox"
    --set-string "env.SANDBOX_LINUX_WORKSTATION_K8S_POD_SELECTOR=app=linux-workstation-sandbox"
    --set-string "env.SANDBOX_LINUX_WORKSTATION_K8S_PORT=8080"
    --set-string "env.SANDBOX_LINUX_WORKSTATION_K8S_MIN_IDLE=1"
    --set-string "env.SANDBOX_LINUX_WORKSTATION_K8S_MAX_IDLE=1"
    --set-string "env.SANDBOX_LINUX_WORKSTATION_K8S_MAX_REPLICAS=1"
    --set "serviceAccount.create=true"
    --set-string "serviceAccount.name=sico-backend"
  )
  if [[ -n "${BACKEND_HELM_VALUES_FILE}" ]]; then
    BACKEND_HELM_EXTRA_ARGS+=(-f "${BACKEND_HELM_VALUES_FILE}")
  fi
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
  BACKEND_HELM_EXTRA_ARGS+=(
    --set-string "env.OTEL_EXPORTER_OTLP_ENDPOINT=sico-otel-lgtm.sico.svc.cluster.local:4317"
    --set-string "env.OTEL_EXPORTER_OTLP_INSECURE=true"
  )
}

prepare_core_helm_extra_args() {
  CORE_HELM_EXTRA_ARGS=()
  if [[ -n "${CORE_HELM_VALUES_FILE}" ]]; then
    CORE_HELM_EXTRA_ARGS+=(-f "${CORE_HELM_VALUES_FILE}")
  fi
  if [[ -n "${SICO_PORT:-}" ]]; then
    CORE_HELM_EXTRA_ARGS+=(--set-string "env.SICO_PORT=${SICO_PORT}")
  fi
  local mem0_profile="${MEM0_CONFIG_PROFILE:-qdrant}"
  CORE_HELM_EXTRA_ARGS+=(--set-string "env.MEM0_CONFIG_PROFILE=${mem0_profile}")
  CORE_HELM_EXTRA_ARGS+=(--set-string "env.UV_DEFAULT_INDEX=${PYPI_INDEX_URL}")
  CORE_HELM_EXTRA_ARGS+=(
    --set-string "preparedEnvironment.image.repository=${REGISTRY}/sico/sico-environment-runner"
    --set-string "preparedEnvironment.image.tag=${VERSION}"
    --set-string "preparedEnvironment.repository=${KIND_REGISTRY_ENDPOINT}/sico/prepared-environment"
    --set-string "preparedEnvironment.pullRepository=${REGISTRY}/sico/prepared-environment"
    --set-string "preparedEnvironment.registryDeleteUrl=http://${KIND_REGISTRY_ENDPOINT}/v2/sico/prepared-environment/manifests/{digest}"
    --set-string "preparedEnvironment.docker.insecureRegistry=${KIND_REGISTRY_ENDPOINT}"
    --set-string "env.OTEL_EXPORTER_OTLP_ENDPOINT=sico-otel-lgtm.sico.svc.cluster.local:4317"
    --set-string "env.OTEL_EXPORTER_OTLP_INSECURE=true"
  )
  if [[ "${mem0_profile}" == "azure_ai_search" ]]; then
    local mem0_vars=(
      MEM0_AZURE_AI_SEARCH_SERVICE_NAME
      MEM0_AZURE_AI_SEARCH_INDEX_NAME
      MEM0_AZURE_OPENAI_ENDPOINT
      MEM0_AZURE_OPENAI_API_VERSION
      MEM0_AZURE_OPENAI_EMBEDDING_DEPLOYMENT
      MEM0_AZURE_OPENAI_LLM_MODEL
      MEM0_AZURE_OPENAI_LLM_DEPLOYMENT
    )
    local var
    for var in "${mem0_vars[@]}"; do
      if [[ -z "${!var:-}" ]]; then
        echo "ERROR: ${var} is required for the Azure AI Search Mem0 profile." >&2
        exit 1
      fi
      CORE_HELM_EXTRA_ARGS+=(--set-string "env.${var}=${!var}")
    done
  fi
}

build_kind_image() {
  local svc="$1"
  local dockerfile=""
  local image=""
  local context=""
  local build_args=()

  if [[ "${svc}" == "linux-workstation" ]]; then
    local local_image="${LINUX_WORKSTATION_SANDBOX_IMAGE:-sico/linux-workstation-sandbox:local}"
    local registry_image="${REGISTRY}/sico/sico-linux-workstation-sandbox:${VERSION}"
    echo "Building Linux Workstation sandbox image with local registry configuration..."
    "${ROOT_DIR}/scripts/build-linux-workstation-local.sh"
    docker tag "${local_image}" "${registry_image}"
    echo "Pushing Linux Workstation sandbox image to local registry..."
    docker push "${registry_image}"
    echo "Loading Linux Workstation sandbox image directly into Kind nodes..."
    kind load docker-image "${registry_image}" --name "${CLUSTER_NAME}"
    return
  fi

  case "${svc}" in
    backend)
      image="sico-backend"
      context="backend/"
      dockerfile="${BACKEND_DOCKERFILE}"
      ;;
    core)
      dockerfile="core/deployments/docker/Dockerfile"
      image="sico-core"
      context="."
      build_args+=(--build-arg "PYPI_INDEX_URL=${PYPI_INDEX_URL}")
      ;;
    frontend)
      dockerfile="frontend/deployments/docker/Dockerfile"
      image="sico-frontend"
      context="frontend/"
      build_args+=(--build-arg "NPM_REGISTRY=${NPM_REGISTRY}")
      ;;
    environment-runner)
      dockerfile="core/deployments/environment-runner/Dockerfile"
      image="sico-environment-runner"
      context="core/deployments/environment-runner"
      build_args+=(--build-arg "PIP_INDEX_URL=${PYPI_INDEX_URL}")
      ;;
    *)
      echo "ERROR: unsupported service '${svc}'. Use backend, core, frontend, linux-workstation, or environment-runner." >&2
      exit 1
      ;;
  esac

  echo "Building ${svc} image (dockerfile=${dockerfile})..."
  docker build "${build_args[@]}" -f "${dockerfile}" -t "${REGISTRY}/sico/${image}:${VERSION}" "${context}"
  echo "Pushing ${svc} image to local registry..."
  docker push "${REGISTRY}/sico/${image}:${VERSION}"
  echo "Loading ${svc} image directly into Kind nodes..."
  kind load docker-image "${REGISTRY}/sico/${image}:${VERSION}" --name "${CLUSTER_NAME}"
}

deploy_kind_service() {
  local svc="$1"

  case "${svc}" in
    backend)
      ensure_sandbox_auth_secret
      prepare_backend_helm_extra_args
      helm upgrade --install sico-backend backend/deployments/helm \
        --namespace sico \
        --set image.repository=${REGISTRY}/sico/sico-backend \
        --set image.tag=${VERSION} \
        "${BACKEND_HELM_EXTRA_ARGS[@]}" \
        --kube-context "${KUBE_CONTEXT}" \
        --wait --timeout "${BACKEND_DEPLOY_TIMEOUT}"
      kubectl --context "${KUBE_CONTEXT}" -n sico rollout restart deployment/sico-backend
      kubectl --context "${KUBE_CONTEXT}" -n sico rollout status deployment/sico-backend --timeout="${BACKEND_ROLLOUT_TIMEOUT}"
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
    linux-workstation)
      helm upgrade --install linux-workstation-sandbox sandbox/linux-workstation-sandbox/deployments/helm \
        --namespace sandbox \
        -f "${LINUX_WORKSTATION_HELM_VALUES_FILE}" \
        --set image.repository=${REGISTRY}/sico/sico-linux-workstation-sandbox \
        --set image.tag=${VERSION} \
        --kube-context "${KUBE_CONTEXT}" \
        --wait --timeout 300s
      kubectl --context "${KUBE_CONTEXT}" -n sandbox rollout status statefulset/linux-workstation-sandbox --timeout=300s
      ;;
    *)
      echo "ERROR: unsupported service '${svc}'. Use backend, core, frontend, or linux-workstation." >&2
      exit 1
      ;;
  esac
}

deploy_observability() {
  echo "Deploying local observability..."
  kubectl --context "${KUBE_CONTEXT}" -n sico create configmap sico-otel-lgtm-config \
    --from-file="${ROOT_DIR}/deploy/docker/observability/loki-config.yaml" \
    --from-file="${ROOT_DIR}/deploy/docker/observability/tempo-config.yaml" \
    --from-file="${ROOT_DIR}/deploy/docker/observability/run-prometheus.sh" \
    --from-file="${ROOT_DIR}/deploy/observability/dashboards.yaml" \
    --dry-run=client -o yaml | kubectl --context "${KUBE_CONTEXT}" apply -f -
  kubectl --context "${KUBE_CONTEXT}" -n sico create configmap sico-otel-lgtm-dashboards \
    --from-file="${ROOT_DIR}/deploy/observability/dashboards" \
    --dry-run=client -o yaml | kubectl --context "${KUBE_CONTEXT}" apply -f -
  kubectl --context "${KUBE_CONTEXT}" apply -f "${SCRIPT_DIR}/observability.yaml"
  if [[ "${OBSERVABILITY_PERSISTENCE_ENABLED}" == "true" ]]; then
    kubectl --context "${KUBE_CONTEXT}" apply -f "${SCRIPT_DIR}/observability-pvc.yaml"
    kubectl --context "${KUBE_CONTEXT}" -n sico patch deployment sico-otel-lgtm --type=json -p='[
      {"op":"replace","path":"/spec/template/spec/volumes/0","value":{
        "name":"data","persistentVolumeClaim":{"claimName":"sico-otel-lgtm-data"}
      }}
    ]'
  fi
  kubectl --context "${KUBE_CONTEXT}" -n sico rollout status deployment/sico-otel-lgtm --timeout=300s
}

if [[ "${CMD}" == "restart" ]]; then
  if ! kind get clusters 2>/dev/null | grep -q "^${CLUSTER_NAME}$"; then
    echo "ERROR: Kind cluster '${CLUSTER_NAME}' does not exist. Run 'make kind-up' first." >&2
    exit 1
  fi

  echo "Restarting Kind service '${SVC}'..."
  ensure_local_registry
  docker network connect kind sico-registry 2>/dev/null || true
  configure_kind_registry
  cd "${ROOT_DIR}"
  deploy_observability
  build_kind_image "${SVC}"
  if [[ "${SVC}" == "core" ]]; then
    build_kind_image environment-runner
  fi
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
configure_kind_registry

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
build_kind_image environment-runner
build_kind_image linux-workstation

# 4. Deploy infrastructure (MySQL + Redis)
echo ""
echo "Deploying infrastructure..."
# Create namespaces if they don't exist
kubectl --context "${KUBE_CONTEXT}" create namespace sico 2>/dev/null || true
kubectl --context "${KUBE_CONTEXT}" create namespace python-sandbox 2>/dev/null || true
kubectl --context "${KUBE_CONTEXT}" create namespace sandbox 2>/dev/null || true

# Create Kubernetes secret for credentials
kubectl --context "${KUBE_CONTEXT}" -n sico create secret generic sico-credentials \
  --from-literal=DB_NAME="${DB_NAME:-sico}" \
  --from-literal=DB_USER="${DB_USER:-sico}" \
  --from-literal=DB_PASSWORD="${DB_PASSWORD}" \
  --from-literal=REDIS_PASSWORD="${REDIS_PASSWORD}" \
  --from-literal=SANDBOX_CLIENT_SECRET_TEST_CLIENT="${SANDBOX_CLIENT_SECRET_TEST_CLIENT:-}" \
  --dry-run=client -o yaml | kubectl --context "${KUBE_CONTEXT}" -n sico apply -f -
ensure_sandbox_auth_secret

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

# Apply ingress policies before rolling app pods so their startup dependencies
# (including Qdrant and LGTM) are reachable on the first attempt.
echo ""
echo "Applying network policies..."
kubectl --context "${KUBE_CONTEXT}" apply -f "${SCRIPT_DIR}/network-policies.yaml"

deploy_observability

# 5. Deploy app services
echo ""
echo "Deploying sico services..."
deploy_kind_service core
kubectl --context "${KUBE_CONTEXT}" apply -f "${SCRIPT_DIR}/linux-workstation-rbac.yaml"
deploy_kind_service linux-workstation
deploy_kind_service backend
deploy_kind_service frontend

# 6. Wait for nginx
echo ""
echo "Waiting for Nginx to be ready..."
kubectl --context "${KUBE_CONTEXT}" -n sico rollout restart deployment/sico-nginx
kubectl --context "${KUBE_CONTEXT}" -n sico rollout status deployment/sico-nginx --timeout=60s
# Allow endpoint propagation after the rollout so the port-forward below
# connects to the new (not the terminating) pod.
sleep 3

# 7. Expose services via port-forward (matching docker-compose ports)
echo ""
echo "Setting up port-forwards..."
SICO_PORT="${SICO_PORT:-8080}"
LINUX_WORKSTATION_SANDBOX_PORT="${LINUX_WORKSTATION_SANDBOX_PORT:-14008}"
# Kill any existing sico port-forwards to avoid port conflicts on re-runs
pkill -f "kubectl.*port-forward.*svc/sico-" 2>/dev/null || true
pkill -f "kubectl.*port-forward.*svc/linux-workstation-sandbox" 2>/dev/null || true
sleep 1
kubectl --context "${KUBE_CONTEXT}" -n sico port-forward svc/sico-nginx "${SICO_PORT}:8080" >/dev/null 2>&1 &
kubectl --context "${KUBE_CONTEXT}" -n sico port-forward svc/sico-mysql 14000:3306 >/dev/null 2>&1 &
kubectl --context "${KUBE_CONTEXT}" -n sico port-forward svc/sico-kafka-ui 14001:8080 >/dev/null 2>&1 &
kubectl --context "${KUBE_CONTEXT}" -n sico port-forward svc/sico-seaweedfs-master 14002:9333 >/dev/null 2>&1 &
kubectl --context "${KUBE_CONTEXT}" -n sico port-forward svc/sico-seaweedfs-filer 14003:14003 >/dev/null 2>&1 &
kubectl --context "${KUBE_CONTEXT}" -n sico port-forward svc/sico-qdrant 14004:6333 >/dev/null 2>&1 &
kubectl --context "${KUBE_CONTEXT}" -n sandbox port-forward \
  svc/linux-workstation-sandbox "${LINUX_WORKSTATION_SANDBOX_PORT}:8080" >/dev/null 2>&1 &
kubectl --context "${KUBE_CONTEXT}" -n sico port-forward \
  svc/sico-otel-lgtm "${OBSERVABILITY_GRAFANA_PORT}:3000" >/dev/null 2>&1 &
kubectl --context "${KUBE_CONTEXT}" -n sico port-forward \
  svc/sico-otel-lgtm "${OBSERVABILITY_OTLP_GRPC_PORT}:4317" >/dev/null 2>&1 &
kubectl --context "${KUBE_CONTEXT}" -n sico port-forward \
  svc/sico-otel-lgtm "${OBSERVABILITY_OTLP_HTTP_PORT}:4318" >/dev/null 2>&1 &

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
echo "  Linux Workstation: http://localhost:${LINUX_WORKSTATION_SANDBOX_PORT}"
echo "  Grafana:          http://localhost:${OBSERVABILITY_GRAFANA_PORT} (admin/admin)"
echo "  Tech dashboard:   http://localhost:${OBSERVABILITY_GRAFANA_PORT}/d/sico-tech-prometheus"
echo "  Biz dashboard:    http://localhost:${OBSERVABILITY_GRAFANA_PORT}/d/sico-biz-prometheus"
echo "  OTLP/gRPC:        localhost:${OBSERVABILITY_OTLP_GRPC_PORT}"
echo "  OTLP/HTTP:        localhost:${OBSERVABILITY_OTLP_HTTP_PORT}"
echo "  Cluster:          ${KUBE_CONTEXT}"
echo "  Stop:             make kind-stop"
echo "  Remove:           make kind-down"
echo ""
