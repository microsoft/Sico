# Development

This guide covers working on Sico itself: building from source, running tests, regenerating protobuf stubs, and the conventions each service follows.

For user-facing setup, see [Quick Start](quickstart.md). For contribution
workflow, issue reporting, PR expectations, and commit style, see
[CONTRIBUTING.md](../CONTRIBUTING.md).

## One-command toolchain install

```bash
make setup
```

This installs the default contributor toolchain: Go, Python (and `uv`), Node.js,
`pnpm`, `pre-commit`, `addlicense`, and `golangci-lint`, then registers the git
pre-commit hook. The command dispatches to the right platform installer:

- macOS / Linux: `scripts/install-dev-tools.sh` (uses brew, apt, dnf, or pacman)
- Windows: `scripts/install-dev-tools.ps1` (uses winget or choco)

If you do not have `make` on Windows yet, run the installer directly:

```powershell
.\scripts\install-dev-tools.ps1
```

If you work on Kind deployment or Helm charts, install the optional Kind toolchain (Helm, `kubectl`, and `kind`) with:

```bash
make setup-kind
```

Verify the default toolchain without installing anything:

```bash
make setup-check
```

Both installer scripts are idempotent, so rerunning them is safe.

## Useful Make targets

| Target | What it does |
| --- | --- |
| `make setup` | Install toolchain + git hooks |
| `make setup-check` | Check the default toolchain is installed |
| `make setup-kind` | Install the default toolchain plus Helm, `kubectl`, and `kind` |
| `make setup-kind-check` | Check the Kind toolchain (Helm + `kubectl` + `kind`) is installed |
| `make lint` | Run `golangci-lint`, `ruff`, and `eslint` |
| `make lint-fix` | Same as `make lint` but apply auto-fixes |
| `make license-check` | Verify every source file has an MIT header |
| `make precommit-run` | Run all pre-commit hooks against the whole tree |
| `make precommit-update` | Bump pinned hook versions |
| `make openapi` | Regenerate Backend OpenAPI docs (`api/openapi/`) |
| `make build-frontend` | Install deps and build the frontend SPA (`packages/app/dist`) |
| `make compose-up` / `compose-down` / `compose-logs` | Docker Compose stack |
| `make kind-up` / `kind-down` | Local Kubernetes stack |
| `make help` | List all targets |

If you prefer running tools directly, these targets wrap standard commands; see
the root [Makefile](../Makefile) for exact invocations.

## Local validation

Run the smallest check set that covers your change before opening a PR:

| Area changed | Recommended validation |
| --- | --- |
| Any source, config, or generated artifact | `make precommit-run` |
| Backend code, migrations, protobuf, or OpenAPI | `cd backend && go test ./...` |
| Backend build-sensitive changes | `cd backend && go build ./...` |
| Core code, tools, prompts, or protobuf | `cd core && uv run pytest` |
| Core lint-sensitive changes | `cd core && uv run ruff check .` |
| Frontend (`frontend/packages/*`) | `cd frontend && pnpm build && pnpm lint` |
| Deployment, Helm, or Kind changes | `make setup-kind-check` and the relevant `make kind-*` flow |

If a relevant check cannot be run locally, mention that in the PR and explain
why.

## Backend (Go)

```bash
cd backend
go build ./cmd/sico-server             # build binary
go test ./...                          # run all tests
go test ./internal/biz/sandbox/impl/...# run a single package
go test -run TestFoo ./internal/biz/...# run a single test
```

Dependencies are wired with Google Wire. After editing any `wire.go` file:

```bash
cd backend/internal/di && wire
```

### Database migrations

Migrations live under `backend/configs/migrations/` and follow the golang-migrate format (`NNNNNN_name.up.sql` / `NNNNNN_name.down.sql`). They are applied automatically on server startup.

### OpenAPI

Backend handlers use `swag` annotations. Regenerate with:

```bash
make openapi
```

## Core (Python)

Python 3.13+, managed with [uv](https://docs.astral.sh/uv/):

```bash
cd core
uv sync                                # install deps (uses pyproject.toml + uv.lock)
uv run pytest                          # full test suite
uv run pytest tests/chat/              # subset
uv run ruff check .                    # lint
uv run ruff format .                   # format
```

> Do **not** use `pip` or edit `requirements.txt`; `uv` is the source of truth.

## Frontend (TypeScript / React)

The frontend is a pnpm + Turborepo monorepo under `frontend/` (`packages/app` is
the Vite SPA; `packages/ui`, `packages/shared`, and `packages/config` are shared
libraries). Node is pinned to 24.13.0 (`frontend/.nvmrc`) and pnpm to 10.12.1
(`packageManager`, activated via corepack).

```bash
cd frontend
pnpm install --frozen-lockfile         # install from the committed lockfile
pnpm build                             # turbo build → packages/app/dist
pnpm dev                               # vite dev server (proxies /api → :8080)
pnpm lint                              # turbo lint
pnpm test                              # turbo test (vitest)
```

The production image builds the SPA from source with a multi-stage Dockerfile
(`frontend/deployments/docker/Dockerfile`) and serves `packages/app/dist` with
nginx; `make compose-up` and `make kind-up` do this automatically. `make
build-frontend` runs the install + build locally for a quick check.

## Protobuf code generation

All `.proto` files live in `proto/`. Generation is orchestrated by `proto/gen.sh`:

```bash
cd proto
bash gen.sh                        # run all targets
bash gen.sh backend-grpc           # Go gRPC stubs
bash gen.sh backend-http           # Go HTTP DTOs (+ protoc-go-inject-tag)
bash gen.sh backend-reverse        # Go reverse gRPC stubs
bash gen.sh core                   # Python betterproto2 stubs
```

Proto generation currently uses `protoc` + `protoc-go-inject-tag` for Go and `betterproto2` for Core Python.

### Proto domain layout

Each domain under `proto/<name>/` can contain:

- `rpc.proto`: Backend ↔ Core gRPC service.
- `reverse_rpc.proto`: Core → Backend callbacks.
- `restful.proto`: HTTP DTO definitions for the Backend.
- Regular messages used by the above.

## License headers

Every new source file (Go, Python, TypeScript, JavaScript, proto, shell, YAML, Dockerfile, …) must carry the MIT header. The pre-commit hook adds it automatically.

Generated files are excluded in `.pre-commit-config.yaml` (`*.pb.go`, `*_pb2.py`, `wire_gen.go`, `zz_otelwrap_gen.go`, `backend/api/openapi/**`, GORM `model`/`dal`/`query` dirs, `core/app/pb/**`, ambient `*.d.ts`, …). If you add a new generator, extend the ignore list so generated output is not rewritten by source-file hooks.

## Documentation ownership

- [README.md](../README.md) explains what Sico is and gives the shortest path
  to running it.
- [quickstart.md](quickstart.md) is the user-facing local setup guide.
- This file is the developer reference for contributors and maintainers.
- [CONTRIBUTING.md](../CONTRIBUTING.md) is the GitHub-facing contribution
  policy and pull request entry point.

When a command or convention changes, update the most specific canonical page
first, then keep higher-level pages as short pointers.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `wire` command not found | `go install github.com/google/wire/cmd/wire@latest` |
| `swag` not found when running `make openapi` | `go install github.com/swaggo/swag/cmd/swag@latest` |
| `uv` not installed | `make setup` or follow https://docs.astral.sh/uv/ |
| Pre-commit fails on generated files | Check the ignore list in `.pre-commit-config.yaml` |
| Reverse gRPC callbacks don't land | Ensure `REVERSE_GRPC_SERVE_ADDRESS` in Backend and `REVERSE_GRPC_ADDRESS` in Core both point at reachable hosts |
