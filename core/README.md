# Sico Core

The Core service is the Python side of Sico. It runs the agent loop, orchestrates tool execution, talks to LLM providers through the LLM Hub, and calls back into the Backend (via reverse gRPC) to persist state.

> See the top-level [README](../README.md) for the platform overview and [docs/technical_report.md](../docs/technical_report.md) for how Core fits into the system.

## Layout

```
core/
├── app/
│   ├── main.py              # async gRPC server entrypoint
│   ├── biz/
│   │   ├── chat/            # chat orchestration, planning, tool calling
│   │   ├── llm/             # LLM service layer
│   │   └── reverse_grpc/    # client stubs that call back to Backend
│   ├── tools/               # agent tools (read/write/grep/web_search/run_python/...)
│   ├── llmhubs/             # provider adapters (OpenAI, Azure, Anthropic, Gemini, ...)
│   ├── schemas/             # Pydantic request/response models
│   ├── pb/                  # generated betterproto2 stubs (do not edit)
│   ├── memory/              # memory subsystem
│   ├── document/            # document parsing / chunking
│   └── utils/               # redis, caching, eventbus, response builders
└── tests/
	├── chat/                # tests for app.biz.chat
	├── llmhubs/             # tests for app.llmhubs and adapters
	├── sandbox_tools/       # tests for app.tools.sandbox_tools
	└── storage/             # tests for app.storage
```

## Test Layout

- Organize tests by the owning module or domain under `tests/`; avoid mixing flat root-level test files with per-domain folders.
- Keep `tests/` root for shared pytest config such as `conftest.py`, or for future cross-domain integration tests.
- Put domain-only helpers in that domain's `conftest.py`; only truly cross-domain fixtures should live at the root.
- Name files after the behavior or unit under test, such as `tests/llmhubs/test_timeout.py`.

## Requirements

- Python **3.13+**
- [uv](https://docs.astral.sh/uv/) for dependency management (`pyproject.toml` + `uv.lock`)

## Develop

```bash
cd core
uv sync
uv run python -m app.main          # start the gRPC server (requires env vars / backend)
uv run pytest                      # run tests
uv run pytest tests/chat/          # run a subset
uv run ruff check .                # lint
uv run ruff format .               # format
```

Regenerate protobuf stubs from the repo root:

```bash
bash proto/gen.sh core
```

## Configuration

Core does not own persistent state. It expects:

- A reachable Backend for reverse gRPC callbacks (`REVERSE_GRPC_ADDRESS`).
- LLM provider credentials resolved through the LLM Hub (see [backend/docs/llmhub.md](../backend/docs/llmhub.md)).

For the complete environment model, see [`.env.example`](../.env.example) at the repo root.

## More

- [Docs home](../docs/README.md)
- [LLM Hub builtin YAML models](app/llmhubs/README.md)
- [Contributing](../CONTRIBUTING.md)
