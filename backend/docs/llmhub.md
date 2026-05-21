# LLMHub

LLMHub is the unified model runtime for Sico. It replaces the V1 strategy-per-provider approach with a **model registry + adapter** architecture that supports dynamic model onboarding, multi-provider compatibility, tool calling, the OpenAI Responses API, and binary artifact output, all behind a single HTTP endpoint.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Key Concepts](#key-concepts)
3. [Provider Templates (Adapters)](#provider-templates-adapters)
4. [HTTP API Reference](#http-api-reference)
5. [Runtime Generate: Request / Response](#runtime-generate-request--response)
6. [Model Registry CRUD](#model-registry-crud)
7. [Model Lifecycle](#model-lifecycle)
8. [Builtin YAML Models](#builtin-yaml-models)
9. [Tool Calling & Function Results](#tool-calling--function-results)
10. [Responses API & Computer Use](#responses-api--computer-use)
11. [Streaming](#streaming)
12. [Python SDK (Core-side)](#python-sdk-core-side)
13. [End-to-End Walkthrough](#end-to-end-walkthrough)
14. [Auth & Secrets](#auth--secrets)
15. [Error Handling & Retry](#error-handling--retry)

---

## Architecture

```
┌──────────┐      HTTP/JSON       ┌───────────────┐       gRPC        ┌──────────────┐
│  Client  │ ──────────────────▶  │   Backend     │ ───────────────▶  │     Core     │
│ (Swagger)│                      │  (Go / Gin)   │                   │  (Python)    │
└──────────┘                      │               │                   │              │
                                  │ • model_key   │                   │ • LLMHub   │
                                  │   resolution  │                   │ • Adapter    │
                                  │ • secrets     │                   │   selection  │
                                  │   injection   │                   │ • upstream   │
                                  │ • DTO ↔ gRPC  │  reverse gRPC    │   HTTP call  │
                                  │   mapping     │ ◀─────────────── │ • artifact   │
                                  │ • blob upload │   (upload_artifact)│  upload     │
                                  └───────────────┘                   └──────────────┘
```

### Data Flow

1. **Client** sends `POST /api/sico/llm/runtime/generate` with a JSON body.
2. **Backend** resolves `model_key` from the DB Model Registry, builds a `RuntimeModelDefinition` (including decrypted secrets), and forwards the request to **Core** via gRPC.
3. **Core** merges the resolved definition with any builtin YAML config, selects the appropriate adapter by `provider_template_type`, and calls the upstream model service.
4. The adapter transforms the request into the provider's native format, calls the HTTP endpoint, and transforms the response back into a response.
5. For binary artifacts (e.g. image generation), Core calls back to Backend via **reverse gRPC** to upload the artifact to blob storage before returning.

---

## Key Concepts

| Concept | Description |
|---|---|
| **model_key** | Unique slug identifying a model (e.g. `gpt5.4`, `deepseek-r1`). Auto-generated from `display_name` on creation. |
| **provider_template_type** | Integer 1–7 selecting which adapter handles upstream communication. |
| **model_type** | 1 = text, 2 = multimodal (text + image), 3 = artifact (binary output). Drives `io_profile`. |
| **ModelRegistryEntry** | The runtime-resolved model definition containing config, secrets, and IO profile. |
| **Adapter** | A Python class that converts requests into provider-native HTTP calls and back. |
| **Builtin model** | A Core-loaded YAML descriptor available without DB registration. |
| **Dynamic model** | A model registered through the Model Registry CRUD API and stored in the DB. |

---

## Provider Templates (Adapters)

| Type ID | Name | Adapter Class | Target |
|---|---|---|---|
| 1 | `azure_openai` | `AzureOpenAIAdapter` | Azure OpenAI Service (Chat Completions & Responses API) |
| 2 | `openai_compatible` | `OpenAICompatAdapter` | OpenAI, DeepSeek, DashScope, StepFun, OpenRouter, and any OpenAI-compatible endpoint |
| 4 | `http_json` | `HttpJsonAdapter` | Arbitrary JSON REST endpoints with admin-defined field mapping |
| 5 | `http_binary` | `HttpBinaryAdapter` | Endpoints returning binary content (images, audio, etc.) |
| 6 | `anthropic` | `AnthropicAdapter` | Anthropic Messages API |
| 7 | `gemini` | `GeminiAdapter` | Google Gemini generateContent API |

### Per-Adapter Key Config Fields

#### Azure OpenAI (type 1)

| Field | Required | Description |
|---|---|---|
| `deployment_name` | Yes | Azure deployment name |
| `endpoint` | Yes | Azure endpoint URL (e.g. `https://xxx.openai.azure.com/`) |
| `api_version` | No | API version string (default: `preview`) |

Auth: `api_key_value` secret → sent as `api-key` header.

URL pattern: `{endpoint}/openai/deployments/{deployment_name}/chat/completions?api-version={api_version}`

When using Responses API: `{endpoint}/openai/deployments/{deployment_name}/responses?api-version={api_version}`

#### OpenAI Compatible (type 2)

| Field | Required | Description |
|---|---|---|
| `base_url` | Yes | e.g. `https://api.openai.com/v1` or `https://api.deepseek.com` |
| `path` | No | Default: `/chat/completions`. Overridable for custom endpoints. |
| `responses_path` | No | Default: `/responses`. Path for Responses API. |
| `upstream_model_name` | No | Model name sent to provider. Defaults to `model_key`. |
| `use_chat_completions` | No | Force Chat Completions even for native OpenAI-compatible endpoints that would otherwise prefer Responses API. |
| `use_responses_api` | No | Force Responses API for this model when the request shape is supported. |
| `passthrough_options` | No | Extra `options` keys allowed through to both Chat Completions and Responses requests. |
| `chat_completions_passthrough_options` | No | Extra `options` keys allowed only on Chat Completions requests. |
| `responses_passthrough_options` | No | Extra `options` keys allowed only on Responses API requests. |
| `default_headers` | No | Extra request headers merged onto every request. |

Auth: `bearer_token` secret → sent as `Authorization: Bearer {token}`.

OpenRouter is supported through this adapter. When `base_url` points to `https://openrouter.ai/api/v1`, the adapter keeps the standard OpenAI-compatible request/response shape for text, streaming, tool calling, structured output, and image inputs while also auto-allowing common OpenRouter Chat Completions fields such as `models`, `route`, `provider`, `plugins`, `top_k`, `min_p`, `top_a`, `repetition_penalty`, `metadata`, `session_id`, `trace`, and `verbosity`.

For OpenRouter-backed models created through legacy UIs that expose only a `deployment_name` field, the backend normalizes `deployment_name` into `upstream_model_name` during create/update and runtime definition assembly. This compatibility alias does not apply to other `openai_compatible` providers.

If both `upstream_model_name` and `deployment_name` are provided for an OpenRouter-backed `openai_compatible` model, they must match.

In runtime requests, those OpenRouter-specific fields are passed via `options`, not as top-level LLMHub fields. For example, `options.provider.allow_fallbacks: false` tells OpenRouter not to fall back to backup providers, and `options.route: "fallback"` is used for OpenRouter model-routing fallback behavior, typically together with `options.models`.

OpenRouter Responses API is supported as an explicit opt-in. Add `use_responses_api: true` to the model config when you want the adapter to call `/responses`; otherwise OpenRouter remains on Chat Completions by default for wider compatibility. In Responses mode, the adapter auto-allows common Responses fields such as `metadata`, `store`, `verbosity`, `provider`, `route`, and `models`.

`use_responses_api` is model configuration, not a runtime request field.

For OpenRouter attribution headers, set any of the following optional config fields:

| Field | Description |
|---|---|
| `site_url` or `http_referer` | Sent as `HTTP-Referer` |
| `app_name` / `site_name` / `openrouter_title` | Sent as `X-OpenRouter-Title` |

A reusable configuration example is available at `examples/llmhubs/config/openrouter-claude-sonnet-4.yaml`.

For dynamic model registration, see `examples/llmhubs/requests/register_openrouter_model.json` and the end-to-end `openrouter_lifecycle` example in `examples/llmhubs/examples.py`.

For frontend-facing curl and request-body examples, prefer `GET /api/sico/llm/sdk-examples`, which focuses on runtime invocation examples.

#### Anthropic (type 6)

| Field | Required | Description |
|---|---|---|
| `base_url` | No | Default: `https://api.anthropic.com` |
| `path` | No | Default: `/v1/messages` |
| `anthropic_version` | No | Default: `2023-06-01` |

Auth: `api_key_value` secret → sent as `x-api-key` header.

Note: `max_tokens` is required by the Anthropic API. If not specified in request options or config, defaults to `4096`.

#### Gemini (type 7)

| Field | Required | Description |
|---|---|---|
| `base_url` | No | Default: `https://generativelanguage.googleapis.com` |
| `api_version` | No | Default: `v1beta` |
| `upstream_model_name` | No | Model name. Defaults to `model_key`. |

Auth: `api_key_value` or `bearer_token` secret → sent as `x-goog-api-key` header.

URL pattern: `{base_url}/{api_version}/models/{model}:generateContent`

Gemini logprobs support uses Gemini-native field names under `generationConfig`:

| option | Gemini upstream field | Notes |
|---|---|---|
| `logprobs` | `responseLogprobs` | Enables token logprob output in the raw payload |
| `top_logprobs` | `logprobs` | Number of top token candidates per decoding step |

#### HTTP JSON (type 4)

| Field | Required | Description |
|---|---|---|
| `base_url` | Yes | API base URL |
| `path` | No | Appended to base_url |
| `request_field_mapping` | Yes | Maps upstream fields → source slots |
| `request_static_fields` | No | Static fields merged into every request body |
| `response_extraction` | Yes | Defines how to extract output from JSON response |

** source slots**: `input_text`, `input_image`, `input_file`, `instructions`, `options.<key>`

**Response extraction**:
```json
{
  "output_type": "text",
  "text_path": "$.choices[0].message.content"
}
```

#### HTTP Binary (type 5)

Extends HTTP JSON. If upstream returns JSON → extracts artifact URL. If binary → uploads to blob storage via reverse gRPC.

| Field | Required | Description |
|---|---|---|
| Same as HTTP JSON | | |
| `response_extraction.artifact_type` | No | e.g. `image`, `audio` |
| `response_extraction.download_url_path` | No | JSONPath to extract download URL from JSON responses |

---

## HTTP API Reference

All endpoints are under `/api/sico/llm`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/runtime/generate` | **Core runtime endpoint**: invoke a model |
| `POST` | `/models` | Create a new model registration |
| `PUT` | `/models` | Update an existing model |
| `GET` | `/models?id=123` | Get a single model by id |
| `GET` | `/models/list` | List models (paginated, filterable) |
| `DELETE` | `/models` | Delete a model by request body id |
| `POST` | `/models/toggle` | Toggle active ↔ disabled |
| `GET` | `/models/stats` | Get model counts for the current agent's selected model set |
| `GET` | `/provider-templates` | List available provider template types |
| `GET` | `/sdk-examples` | Return backend-served SDK examples markdown |
| `GET` | `/source-slots` | List source slots for custom provider field mapping |

Legacy endpoint preserved:
| `POST` | `/generate` | V1 generate (unchanged) |

---

## Runtime Generate: Request / Response

### Request

`POST /api/sico/llm/runtime/generate`

```json
{
  "model": "gpt5.4",
  "instructions": "You are a concise assistant.",
  "inputs": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "What is 2+2?"}
      ]
    }
  ],
  "options": {
    "temperature": 0.7,
    "max_tokens": 256,
    "top_p": 1.0
  },
  "tools": [],
  "previousResponseId": ""
}
```

Runtime requests only need the final configured `model` / `modelKey` plus invocation data such as `inputs`, `options`, `tools`, and `previousResponseId`.

Do not send model-registry fields such as `providerTemplateType`, provider connection settings, or provider secrets in this request body.

#### Minimal Integration Paths

Start with the smallest path that matches your use case:

| Scenario | Send | Add Later When Needed |
|---|---|---|
| Plain text generation | `model` + `inputs` | `instructions`, `options` |
| Multimodal generation | `model` + `inputs` with `image` / `file` content | `instructions`, `options` |
| Function calling | Plain request + `tools` | Replay `function_call` and return `function_result` |
| Computer Use / built-in tools | `tools` with built-in type such as `computer` | `previousResponseId` + `computer_call_output` |

#### Basic Fields

| Field | Type | Description |
|---|---|---|
| `model` | string | **Required.** Model key to invoke. |
| `inputs` | array | **Required.** Conversation messages. Each has `role` and `content`. |
| `instructions` | string | Optional system prompt / instructions. |
| `options` | object | Optional runtime tuning such as `temperature`, `max_tokens`, and `top_p`. |

#### Advanced Fields

| Field | Type | Description |
|---|---|---|
| `tools` | array | Tool definitions (OpenAI function-calling format or built-in types). |
| `previousResponseId` | string | Responses API continuation ID for built-in tools and Computer Use. Source this from the previous response `payload.id`, not from `trace`. |

#### Message Structure

| Field | Type | Description |
|---|---|---|
| `inputs[].role` | string | `user`, `assistant`, `tool`, or `system`. |
| `inputs[].content` | array | Content parts with `type` discriminator. |

#### Content Types (`inputs[].content[].type`)

| Type | Fields Used | Description |
|---|---|---|
| `text` / `input_text` | `text` | Plain text content |
| `image` / `input_image` | `imageBase64`, `imageUrl`, `mediaType` | Image (base64 or URL) |
| `file` / `input_file` | `fileUrl`, `fileBase64` | File attachment |
| `function_call` | `callId`, `name`, `arguments` | Assistant tool call from a previous turn, used when replaying history |
| `function_result` | `callId`, `name`, `result` | Tool execution result sent back to the model |
| `computer_call_output` | `callId`, `output` | Computer Use screenshot or action result sent back to the model |

#### Common Options

Use these first for normal text, multimodal, and most tool-calling requests.

| Option | Type | Description |
|---|---|---|
| `temperature` | float | Sampling temperature |
| `top_p` | float | Top-p sampling |
| `max_tokens` | int | Maximum output tokens for Chat Completions style requests |
| `max_output_tokens` | int | Maximum output tokens for Responses API style requests |
| `frequency_penalty` | float | Frequency penalty |
| `logprobs` | bool | Request token logprobs from providers that support them. For Responses API requests, this also asks the upstream API to include output-text logprobs in the raw payload. |
| `presence_penalty` | float | Presence penalty |
| `stop` | array | Stop sequences |
| `seed` | int | Random seed |
| `top_logprobs` | int | Number of alternative token logprobs to request. For Responses API requests, this also enables output-text logprobs in the raw payload. |
| `response_format` | object | Structured output format |

#### Logprobs Provider Support

This table separates upstream API capability from what the current runtime adapter layer already maps.

| Provider / API | Upstream API support | Current runtime support | Notes |
|---|---|---|---|
| OpenAI Chat Completions | Yes | Yes | Uses `logprobs` + `top_logprobs` |
| OpenAI Responses | Yes | Yes | Uses `include: ["message.output_text.logprobs"]` + `top_logprobs` |
| Azure OpenAI Chat Completions | Yes | Yes | Uses `logprobs` + `top_logprobs` |
| Azure OpenAI Responses | Yes | Yes | Uses `include: ["message.output_text.logprobs"]` + `top_logprobs` |
| Gemini generateContent | Yes | Yes | Mapped to `generationConfig.responseLogprobs` + `generationConfig.logprobs` |
| Anthropic Messages | No documented support | No | Anthropic Messages docs currently expose `temperature`, `top_k`, and `top_p`, but not token logprobs |
| OpenRouter | Conditionally | Conditionally | OpenRouter documents `logprobs` and `top_logprobs`, but support still depends on the routed downstream provider/model |

#### Responses / Tool Options

These are mainly useful when using `tools`, `previousResponseId`, or provider-specific reasoning controls.

| Option | Type | Description |
|---|---|---|
| `tool_choice` | string/object | Tool selection strategy |
| `allow_multiple_tool_calls` | bool | Mapped to `parallel_tool_calls` for OpenAI |
| `include` | string/array | Extra Responses API payload sections to include. Runtime merges this with entries implied by options such as `logprobs`. |
| `reasoning_effort` | string | Mapped to `reasoning` for OpenAI |

For OpenRouter-backed models only, `options.provider`, `options.route`, and `options.models` may also be passed through by the `openai_compatible` adapter.

### Response

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "outputs": [
      {
        "type": "text",
        "text": "2+2 equals 4."
      }
    ],
    "artifacts": [],
    "usage": {
      "promptTokens": 25,
      "completionTokens": 8,
      "totalTokens": 33
    },
    "trace": {
      "providerTemplateType": 1,
      "model": "gpt-5.4",
      "latencyMs": 432
    }
  }
}
```

#### Output Item Types

| Type | Fields | Description |
|---|---|---|
| `text` | `text` | Text response |
| `json` | `json` | Structured JSON output |
| `function_call` | `callId`, `name`, `arguments` | Model requests a tool call |
| `computer_call` | `callId`, `actions` | Computer Use: model requests screen actions |
| `web_search_call` | `callId` | Web search built-in tool call |

#### Tool Call Response Example

```json
{
  "outputs": [
    {
      "type": "text",
      "text": "Let me look that up."
    },
    {
      "type": "function_call",
      "callId": "call_abc123",
      "name": "get_weather",
      "arguments": "{\"location\": \"Seattle\"}"
    }
  ]
}
```

#### Artifact Response Example (Binary Adapter)

```json
{
  "outputs": [],
  "artifacts": [
    {
      "artifactType": "image",
      "mimeType": "image/png",
      "filename": "output.png",
      "storageUri": "azure-blob://...",
      "downloadUrl": "https://cdn.example.com/..."
    }
  ]
}
```

---

## Model Registry CRUD

### Create Model

```
POST /api/sico/llm/models
```

```json
{
  "displayName": "My Custom GPT",
  "description": "A fine-tuned model for customer support.",
  "providerTemplateType": 2,
  "modelType": 1,
  "agentId": "agent_123",
  "config": {
    "base_url": "https://api.openai.com/v1",
    "upstream_model_name": "ft:gpt-4o-2024-08-06:my-org::abc123"
  },
  "auth": {
    "authType": 1,
    "token": "sk-..."
  }
}
```

The system auto-generates `model_key` from `displayName` (Unicode normalize → lowercase → slug). If that key already exists, `POST /api/sico/llm/models` returns `100005 CommonConflict` instead of silently appending a suffix.

### Update Model

```
PUT /api/sico/llm/models
```

Same shape as create, plus `id` to identify which model to update.

### List Models

```
GET /api/sico/llm/models/list?agentId=agent_123&status=1&page=1&pageSize=20
```

### Delete Model

```
DELETE /api/sico/llm/models
{"id": 123}
```

Deletes the model and its secrets. Builtin models cannot be deleted.

---

## Model Lifecycle

```
ACTIVE
  │  ▲
  │  │ toggle
  ▼  │
DISABLED
```

- **Active** → Ready for runtime use immediately after creation.
- **Disabled** → Temporarily taken offline. Can be re-enabled.
- **Deleted** → Permanently removed from the database.

---

## Builtin YAML Models

Builtin models are loaded at startup by `ModelConfigLoader` and available without DB registration. Reusable authoring templates live under `deploy/config/llmhubs/`.

### YAML Schema

```yaml
model_key: gpt5.4                          # Unique slug
display_name: GPT-5.4                      # Human-readable name
description: Azure OpenAI text model.      # Short description
model_type: text                           # text | multimodal | artifact
provider_template_type: azure_openai       # Provider adapter name or int

config:
  deployment_name: gpt-5.4                 # Provider-specific config
  endpoint: https://xxx.openai.azure.com/
  api_version: preview
  timeout_ms: 60000
  max_tokens: 4096
```

### Resolution Priority

When both a builtin YAML and a DB-registered model share the same `model_key`, the **DB model takes precedence**.

### Default Model

The default model is determined by:
1. Env var `CORE_DEFAULT__MODEL_KEY`
2. Env var `CORE_DEFAULT_LLM_MODEL`
3. Fallback: `gpt5.4`

---

## Tool Calling & Function Results

### Sending Tool Definitions

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather for a city.",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          },
          "required": ["location"]
        }
      }
    }
  ]
}
```

### Receiving a Tool Call

The model response will include a `function_call` output:

```json
{
  "outputs": [
    {
      "type": "function_call",
      "callId": "call_abc123",
      "name": "get_weather",
      "arguments": "{\"location\": \"Seattle\"}"
    }
  ]
}
```

### Sending Back Tool Results

Include the assistant's function_call and the tool result in the next request:

```json
{
  "inputs": [
    {
      "role": "assistant",
      "content": [
        {
          "type": "function_call",
          "callId": "call_abc123",
          "name": "get_weather",
          "arguments": "{\"location\": \"Seattle\"}"
        }
      ]
    },
    {
      "role": "tool",
      "content": [
        {
          "type": "function_result",
          "callId": "call_abc123",
          "result": "{\"temp\": 62, \"condition\": \"cloudy\"}"
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "Thanks! What should I wear?"}
      ]
    }
  ]
}
```

---

## Responses API & Computer Use

The Responses API is **auto-detected** when any of these conditions are true:
- `previousResponseId` is set (stateful continuation)
- `tools` contains a built-in type: `computer`, `web_search`, `file_search`, or `code_interpreter`

For HTTP runtime calls, `previousResponseId` is the camelCase field in the request body, but the value itself usually comes from the previous provider response `payload.id`.

### Computer Use Flow

```
Client                        LLMHub                     OpenAI
  │                              │                            │
  │ ── 1. initial prompt ──────▶ │ ── Responses API ────────▶ │
  │                              │ ◀── computer_call ──────── │
  │ ◀── computer_call ────────── │                            │
  │                              │                            │
  │ [execute actions, screenshot]│                            │
  │                              │                            │
  │ ── 2. screenshot reply ────▶ │ ── computer_call_output ─▶ │
  │    (previousResponseId)      │ ◀── next action / done ─── │
  │ ◀── response ──────────────  │                            │
```

#### Step 1: Start Session

```json
{
  "model": "gpt5.4",
  "instructions": "Use the computer to help the user.",
  "tools": [{"type": "computer"}],
  "inputs": [
    {
      "role": "user",
      "content": [{"type": "text", "text": "Open Notepad and type hello"}]
    }
  ]
}
```

Response:

```json
{
  "outputs": [
    {"type": "text", "text": "I'll help you with that."},
    {
      "type": "computer_call",
      "callId": "call_xyz",
      "actions": [
        {"type": "click", "x": 100, "y": 200, "button": "left"},
        {"type": "type", "text": "hello"}
      ]
    }
  ],
  "payload": {
    "id": "resp_abc"
  }
}
```

Use `payload.id` from that response as the next request's `previousResponseId`.

#### Step 2: Send Screenshot

```json
{
  "model": "gpt5.4",
  "tools": [{"type": "computer"}],
  "previousResponseId": "resp_abc",
  "inputs": [
    {
      "role": "user",
      "content": [
        {
          "type": "computer_call_output",
          "callId": "call_xyz",
          "output": {
            "type": "computer_screenshot",
            "imageUrl": "data:image/png;base64,iVBOR..."
          }
        }
      ]
    }
  ]
}
```

### Responses API Stream Terminal States

The streaming path correctly handles all Responses API terminal events:

| SSE Event | `finish_reason` |
|---|---|
| `response.completed` | `stop` |
| `response.incomplete` (max_output_tokens) | `length` |
| `response.failed` | `error` |
| `response.cancelled` | `cancelled` |

---

## Streaming

The runtime currently supports streaming at the Core Python layer, with adapters implementing `generate_stream()`. The backend HTTP endpoint (`/runtime/generate`) currently uses non-streaming gRPC.

### Core Python Streaming

```python
from app.llmhubs import generate_stream, Request, Input, InputContent

request = Request(
    model="gpt5.4",
    inputs=[Input(role="user", content=[InputContent(type="text", text="Tell me a story")])],
)

async for chunk in generate_stream(request):
    if chunk.delta:
        print(chunk.delta, end="", flush=True)
    if chunk.finish_reason:
        print(f"\n[done: {chunk.finish_reason}]")
```

### Stream Chunk Shape

```python
@dataclass
class StreamChunk:
    delta: str = ""                         # Incremental text
    outputs: list[OutputItem] = []        # Completed output items (tool calls, etc.)
    finish_reason: str | None = None        # "stop", "length", "tool_calls", "error", "cancelled"
    usage: Usage | None = None            # Token usage (on final chunk)
```

---

## Python SDK (Core-side)

### Quick Start

```python
from app.llmhubs import generate, Request, Input, InputContent

response = await generate(Request(
    model="gpt5.4",
    inputs=[Input(role="user", content=[InputContent(type="text", text="Hello")])],
))
print(response.text)
```

### Using the Chat Client (agent_framework integration)

```python
from app.llmhubs import get_client

client = get_client("gpt5.4")
response = await client.get_response(messages=[...])
```

### Using Computer Use

```python
from app.llmhubs import get_computer_use_session

session = get_computer_use_session("gpt5.4")
response = await session.start("Open Notepad and type hello")

while True:
    call = session.get_computer_call(response)
    if call is None:
        break
    # Execute call.actions on the computer
    screenshot_b64 = take_screenshot()
    response = await session.send_screenshot(call.call_id, screenshot_b64)

print(response.text)
```

---

## End-to-End Walkthrough

### 1. Register a Model via API

```bash
curl -X POST "$BASE_URL/api/sico/llm/models" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "Claude 4 Sonnet",
    "description": "Anthropic Claude 4 Sonnet",
    "providerTemplateType": 6,
    "modelType": 1,
    "agentId": "agent_123",
    "config": {
      "base_url": "https://api.anthropic.com",
      "path": "/v1/messages",
      "upstream_model_name": "claude-sonnet-4-20250514",
      "max_tokens": 4096
    },
    "auth": {
      "authType": 2,
      "api_key_value": "sk-ant-..."
    }
  }'
```

### 2. Invoke the Model

```bash
curl -X POST "$BASE_URL/api/sico/llm/runtime/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-4-sonnet",
    "instructions": "You are a helpful assistant.",
    "inputs": [
      {
        "role": "user",
        "content": [{"type": "text", "text": "Explain quantum computing in one sentence."}]
      }
    ],
    "options": {"temperature": 0.3}
  }'
```

---

## Auth & Secrets

Secrets are stored separately from config in the `t_model_registry_secret` table and never returned in API responses.

| Auth Type | Value | Secret Fields |
|---|---|---|
| 0 | None | (no auth) |
| 1 | Bearer Token | `bearer_token` → `Authorization: Bearer {value}` |
| 2 | API Key | `api_key_header` + `api_key_value` → `{header}: {value}` |

Provider-specific auth overrides:
- **Azure OpenAI**: `api_key_value` → `api-key: {value}` header
- **Anthropic**: `api_key_value` → `x-api-key: {value}` header
- **Gemini**: `api_key_value` → `x-goog-api-key: {value}` header

---

## Error Handling & Retry

### HTTP Retry (Core → Upstream)

Non-streaming requests are retried up to **3 times** with exponential backoff (1s, 2s, 4s) on:
- HTTP 429 (rate limit)
- HTTP 500, 502, 503, 504 (server errors)
- `httpx.TimeoutException`, `ConnectError`, `RemoteProtocolError`

Streaming requests are **not retried** (connections are not idempotent).

### Response Codes

| `code` | Meaning |
|---|---|
| 0 | Success |
| Non-zero | Error; check `msg` field for details |

Backend-level errors use the standard Sico error code system (see [error-code-spec.md](error-code-spec.md)).

---

## Examples

SDK examples are served by `GET /api/sico/llm/sdk-examples` and sourced from `backend/internal/transport/http/handler/assets/llmhub_sdk_examples.md`.

That SDK document is the primary place for copy-paste friendly runtime invocation examples.

| File | Description |
|---|---|
| `backend/internal/transport/http/handler/assets/llmhub_sdk_examples.md` | Backend-served SDK and curl examples used by the frontend and docs |
| `examples/llmhubs/README.md` | Entry point for runnable llmhubs examples, config samples, and request bodies |
| `examples/llmhubs/examples.py` | All-in-one Python examples (11 scenarios). Run: `python -m examples.llmhubs.examples <name>` |
