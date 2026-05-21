# Cortex Runtime SDK

## Runtime API Endpoints

```text
POST /api/sico/llm/runtime/generate
POST /api/sico/llm/runtime/generate/stream
```

## What This Document Covers

This document covers runtime invocation only: calling an already-configured model by `model` / `modelKey`.

It does not cover model registry create/update/delete. Fields such as the following belong to model configuration, not to the runtime request body:

- `providerTemplateType`
- `base_url`, `endpoint`, `deployment_name`
- provider secrets such as API keys or bearer tokens
- `use_responses_api`
- OpenRouter attribution headers such as `HTTP-Referer` and `X-OpenRouter-Title`

Example:

- `providerTemplateType: 2` means the model is configured with the `openai_compatible` adapter
- that value is stored in the model definition and is not sent in `/runtime/generate`

---

## Standard Request Format

```json
{
  "model": "<model_key>",
  "instructions": "You are a helpful assistant.",
  "inputs": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "<user_input>"}
      ]
    }
  ],
  "options": {
    "max_output_tokens": 1024,
    "temperature": 0.7
  }
}
```

Use this shape for normal text generation, multimodal inference, and most tool-calling requests.

### Optional Top-Level Fields

- `instructions`: optional system prompt / behavior instructions
- `options`: runtime tuning such as `temperature`, `max_tokens`, `max_output_tokens`, `top_p`, `tool_choice`, or provider-specific passthrough options
- `tools`: function definitions or built-in tool types such as `computer` and `web_search`
- `previousResponseId`: continue a previous Responses API turn, mainly for built-in tools and Computer Use

### Common Runtime Rules

- `model` must be the final configured `modelKey`, not a provider template ID
- `inputs` is the normalized conversation history you want the model to see
- use `max_output_tokens` for Responses-style requests when the provider supports it
- use `max_tokens` for Chat Completions style requests or compatibility paths

---

## OpenRouter Runtime Invocation

Use this after the model has already been configured in the product UI or created through the model registry APIs. The runtime API only needs the configured `modelKey`.

```bash
curl -s -X POST "$BASE_URL/api/sico/llm/runtime/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "<configured OpenRouter modelKey>",
    "instructions": "You are a concise assistant.",
    "inputs": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "Summarize what OpenRouter does in one sentence."}
        ]
      }
    ],
    "options": {
      "temperature": 0.2,
      "max_tokens": 256,
      "models": [
        "anthropic/claude-sonnet-4.5",
        "openai/gpt-5-mini"
      ],
      "provider": {
        "allow_fallbacks": false,
        "require_parameters": true
      },
      "route": "fallback"
    }
  }'
```

Notes:

- `providerTemplateType: 2` is a model-registry concept that means this model uses the `openai_compatible` adapter. It is not a runtime request field.
- The runtime request does not create or update models. It only invokes an already-configured `modelKey`.
- OpenRouter-specific fields such as `models`, `provider`, `route`, `plugins`, `top_k`, `min_p`, `top_a`, `repetition_penalty`, `metadata`, `session_id`, `trace`, and `verbosity` are passed through via `options` only when the configured model points to OpenRouter.
- `provider.allow_fallbacks: false` tells OpenRouter not to fall back to backup providers when the preferred provider route fails.
- `provider.require_parameters: true` asks OpenRouter to route only to providers that support all parameters in your request.
- `route: "fallback"` enables OpenRouter model-routing fallback behavior when you also supply candidate upstream models in `options.models`.
- If you only want to call one upstream OpenRouter model, omit `models` and `route`.
- If you want OpenRouter Responses API mode, configure the model with `use_responses_api: true` in the model definition. Do not send `use_responses_api` in the runtime body.

Use the actual model key configured in the product UI or returned by the model registry APIs.

---

## Text Generation

```bash
curl -s -X POST "$BASE_URL/api/sico/llm/runtime/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt5.4",
    "instructions": "You are a concise assistant.",
    "inputs": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "Explain the difference between TCP and UDP in two sentences."}
        ]
      }
    ],
    "options": {
      "temperature": 0.3,
      "max_tokens": 200
    }
  }'
```

## Vision / Multimodal

### Image URL

```bash
curl -s -X POST "$BASE_URL/api/sico/llm/runtime/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt5.4",
    "instructions": "Describe what you see in the image.",
    "inputs": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "What is in this picture?"},
          {
            "type": "image",
            "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png",
            "detail": "high"
          }
        ]
      }
    ],
    "options": {
      "max_tokens": 300
    }
  }'
```

### Base64 Image

```bash
curl -s -X POST "$BASE_URL/api/sico/llm/runtime/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt5.4",
    "inputs": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "Describe this image."},
          {
            "type": "image",
            "imageBase64": "<base64-encoded-png>",
            "detail": "high"
          }
        ]
      }
    ]
  }'
```

`mediaType` is optional. The backend/core runtime auto-detects common image types from base64 content and image URLs.
`detail` accepts OpenAI's vision values: `auto`, `low`, `high`, and, on models that support it, `original`. The default accepted set per multimodal model is `{auto, low, high}`; models can widen or narrow this via `supported_image_detail_levels` in their config.

---

## Options Example

```json
{
  "model": "gpt5.4",
  "inputs": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "Summarize this in one paragraph."}
      ]
    }
  ],
  "options": {
    "temperature": 0.3,
    "top_p": 0.95,
    "max_output_tokens": 300
  }
}
```

- use `temperature` and `top_p` for sampling control
- use `max_output_tokens` for Responses API style requests
- use `max_tokens` when the provider takes the Chat Completions path

---

## Logprobs Example

Request token log-probabilities by setting `logprobs` and `top_logprobs` in `options`.

```bash
curl -s -X POST "$BASE_URL/api/sico/llm/runtime/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt5.4",
    "inputs": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "What is the capital of France?"}
        ]
      }
    ],
    "options": {
      "logprobs": true,
      "top_logprobs": 3,
      "max_tokens": 50
    }
  }'
```

The standardized `outputs` remain unchanged. Logprob data is returned in the raw provider `payload` attached to the response:

```json
{
  "outputs": [
    {"type": "text", "text": "The capital of France is Paris."}
  ],
  "usage": {"promptTokens": 14, "completionTokens": 8, "totalTokens": 22},
  "payload": {
    "choices": [
      {
        "logprobs": {
          "content": [
            {
              "token": "The",
              "logprob": -0.0023,
              "top_logprobs": [
                {"token": "The", "logprob": -0.0023},
                {"token": "Paris", "logprob": -6.12},
                {"token": "\n", "logprob": -8.45}
              ]
            }
          ]
        }
      }
    ]
  }
}
```

Notes:

- `logprobs: true` enables token-level log-probability output
- `top_logprobs` controls how many alternative tokens are returned per position
- logprob data lives in `payload`, not in the standardized `outputs`
- supported providers today: OpenAI, Azure OpenAI, and Gemini. Anthropic does not expose logprobs here. OpenRouter support depends on the routed downstream model/provider.
- for Responses API requests, the runtime automatically adds `include: ["message.output_text.logprobs"]` when logprobs are requested
- for some providers, setting only `top_logprobs` also implicitly enables provider logprob mode, but setting both `logprobs` and `top_logprobs` is clearer and recommended

---

## Tools Example

```json
{
  "model": "gpt5.4",
  "inputs": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "What is the weather in Tokyo?"}
      ]
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get the current weather for a city.",
        "parameters": {
          "type": "object",
          "properties": {
            "city": {"type": "string"}
          },
          "required": ["city"]
        }
      }
    }
  ],
  "options": {
    "tool_choice": "auto"
  }
}
```

When the model returns a `function_call`, execute it on your side and send the result back in the next request as `function_result` content.

### Complete Tool Round Trip

#### Step 1: Ask With Tool Definitions

```bash
curl -s -X POST "$BASE_URL/api/sico/llm/runtime/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt5.4",
    "inputs": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "What is the weather in Tokyo?"}
        ]
      }
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "Get the current weather for a city.",
          "parameters": {
            "type": "object",
            "properties": {
              "city": {"type": "string"}
            },
            "required": ["city"]
          }
        }
      }
    ],
    "options": {
      "tool_choice": "auto"
    }
  }'
```

Typical model response:

```json
{
  "outputs": [
    {
      "type": "function_call",
      "callId": "call_abc123",
      "name": "get_weather",
      "arguments": "{\"city\":\"Tokyo\"}"
    }
  ]
}
```

#### Step 2: Execute the Tool and Send the Result Back

```bash
curl -s -X POST "$BASE_URL/api/sico/llm/runtime/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt5.4",
    "inputs": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "What is the weather in Tokyo?"}
        ]
      },
      {
        "role": "assistant",
        "content": [
          {
            "type": "function_call",
            "callId": "call_abc123",
            "name": "get_weather",
            "arguments": "{\"city\":\"Tokyo\"}"
          }
        ]
      },
      {
        "role": "tool",
        "content": [
          {
            "type": "function_result",
            "callId": "call_abc123",
            "name": "get_weather",
            "result": "{\"temperature\":22,\"condition\":\"partly cloudy\"}"
          }
        ]
      }
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "Get the current weather for a city.",
          "parameters": {
            "type": "object",
            "properties": {
              "city": {"type": "string"}
            },
            "required": ["city"]
          }
        }
      }
    ]
  }'
```

The same `callId` must be preserved across `function_call` and `function_result`.

`previousResponseId` is not required for this normal function-calling round trip.

---

## Computer Use / previousResponseId Example

Use `previousResponseId` when you are continuing a Responses API turn, especially for Computer Use or other built-in tools.

Important:

- `previousResponseId` comes from the previous raw provider response ID, typically `payload.id`
- it does not come from `trace`

#### Step 1: Start the Computer Use Turn

```json
{
  "model": "gpt5.4",
  "instructions": "Use the computer to help the user.",
  "tools": [{"type": "computer"}],
  "inputs": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "Open Notepad and type hello"}
      ]
    }
  ]
}
```

Typical model response:

```json
{
  "outputs": [
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
    "id": "resp_abc123"
  }
}
```

#### Step 2: Execute the Actions and Continue With Screenshot Output

```json
{
  "model": "gpt5.4",
  "tools": [{"type": "computer"}],
  "previousResponseId": "resp_abc123",
  "inputs": [
    {
      "role": "user",
      "content": [
        {
          "type": "computer_call_output",
          "callId": "call_xyz",
          "output": {
            "type": "computer_screenshot",
            "imageUrl": "data:image/png;base64,<screenshot-base64>"
          }
        }
      ]
    }
  ]
}
```

This is not needed for normal one-shot generation or standard function calling.

---

## Streaming (SSE)

```bash
curl -N -X POST "$BASE_URL/api/sico/llm/runtime/generate/stream" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt5.4",
    "instructions": "You are a concise assistant.",
    "inputs": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "Stream a short explanation of SSE."}
        ]
      }
    ]
  }'
```

The response is standard SSE with `data: {json}` chunks and a final `data: [DONE]` sentinel.

Typical text stream:

```text
data: {"delta":"Server-Sent ","outputs":[{"type":"text","text":"Server-Sent "}]}

data: {"delta":"Events keep ","outputs":[{"type":"text","text":"Events keep "}]}

data: {"delta":"one HTTP response open.","outputs":[{"type":"text","text":"one HTTP response open."}]}

data: {"finish_reason":"stop","usage":{"promptTokens":18,"completionTokens":12,"totalTokens":30}}

data: [DONE]
```

Typical tool stream:

```text
data: {"outputs":[{"type":"function_call","callId":"call_abc123","name":"get_weather","arguments":"{\"city\":\"Tokyo\"}"}]}

data: {"finish_reason":"stop","usage":{"promptTokens":30,"completionTokens":8,"totalTokens":38}}

data: [DONE]
```

For tool streams, wait until you receive the `function_call` chunk, execute the tool locally, then send a new `/runtime/generate` request with a matching `function_result`.

---

## Common Pitfalls

- Do not send `providerTemplateType` in the runtime body. It belongs to the configured model definition.
- Do not send provider secrets in runtime requests. They belong to the model definition.
- OpenRouter-only fields in `options` are meaningful only when the configured model actually targets OpenRouter.
- `previousResponseId` should come from the previous response `payload.id`, not from `trace`.
- streaming chunks use `finish_reason` in snake_case, not `finishReason`.
- `route: "fallback"` is for OpenRouter model-routing behavior and is usually paired with `options.models`.