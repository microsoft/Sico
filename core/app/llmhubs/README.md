# LLMHub Builtins

Builtin model descriptors are loaded by `ModelConfigLoader` from the Core-side config directory. Reusable authoring templates live under `deploy/config/llmhubs`.

## YAML Schema

Fields for V2 builtin descriptors (mirrors proto `ModelRegistryEntry`):

```yaml
model_key: gpt5.4
display_name: GPT-5.4
description: Azure OpenAI text model.
model_type: text                     # text | multimodal | artifact  (or int 1-3)
provider_template_type: azure_openai # azure_openai | openai_compatible | http_json | http_binary | anthropic | gemini  (or int 1-7)
icon_uri: ""                         # optional icon URL
config:
  deployment_name: gpt-5.4
  endpoint: https://example.openai.azure.com/
  api_version: preview
  timeout_ms: 60000
io_profile:                          # optional; auto-derived from model_type if absent
  input_types: [text]
  output_types: [text]
  supports_tools: false
  supports_previous_response_id: false
  supports_structured_output: false
```

Notes:

- `model_type` is the runtime capability classification, not the vendor/model family.
- `provider_template_type` chooses the adapter implementation (same name as the proto field).
- `io_profile` is optional. If omitted, the loader derives a sensible default from `model_type`.
- The global default model is set via `DEFAULT_MODEL_KEY` in `hub.py` (or env `CORE_DEFAULT_MODEL_KEY` / `CORE_DEFAULT_LLM_MODEL`).

## OpenRouter via OpenAI-Compatible

OpenRouter should be configured with `provider_template_type: openai_compatible`, not as a separate provider template.

Example:

```yaml
model_key: openrouter-claude-sonnet-4
display_name: OpenRouter Claude Sonnet 4
model_type: text
provider_template_type: openai_compatible
config:
  base_url: https://openrouter.ai/api/v1
  upstream_model_name: anthropic/claude-sonnet-4
  site_url: https://example.com
  app_name: Sico
  timeout_ms: 60000
  max_tokens: 4096
```

When `base_url` points at OpenRouter, the adapter keeps the normal OpenAI-compatible wire format and additionally auto-allows common OpenRouter Chat Completions fields from `request.options`, including `models`, `route`, `provider`, `plugins`, `top_k`, `min_p`, `top_a`, `repetition_penalty`, `metadata`, `session_id`, `trace`, and `verbosity`.

For other OpenAI-compatible backends, provider-specific passthrough stays opt-in through `passthrough_options`, `chat_completions_passthrough_options`, and `responses_passthrough_options` in model config.
Passthrough only fills fields that the adapter has not already populated, so it cannot override core request body fields such as `model`, `messages`, `tools`, `input`, or `instructions`.

A reusable example file is available at `examples/llmhubs/config/openrouter-claude-sonnet-4.yaml`.

For dynamic registration through the backend model registry API, see `examples/llmhubs/requests/register_openrouter_model.json` and the runnable `openrouter_lifecycle` example in `examples/llmhubs/examples.py`.

OpenRouter Responses API is also supported, but it stays opt-in. Set `use_responses_api: true` on the model config when you want the adapter to target `/responses` instead of `/chat/completions`. In that mode, the adapter auto-allows common OpenRouter/OpenAI Responses fields such as `metadata`, `store`, `verbosity`, `provider`, `route`, and `models`.
When `site_url` or `app_name` is used to auto-inject OpenRouter attribution headers, configured `default_headers` are respected with case-insensitive header-name matching.

## Runtime Generate Example

Endpoint:

`POST /api/sico/llm/runtime/generate`

### curl

```bash
curl -X POST "$BASE_URL/api/sico/llm/runtime/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt5.4",
    "instructions": "You are a concise assistant.",
    "inputs": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "Explain what LLMHub does in one sentence."}
        ]
      }
    ],
    "options": {
      "temperature": 0.2,
      "max_output_tokens": 256
    }
  }'
```

### Python

```python
import json
import os
from urllib import request

base_url = os.environ["BASE_URL"].rstrip("/")
token = os.environ["TOKEN"]

payload = {
    "model": "gpt5.4",
    "instructions": "You are a concise assistant.",
    "inputs": [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Explain what LLMHub does in one sentence."}
            ],
        }
    ],
    "options": {"temperature": 0.2, "max_output_tokens": 256},
}

req = request.Request(
    f"{base_url}/api/sico/llm/runtime/generate",
    data=json.dumps(payload).encode("utf-8"),
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    },
    method="POST",
)

with request.urlopen(req, timeout=60) as resp:
    print(json.dumps(json.loads(resp.read().decode("utf-8")), ensure_ascii=False, indent=2))
```

## Example Files

For copy-paste examples, see:

- `GET /api/sico/llm/sdk-examples` (source: `backend/internal/transport/http/handler/assets/llmhub_sdk_examples.md`)
- `examples/llmhubs/README.md`
- `examples/llmhubs/examples.py`