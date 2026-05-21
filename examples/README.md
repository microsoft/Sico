# Examples

This directory is the runnable workflow entrypoint for Sico.

## Scope

Examples here should demonstrate end-to-end usage patterns that are hard to infer
from raw API docs alone, such as:

- bootstrapping auth and JWT usage
- model runtime invocation and model-registry workflows
- streaming conversation flows
- project asset -> knowledge / skill pipelines
- sandbox HMAC request signing and lease lifecycle

Static config templates belong under `deploy/config/`. Copy-paste request bodies
that are primarily documentation assets belong in the relevant docs.

## Runtime conventions

- Prefer `python3 -m examples.<group>.<script>` from the repository root.
- Examples use only the Python standard library.
- When a repo-root `.env` file exists, examples auto-load it without overriding
  variables you already exported in the current shell.
- Most examples read `BASE_URL` and `TOKEN` from the environment.
- Authentication/bootstrap examples print the values you need for follow-up runs.

## Groups

- `auth/`: create a user, login, refresh tokens, and verify authenticated calls
- `llmhubs/`: runtime invocation and model lifecycle workflows
- `conversation/`: SSE chat and reconnect flows
- `knowledge/`: asset and document ingestion workflows
- `skills/`: skill asset registration flows
- `sandbox/`: HMAC-signed sandbox client flows

Each group should include its own README with prerequisites, required
environment variables, and cleanup notes.