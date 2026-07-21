# Quick Start

This guide walks you through running Sico locally. Two paths are supported:

- **Docker Compose**: fastest path, runs everything in containers.
- **Kind + Helm**: local Kubernetes, closer to production.

For a developer setup (building services from source, writing code, running tests) see [Development](development.md).

## Prerequisites

| Tool | Needed for | Notes |
| --- | --- | --- |
| Docker & Docker Compose | Both paths | Docker Desktop on macOS / Windows, or native Docker on Linux |
| `make` | Both paths | macOS/Linux native; on Windows, install or run scripts directly |
| [`kind`](https://kind.sigs.k8s.io/) | Kubernetes path | |
| [`helm`](https://helm.sh/) | Kubernetes path | |
| `kubectl` | Kubernetes path | |
| An LLM API key | Running agents | OpenAI / Azure OpenAI / Anthropic / Gemini / OpenRouter |

## 1. Configure the environment

```bash
git clone https://github.com/microsoft/Sico.git
cd Sico
cp .env.example .env
```

Edit `.env`:

- Set `DB_PASSWORD`, `REDIS_PASSWORD`, and other secrets (the defaults are only safe for quick local use).
- Keep `APP_ENV=development` for verbose logs locally.

### LLM provider configuration

Before starting the stack, configure at least one LLM model. Create a YAML file under
`deploy/config/llmhubs/<your-model>.yaml` (use [`deploy/config/llmhubs/model-template.yaml`](../deploy/config/llmhubs/model-template.yaml)
or one of the `*-template.yaml` files as a starting point) and make sure it contains:

```yaml
default: true                   # mark this model as the default for the platform
```

Sico also supports dynamically registering models via the Model Registry API
(`POST /api/sico/llm/models`). See [LLM Hub docs](../backend/docs/llmhub.md) for the schema and examples,
[../examples/README.md](../examples/README.md) for the examples index, and
[../examples/llmhubs/README.md](../examples/llmhubs/README.md) for runnable llmhubs samples.

### Mem0 configuration

Configure Mem0 for long-term memory:

```bash
cp deploy/config/mem0/mem0_config_template.yaml deploy/config/mem0/mem0_config.yaml
# then edit deploy/config/mem0/mem0_config.yaml to fill in embedder / llm credentials
```

### Sandbox client auth (optional)

If you plan to hit sandbox-client endpoints locally, set per-client HMAC secrets in `.env`:

```env
SANDBOX_CLIENT_SECRET_TEST_CLIENT=change-me-local-secret
```

This matches the default `clientId` (`test-client`) used by `examples/sandbox/apply_and_release.py`. For a custom client ID, derive the variable name by uppercasing it and replacing `-` with `_`, for example `my-client` -> `SANDBOX_CLIENT_SECRET_MY_CLIENT`.

Nonce replay protection is stored in Redis, so `REDIS_HOST` must be reachable.
The default Docker Compose backend now forwards `SANDBOX_CLIENT_SECRET_TEST_CLIENT`
from the repo-root `.env`, so copying `.env.example` to `.env` is enough for the
default `test-client` example path.

### Android emulator sandbox (optional)

If you plan to collaborate with the Android Tester, you will need the Android emulator sandbox. 

Install [MuMu Player](https://www.mumuplayer.com/)
(Windows) or set up the Android SDK / AVD (macOS) and start the emulator API service **before**
bringing up the stack. The emulator runs on a GUI host and cannot be containerized.

```bash
# Install prerequisites and start the API service.
make emulator-setup

# Verify the API service is running.
make emulator-status

# Bootstrap the default emulator device.
make emulator-bootstrap
```

If the API service is already running but `make emulator-bootstrap` reports a missing Java runtime or AVD, rerun
`make emulator-setup`, then retry `make emulator-bootstrap` so the host Java/SDK/AVD prerequisites are repaired before
bootstrap.

Set `SANDBOX_EMULATOR_BASE_URL` in `.env` so the Backend can reach it. For local
compose/kind it is pre-set to `http://host.docker.internal:8000`.

See [sandbox/emulator/setup/README.md](../sandbox/emulator/setup/README.md) for
host setup and lifecycle management. The lower-level service API is documented
in [sandbox/emulator/README.md](../sandbox/emulator/README.md).

## 2a. Run with Docker Compose

```bash
make compose-up       # build images and start the full stack
```

After changing service code or local config (`.env`, `deploy/config/`) while the compose stack is running, run `make compose-up` again. If only one service's code or image-scoped config changed, use `make compose-up SERVICE=core` or `make compose-up SERVICE=backend`.

This starts:

| Service | Purpose |
| --- | --- |
| **nginx** | Reverse proxy at http://localhost:8080 |
| **backend** | Go service: HTTP `:8080`, reverse gRPC `:50054` |
| **core** | Python service: gRPC `:50053` |
| **mysql** | Database |
| **redis** | Cache, locks, blacklist |

```bash
make compose-logs     # tail logs from all services
make compose-down     # stop and remove containers
```

The compose stack builds and runs nginx, backend, core, the frontend SPA (built from source in `frontend/`), and the supporting infrastructure services they depend on.

### Minimal sandbox example path

Once the compose stack is up, the shortest sandbox example flow is:

```bash
python3 -m examples.sandbox.apply_and_release
```

The default example uses `SANDBOX_CLIENT_ID=test-client` and `AGENT_INSTANCE_ID=2`.
It can only lease sandboxes that have already been assigned to that instance, so
make sure at least one `emulator` sandbox is assigned to the seeded tester
instance (`2`) before running the example.

If the script prints `No sandbox was allocated. Nothing to release.`, the auth
path is working but no matching sandbox is currently assigned or available for
that instance.

## 2b. Run with Kind

```bash
make kind-up
```

This does the following:

1. Starts a local Docker registry on port `5000`.
2. Creates or reuses a Kind cluster named `sico`.
3. Builds and loads app images for Backend, Core, and Frontend.
4. Creates local credentials and applies infrastructure manifests.
5. Deploys app services via local Helm charts.
6. Port-forwards the local stack to http://localhost:8080.

After changing the Kind stack while it is running, run `make kind-up` again. If only one app service's code or image changed, use `make kind-restart SVC=core` or `make kind-restart SVC=backend`.

Stop the cluster without deleting data:

```bash
make kind-stop
```

Tear down and delete local cluster data:

```bash
make kind-down
```

## 3. Run the frontend (optional)

The Docker Compose and Kind stacks already build and serve the frontend SPA from
source (`frontend/`), so the UI works with no extra step. To iterate on the
frontend with hot-reload against a running backend:

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm dev            # vite dev server; proxies /api/sico and /storage to :8080
```

For API service lifecycle management (`make emulator-start` / `make emulator-status` /
`make emulator-logs`) and explicit device bootstrap (`make emulator-bootstrap`), see
[sandbox/emulator/setup/README.md](../sandbox/emulator/setup/README.md).

## 4. Verify the stack

Once the stack is up, try:

```bash
# Home
open http://localhost:8080/

# UI login
open http://localhost:8080/login

# Developer interface
open http://localhost:8080/developer

# Swagger / OpenAPI (Backend)
open http://localhost:8080/api/sico/docs/index.html

# Health probe (Backend)
curl http://localhost:8080/api/sico/health

# Health probe (Core)
# Core is internal, but the Backend exposes an aggregated health view.
```

Sign in with the seeded default account (local development only — rotate or remove before exposing the stack outside your machine):

- **Username**: `operator@sico.local`
- **Password**: `operator`

## 5. Create a new DW type (via the dev HTTP API)

In Sico a Digital Worker (DW) has two layers:

- **Role** — a fixed enum (`Assistant`, `Android Tester`, `3D Artist`, `Product Manager`, `Marketing`) defined in [`backend/internal/shared/enum/agent_roles.go`](../backend/internal/shared/enum/agent_roles.go). New roles require editing this enum and rebuilding the backend; they cannot be added at runtime.
- **Skill** — a plug-in capability package (`SKILL.md` + scripts/code). Skills *can* be added at runtime through the HTTP API and are what actually decide how a DW behaves.

So "creating a new DW type" in practice means: **author a Skill, then create a SingleAgent (the DW) and attach the skill to it.**

### APIs used

| # | Method + Path | Purpose |
| --- | --- | --- |
| 1 | `POST /api/sico/rbac/login` | Get a JWT. |
| 2 | `POST /api/sico/project/asset` (multipart) | Upload the skill zip; returns `assetId`. |
| 3 | `POST /api/sico/agent/single_agent` | Create the DW (SingleAgent) with a valid `role`. Returns `agentId`. |
| 4 | `POST /api/sico/skills` | Register the uploaded asset as a skill **scoped to the new `agentId`**. *Note:* `projectId` and `agentId` are mutually exclusive — send exactly one. |
| 5 | `POST /api/sico/agent/single_agent/deploy` | Create a runnable instance of the DW for the current user. |

Helpful read-only endpoints:

- `GET /api/sico/agent/roles` — list valid role values.
- `GET /api/sico/agent/single_agents?page=1&pageSize=50` — list existing DWs (max page size 50).

### Step-by-step

1. **Write a Skill package.** Minimum required content is a single `SKILL.md` with YAML frontmatter at the root of a directory:

   ```markdown
   ---
   name: web-researcher
   description: Research a topic on the public web and produce a structured brief.
   argument-hint: Describe the topic to research and the desired depth.
   ---

   # Web Researcher Skill

   ## When to use
   - The user asks for a structured research brief on a public topic.

   ## Workflow
   1. Clarify scope.
   2. Search with `web_search` (or any available browsing tool).
   3. Synthesize: TL;DR + key facts + open questions + source list.
   4. Deliver in Markdown.
   ```

   Reference layout: [`backend/internal/embeddata/skills/android-tester/`](../backend/internal/embeddata/skills/android-tester/).

2. **Login and grab a JWT.**

   ```bash
   curl -s -X POST http://localhost:8080/api/sico/rbac/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"operator@sico.local","password":"operator"}'
   # -> data.tokenInfo.accessToken
   ```

3. **Upload the skill as a project asset.** Zip the skill directory and POST it as multipart:

   ```bash
   curl -s -X POST http://localhost:8080/api/sico/project/asset \
     -H "Authorization: Bearer $TOKEN" \
     -F project_id=1 \
     -F 'file=@web-researcher.zip;type=application/zip'
   # -> data.id  (the assetId)
   ```

4. **Create the DW.** Pick a role from `GET /api/sico/agent/roles`; `Assistant` is the safe default for new skills.

   ```bash
   curl -s -X POST http://localhost:8080/api/sico/agent/single_agent \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"name":"My Web Researcher","desc":"...","role":"Assistant"}'
   # -> data.agentId
   ```

   The name has a per-creator UNIQUE index that ignores soft-delete, so reusing a previously-deleted name will collide — add a suffix or hard-delete the old row first.

5. **Attach the skill to the DW.** Send exactly one of `projectId` / `agentId`; for a DW-specific skill, send `agentId`:

   ```bash
   curl -s -X POST http://localhost:8080/api/sico/skills \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d "{\"agentId\":\"$AGENT_ID\",\"assetId\":$ASSET_ID}"
   # -> data.skill.status == 2 (SKILL_STATUS_UPLOADED)
   ```

6. **Deploy a runnable instance for the current user.**

   ```bash
   curl -s -X POST http://localhost:8080/api/sico/agent/single_agent/deploy \
     -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d "{\"agentId\":\"$AGENT_ID\",\"name\":\"My Web Researcher\"}"
   # -> data.id (instance id), data.employerUsername
   ```

After step 6 the new DW type is usable end-to-end — start a conversation with it via `POST /api/sico/conversation` and stream replies via `POST /api/sico/conversation/chat` (SSE), targeting the returned `agentId` / instance.

### Runnable example

The repo ships a stdlib-only Python script that performs steps 1–6 against a local stack (defaults to `http://localhost:8080`, account `operator@sico.local / operator`, builds a tiny `web-researcher` skill in memory):

```bash
python examples/agent/create_dw_type.py
```

Useful environment overrides: `BASE_URL`, `SICO_EMAIL`, `SICO_PASSWORD`, `PROJECT_ID`, `DW_TYPE_NAME`, `DW_TYPE_ROLE`, `SKILL_NAME`, `SKILL_DESC`, `SKILL_DIR` (point at an existing skill directory to upload that instead of the inline demo). See [`examples/agent/create_dw_type.py`](../examples/agent/create_dw_type.py).

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `make compose-up` fails on first run | `.env` is missing or has a bad variable; run `cp .env.example .env` |
| A service stays unhealthy after an upgrade (e.g. `container sico-backend is unhealthy`) | Local Docker volumes hold stale state from a previous version. Reset them and rebuild: `make compose-down-volumes` (⚠️ wipes local MySQL/SeaweedFS/Kafka/Qdrant data), then `make compose-up`. |
| Frontend loads but API calls 401 | No user created yet; register through the UI or call the RBAC API |
| Core cannot reach an LLM provider | Secrets not configured in the Model Registry for that `model_key` |
| Sandbox endpoints return 401 with valid HMAC | Clock skew, missing nonce, or `SANDBOX_CLIENT_SECRET_*` mismatch |
| Android sandbox calls fail from containers | `SANDBOX_EMULATOR_BASE_URL` points at an unreachable host |
| Digital Tester shows no device (e.g., no device label in the top-right corner) | The backend has not picked up an available sandbox device. First confirm the [Android emulator sandbox (optional)](#android-emulator-sandbox-optional) setup steps are completed, then restart the stack: `make compose-down` followed by `make compose-up`. |

## Next steps

- Understand what Sico is: [Overview](overview.md)
- Understand the moving parts: [Technical Report](technical_report.md)
- Build from source, run tests, regenerate code: [Development](development.md)
