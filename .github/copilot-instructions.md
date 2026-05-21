## Repository overview

Sico is a multi-service AI agent platform:
- `backend/` — Go (Gin + GORM + Wire DI), HTTP APIs and persistence
- `core/` — Python 3.13 (asyncio + betterproto2), LLM/chat orchestration
- `frontend/` — packaged/deployment assets only in this public checkout; React source is provided separately
- `sandbox/emulator/` — Android emulator sandbox (Python)

Backend ↔ Core communicate via gRPC (`:50053`). Core calls back to the backend via a **reverse gRPC** server the backend exposes on `:50054` (proto files named `reverse_rpc.proto`).

See `CLAUDE.md` for the full architecture and coding-style reference.

## Backend (Go) guidelines

- **Do not edit generated files:**
  - `backend/internal/transport/grpc/pb/` — gRPC stubs
  - `backend/internal/transport/reverse_grpc/pb/` — reverse gRPC stubs
  - `backend/internal/transport/http/dto/` — HTTP DTOs (then annotated by `protoc-go-inject-tag`)
  - `backend/internal/di/wire_gen.go` — Wire-generated
- **Regenerate proto** from `proto/` using `bash gen.sh` (or specific targets: `backend-grpc`, `backend-http`, `backend-reverse`, `core`). On Windows use Git Bash.
- **Regenerate Wire** after editing `wire.go`: `cd backend/internal/di && wire`.
- **DB migrations** live at `backend/configs/migrations/NNNNNN_name.{up,down}.sql` (`golang-migrate` format). The server auto-runs migrations on startup.
- **Layered architecture:** `transport/` → `biz/<domain>/` → `store/<domain>/` → `infra/`. Each biz domain has `Service` interface at root, `impl/` subdir, and a Wire `ProviderSet` in `init.go`.
- **Function-signature wrapping** (mechanical): one line if ≤2 params AND ≤130 cols; otherwise each param on its own line with `)` and return type on their own lines. Group same-type params as `a, b string`. See `CLAUDE.md § Code Style`.

## Core (Python) guidelines

- Python **≥3.13**, dependency management via `uv` (not pip): `cd core && uv sync`.
- **Do not edit** `core/app/pb/` — regenerate via `bash gen.sh core` under `proto/`.
- Use **betterproto2** for protobuf code.
- Lint/format with `ruff` (`uv run ruff check .`, `uv run ruff format .`). Line length is **130**.

## Frontend guidelines

- Frontend source code is currently not published in this repository. In the public checkout, `frontend/package.json` does not exist; `frontend/` contains packaged/deployment assets only.
- Only run frontend `pnpm` commands from a separate frontend source checkout that includes `frontend/package.json`.

## Proto guidelines

- All `.proto` files live under `proto/`, organized by domain (`agent/`, `chat/`, `conversation/`, `sandbox/`, `rbac/`, `llmhubs/`, …).
- Per domain you may see: `rpc.proto` (backend↔core), `reverse_rpc.proto` (core→backend callback), `restful.proto` (HTTP DTO).
- After editing any `.proto`, run `bash gen.sh` in `proto/` and commit the regenerated files.

## Validation after changes

Always run the appropriate subset before claiming a change is complete:

1. **Lint**: `./scripts/lint.sh` (or `--backend` / `--core`).
2. **Backend tests**: `cd backend && go test ./...`.
3. **Backend build**: `cd backend && go build ./...`.
4. **Core tests**: `cd core && uv run pytest`.
5. **Frontend build/lint** when frontend source changed and `frontend/package.json` exists: `cd frontend && pnpm build && pnpm lint`.

## Authentication & security notes

- User/admin HTTP APIs use **JWT + Casbin** RBAC.
- Sandbox client endpoints use a separate **HMAC** middleware reading `X-Sico-*` headers; per-client secrets come from env var `SANDBOX_CLIENT_SECRET_<CLIENT_ID>` (CLIENT_ID uppercased, `-` → `_`).
- When handling secrets, use constant-time comparisons (`hmac.Equal` / `crypto/subtle`). Never log secrets or tokens.
