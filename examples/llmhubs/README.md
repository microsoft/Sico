# LLMHub Examples

This group is the runnable companion to [backend/docs/llmhub.md](../../backend/docs/llmhub.md).

## Layout

- `python3 -m examples.llmhubs.examples <name>`: runnable Python scenarios
- `config/`: reusable model-config examples that should not be auto-loaded as builtin models
- `requests/`: model-registry request bodies that are useful as API inputs, not as runtime docs

## Environment

- `BASE_URL`: defaults to `http://localhost:8080`
- `TOKEN`: required

For copy-paste runtime request bodies, prefer
`GET /api/sico/llm/sdk-examples`, which is sourced from the backend docs asset.