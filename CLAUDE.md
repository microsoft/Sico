# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sico is an open-source AI agent platform with three main services that communicate via gRPC and a bidirectional "reverse RPC" pattern. The backend handles HTTP APIs and persistence, the core handles AI/LLM orchestration, and the frontend provides a React dashboard.

> **The frontend lives in this repository and builds from source.** `frontend/` is a pnpm + Turborepo monorepo (`frontend/package.json`, `packages/{app,shared,ui,config}/`). The production image is built by a multi-stage Dockerfile (`frontend/deployments/docker/Dockerfile`) that runs `pnpm install --frozen-lockfile && pnpm build` and serves the resulting `packages/app/dist` with nginx. `make compose-up` and `make kind-up` build it automatically — no prebuilt archive is committed.

## Build & Run Commands

### Full Stack (Docker Compose)
```bash
cp .env.example .env          # first time only
make compose-up               # builds and starts all services (nginx, frontend, backend, core, mysql, redis, kafka, seaweedfs, qdrant)
make compose-down              # stop and remove containers
make compose-logs              # tail all service logs
```
Services available at http://localhost:8080 via nginx reverse proxy.

### Backend (Go)
```bash
cd backend
go build ./cmd/sico-server     # build the server binary
go test ./...                  # run all tests
go test ./internal/biz/sandbox/impl/...  # run tests in a single package
go test -run TestFunctionName ./internal/biz/sandbox/impl/...  # run a single test
```
Uses Google Wire for dependency injection. After changing `wire.go`, regenerate with:
```bash
cd backend/internal/di && wire
```

### Core (Python)
```bash
cd core
uv sync                        # install dependencies (uses uv, not pip)
uv run pytest                  # run all tests
uv run pytest tests/chat/      # run tests in a subdirectory
uv run ruff check .            # lint
uv run ruff format .           # format
```
Requires Python >=3.13. Uses `uv` for dependency management (pyproject.toml + uv.lock).

### Protobuf Code Generation
All `.proto` files live in `proto/`. Generation scripts are run from the `proto/` directory:
```bash
cd proto
bash gen.sh                        # run all targets below
bash gen.sh backend-grpc           # Go gRPC stubs → backend/internal/transport/grpc/pb/
bash gen.sh backend-http           # Go HTTP DTO structs → backend/internal/transport/http/dto/
bash gen.sh backend-reverse        # Go reverse-RPC stubs → backend/internal/transport/reverse_grpc/pb/
bash gen.sh core                   # Python betterproto2 stubs → core/app/pb/
```
Current proto generation covers Backend and Core outputs. It uses `protoc` + `protoc-go-inject-tag` for Go generation and `betterproto2` for Core Python generation.

### Kind (Local Kubernetes)
```bash
make kind-up     # creates cluster, builds images, deploys via Helm
make kind-down   # tear down
```

## Architecture

### Service Communication Pattern

```
Frontend (React) ──HTTP/SSE──▶ Nginx ──▶ Backend (Go/Gin)
                                            │         ▲
                                     gRPC   │         │  reverse gRPC
                                            ▼         │
                                         Core (Python/asyncio)
```

**Backend → Core (gRPC):** The backend calls core for LLM/chat operations via standard gRPC (core listens on :50053).

**Core → Backend (reverse gRPC):** Core calls *back* to the backend via a separate gRPC server (backend listens on :50054) to persist data (create messages, update conversations, sync sandbox status). This is the "reverse RPC" pattern — proto files named `reverse_rpc.proto` in each domain define these callbacks.

**Chat uses SSE:** The `/conversation/chat` endpoint streams responses to the frontend via Server-Sent Events (SSE).

### Backend Structure (Go — `backend/`)

Follows a layered architecture with Wire-based DI:

- **`cmd/sico-server/`** — Entry point. Runs DB migrations on startup, starts Gin HTTP server + reverse gRPC server.
- **`internal/transport/`** — HTTP handlers (`http/handler/`), middleware (`http/middleware/`), HTTP DTOs (`http/dto/`), gRPC clients (`grpc/`), reverse gRPC server (`reverse_grpc/`), and the Gin router (`router/`).
- **`internal/biz/<domain>/`** — Business logic. Each domain (agent, conversation, sandbox, knowledge, skill, project, rbac, llmhubs) has a `Service` interface at the package root, an `init.go` with Wire `ProviderSet`, and an `impl/` subdirectory with the implementation.
- **`internal/store/<domain>/`** — Repository layer (GORM-based MySQL access).
- **`internal/entity/`** — Domain entity structs.
- **`internal/infra/`** — Infrastructure: MySQL connection, Redis cache, migrations, cron, email, ID generation (snowflake), object storage, core gRPC client.
- **`internal/shared/`** — Cross-cutting: error codes, constants, enums, types.
- **`pkg/`** — Reusable packages: env loading (godotenv), crypto, eventbus (Kafka), JWT, logger, SSE, json utilities.
- **`configs/migrations/`** — SQL migration files (golang-migrate, numbered `NNNNNN_name.{up,down}.sql`).

Key patterns:
- Each biz domain exposes a singleton via `Default()` / `SetDefault()` — initialized by Wire at startup.
- HTTP DTOs are generated from protobuf via `gen.sh backend-http`, then annotated with `protoc-go-inject-tag`.
- Auth uses JWT with Casbin for RBAC policy enforcement. Sandbox client endpoints use a separate HMAC-based auth middleware (`X-Sico-*` headers).

### Core Structure (Python — `core/`)

- **`app/main.py`** — Async gRPC server entry point.
- **`app/biz/chat/`** — Chat orchestration: multi-turn conversation, tool calling, prompt construction, plan execution.
- **`app/biz/llm/`** — LLM service layer.
- **`app/biz/reverse_grpc/`** — Reverse gRPC client stubs that call back to the backend.
- **`app/tools/`** — Agent tool implementations (read, write, grep, web_search, run_python, etc.).
- **`app/llmhubs/`** — LLM provider abstraction layer with adapter pattern for multiple providers.
- **`app/schemas/`** — Pydantic models for chat, conversation.
- **`app/pb/`** — Auto-generated protobuf/betterproto2 stubs (do not edit manually).
- **`app/utils/`** — Shared utilities: Redis, caching, eventbus, response builders.

### Sandbox System

The sandbox subsystem manages isolated environments (Android emulators, AIO containers) for agent tool execution. Sandboxes are pooled and leased to agent instances. The `sandbox/emulator/` directory contains the Android emulator sandbox implementation (Python).

### Proto Domains

Proto definitions are organized by domain in `proto/`: agent, chat, common, conversation, knowledge, llmhubs, project, rbac, sandbox, skill. Each domain may have `rpc.proto` (backend↔core gRPC), `reverse_rpc.proto` (core→backend callbacks), and `restful.proto` (HTTP DTO definitions).

## Code Style

### Source file headers

- Every source/config file (`.go`, `.py`, `.proto`, `.yaml`, shell scripts, etc.) must start with the standard 19-line MIT header from `LICENSE` (`# Copyright (c) 2026 Sico Authors` for `#`-style languages, `// Copyright (c) 2026 Sico Authors` for `//`-style languages).
- The `addlicense` pre-commit hook (`.pre-commit-config.yaml`) inserts/refreshes the header automatically — run `pre-commit run addlicense --all-files` (or `pre-commit run --files <new-file>`) before committing new files.

### Go function signatures

Wrapping rules (apply mechanically):

- **One line** if the signature has ≤2 parameters AND fits within 130 columns.
- **Otherwise** put each parameter on its own line, with the closing `)` and return type on a line by themselves.
- Never pack multiple parameters onto a single wrapped line.
- Group related params of the same type using Go's shorthand: `instanceID, sandboxID string`.

```go
// One-liner — short enough.
func (s *Service) GetUser(ctx context.Context, id int64) (*User, error)

// Wrapped — 3+ params.
func (s *Service) validateUpdateUserEmail(
    ctx context.Context,
    req *user.UpdateUserRequest,
    existingUser *rolerepo.UserModel,
) error
```

## Environment Variables

Configured via `.env` (copied from `.env.example`). Key variables:
- `DB_*` — MySQL connection
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` — Redis
- `CORE_GRPC_ADDRESS` — Address where core listens (default `core:50053`)
- `REVERSE_GRPC_SERVE_ADDRESS` — Address where backend's reverse gRPC server listens (default `:50054`)
- `SANDBOX_CLIENT_SECRET_<CLIENT_ID>` — Per-client HMAC secrets for sandbox auth (CLIENT_ID uppercased, hyphens → underscores)
