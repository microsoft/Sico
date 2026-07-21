# sico -- Makefile
.PHONY: help setup setup-check setup-kind setup-kind-check lint lint-fix license-check precommit-run precommit-update
.PHONY: openapi build-frontend
.PHONY: compose-up compose-down compose-logs
.PHONY: kind-up kind-stop kind-down kind-restart
.PHONY: emulator-setup emulator-start emulator-stop emulator-restart emulator-status emulator-logs
.PHONY: emulator-bootstrap emulator-stop-devices

# Detect platform so we can dispatch to the right installer script.
ifeq ($(OS),Windows_NT)
  INSTALL_CMD := powershell -ExecutionPolicy Bypass -File scripts/install-dev-tools.ps1
  INSTALL_KIND_CMD := powershell -ExecutionPolicy Bypass -File scripts/install-dev-tools.ps1 -WithHelm
else
  INSTALL_CMD := bash scripts/install-dev-tools.sh
  INSTALL_KIND_CMD := bash scripts/install-dev-tools.sh --with-helm
endif

help:
	@echo ""
	@echo "sico"
	@echo "===="
	@echo ""
	@echo "Developer setup:"
	@echo "  make setup             Install default toolchain + git hooks (macOS/Linux/Windows)"
	@echo "  make setup-check       Verify the default toolchain is installed"
	@echo "  make setup-kind        Install default toolchain + Helm/kubectl/kind for Kind work"
	@echo "  make setup-kind-check  Verify the Kind toolchain (Helm + kubectl + kind) is installed"
	@echo "  make precommit-run     Run all pre-commit hooks against the whole tree"
	@echo "  make precommit-update  Update pinned hook versions in .pre-commit-config.yaml"
	@echo "  make lint              Run repository-wide lint checks"
	@echo "  make lint-fix          Run lints with auto-fixes where supported"
	@echo "  make license-check     Verify every source file has a MIT license header"
	@echo "  make openapi           Regenerate backend swagger docs (api/openapi)"
	@echo "  make build-frontend    Install deps and build the frontend SPA from source"
	@echo ""
	@echo "Docker Compose (local):"
	@echo "  make compose-up              Build and start full stack"
	@echo "  make compose-up SERVICE=core Rebuild/recreate one service image"
	@echo "  make compose-down            Stop and remove containers"
	@echo "  make compose-down-volumes    Stop and remove containers + volumes (data loss)"
	@echo "  make compose-logs            Tail logs"
	@echo ""
	@echo "Kind (local Kubernetes):"
	@echo "  make kind-up              Create Kind cluster and deploy everything"
	@echo "  make kind-stop            Stop Kind containers without deleting data"
	@echo "  make kind-down            Tear down Kind cluster"
	@echo "  make kind-restart SVC=xxx Rebuild and roll out one app service image"
	@echo ""
	@echo "Emulator service (macOS / Windows host only):"
	@echo "  make emulator-setup             Install prereqs and start API service"
	@echo "  make emulator-start             Start the emulator API service only"
	@echo "  make emulator-stop              Stop the emulator API service only"
	@echo "  make emulator-restart           Restart the emulator API service only"
	@echo "  make emulator-status            Show the emulator API service status"
	@echo "  make emulator-bootstrap         Bootstrap default device; requires API service"
	@echo "  make emulator-stop-devices      Stop all running emulator devices"
	@echo "  make emulator-logs              Tail the emulator API service log"
	@echo ""

# -- Developer setup ---------------------------------------------------------

setup:
	$(INSTALL_CMD)

setup-check:
ifeq ($(OS),Windows_NT)
	powershell -ExecutionPolicy Bypass -File scripts/install-dev-tools.ps1 -Check
else
	bash scripts/install-dev-tools.sh --check
endif

setup-kind:
	$(INSTALL_KIND_CMD)

setup-kind-check:
ifeq ($(OS),Windows_NT)
	powershell -ExecutionPolicy Bypass -File scripts/install-dev-tools.ps1 -Check -WithHelm
else
	bash scripts/install-dev-tools.sh --check --with-helm
endif

precommit-run:
	pre-commit run --all-files

precommit-update:
	pre-commit autoupdate

lint:
	@bash scripts/lint.sh

lint-fix:
	@bash scripts/lint.sh --fix

license-check:
	pre-commit run addlicense --all-files

# -- OpenAPI (swagger) --------------------------------------------------------
# Regenerate backend/api/openapi/* from swag annotations.
# The same command is invoked by scripts/lint.sh and CI, so all three paths
# stay aligned.

openapi:
	@command -v swag >/dev/null 2>&1 || { \
		echo "swag not found. Install: go install github.com/swaggo/swag/cmd/swag@latest"; \
		exit 1; }
	cd backend && swag init -g cmd/sico-server/main.go --parseDependency --parseInternal -o api/openapi

# -- Frontend (build SPA from source) -----------------------------------------
# Install workspace deps and build packages/app/dist. Optional for local dev:
# `make compose-up` and `make kind-up` build the frontend image from source too.

build-frontend:
	cd frontend && pnpm install --frozen-lockfile && pnpm build
	@echo "frontend/packages/app/dist ready"

# -- Docker Compose -----------------------------------------------------------

COMPOSE := docker compose -p sico -f deploy/docker/docker-compose.yaml --env-file .env

compose-up:
	$(COMPOSE) up --build -d $(SERVICE)
	@echo ""
	@port=$$(awk -F= '/^SICO_PORT=/{print $$2}' .env 2>/dev/null | tail -1 | tr -d '"' | tr -d "'"); \
	port=$${port:-8080}; \
	echo "sico is running!"; \
	echo "  Home:            http://localhost:$${port}/"; \
	echo "  UI login:        http://localhost:$${port}/login"; \
	echo "  API docs:        http://localhost:$${port}/api/sico/docs/index.html"; \
	echo "  Health:          http://localhost:$${port}/api/sico/health"

compose-down:
	$(COMPOSE) down --remove-orphans

compose-down-volumes:
	$(COMPOSE) down --volumes --remove-orphans

compose-logs:
	$(COMPOSE) logs -f

# -- Kind ---------------------------------------------------------------------

kind-up:
	bash deploy/kind/setup.sh up

kind-stop:
	bash deploy/kind/setup.sh stop

kind-down:
	bash deploy/kind/setup.sh down

kind-restart:
	bash deploy/kind/setup.sh restart "$(SVC)"

# -- Emulator service ---------------------------------------------------------
# The emulator service runs directly on the host (macOS or Windows via Git
# Bash) because it depends on a GUI Android emulator backend (Android Studio
# AVD or MuMu Player). It is not containerized.

EMULATOR_SETUP := bash sandbox/emulator/setup/setup.sh

emulator-setup:
	$(EMULATOR_SETUP) install

emulator-start:
	$(EMULATOR_SETUP) start

emulator-stop:
	$(EMULATOR_SETUP) stop

emulator-restart:
	$(EMULATOR_SETUP) restart

emulator-status:
	$(EMULATOR_SETUP) status

emulator-bootstrap:
	$(EMULATOR_SETUP) bootstrap

emulator-stop-devices:
	$(EMULATOR_SETUP) stop-devices

emulator-logs:
	$(EMULATOR_SETUP) logs
