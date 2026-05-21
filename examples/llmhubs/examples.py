# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

"""LLMHub Examples — Python versions of common adapter scenarios.

Usage:
    BASE_URL=https://your-backend TOKEN=your-jwt python -m examples.llmhubs.examples <name>

Each function demonstrates a different adapter/feature combination.
"""

import json
import os
import sys
from urllib import request


BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080").rstrip("/")
TOKEN = os.environ.get("TOKEN", "")
ENDPOINT = f"{BASE_URL}/api/sico/llm/runtime/generate"

HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
}


def _request_json(url: str, method: str, payload: dict, timeout: int = 60) -> dict:
    req = request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers=HEADERS,
        method=method,
    )
    with request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read().decode())
    if data.get("code", 0) not in (0, None):
        raise RuntimeError(data.get("msg") or f"Server error (code: {data['code']})")
    return data


def _post(payload: dict) -> dict:
    return _request_json(ENDPOINT, "POST", payload)


def _print(data: dict) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


# ──────────────────────────────────────────────────────────
# 1. Azure OpenAI — simple text
# ──────────────────────────────────────────────────────────
def azure_openai_text():
    _print(_post({
        "model": "gpt5.4",
        "instructions": "You are a concise assistant.",
        "inputs": [{"role": "user", "content": [{"type": "text", "text": "What is the capital of France?"}]}],
        "options": {"temperature": 0.2, "max_tokens": 64},
    }))


# ──────────────────────────────────────────────────────────
# 2. Azure OpenAI — multimodal (image URL)
# ──────────────────────────────────────────────────────────
def azure_openai_multimodal():
    _print(_post({
        "model": "gpt4o",
        "inputs": [{
            "role": "user",
            "content": [
                {"type": "text", "text": "What is in this picture?"},
                {"type": "image", "imageUrl": "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png"},
            ],
        }],
        "options": {"max_tokens": 300},
    }))


# ──────────────────────────────────────────────────────────
# 3. Azure OpenAI — tool calling (two-turn)
# ──────────────────────────────────────────────────────────
def azure_openai_tool_calling():
    tools = [{
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get the current weather for a city.",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string"}},
                "required": ["city"],
            },
        },
    }]

    # Turn 1 — model issues a function_call
    print("--- Turn 1: model should call get_weather ---")
    r1 = _post({
        "model": "gpt5.4",
        "instructions": "Use tools when needed.",
        "inputs": [{"role": "user", "content": [{"type": "text", "text": "Weather in Seattle?"}]}],
        "tools": tools,
        "options": {"tool_choice": "auto"},
    })
    _print(r1)

    # Turn 2 — send tool result
    print("\n--- Turn 2: feed tool result back ---")
    r2 = _post({
        "model": "gpt5.4",
        "instructions": "Use tools when needed.",
        "inputs": [
            {"role": "user", "content": [{"type": "text", "text": "Weather in Seattle?"}]},
            {"role": "assistant", "content": [
                {"type": "function_call", "callId": "call_demo", "name": "get_weather", "arguments": '{"city":"Seattle"}'},
            ]},
            {"role": "tool", "content": [
                {"type": "function_result", "callId": "call_demo", "result": '{"temp":58,"condition":"rainy"}'},
            ]},
        ],
        "tools": tools,
    })
    _print(r2)


# ──────────────────────────────────────────────────────────
# 4. OpenAI Compatible — DeepSeek
# ──────────────────────────────────────────────────────────
def openai_compat_deepseek():
    _print(_post({
        "model": "deepseek-r1",
        "instructions": "Think step by step.",
        "inputs": [{"role": "user", "content": [{"type": "text", "text": "Is 97 a prime number? Explain."}]}],
        "options": {"temperature": 0.0, "max_tokens": 256},
    }))


# ──────────────────────────────────────────────────────────
# 5. Anthropic — text
# ──────────────────────────────────────────────────────────
def anthropic_text():
    _print(_post({
        "model": "claude-4-sonnet",
        "instructions": "You are a coding assistant.",
        "inputs": [{"role": "user", "content": [{"type": "text", "text": "Write a Go function to reverse a string."}]}],
        "options": {"temperature": 0.0, "max_tokens": 512},
    }))


# ──────────────────────────────────────────────────────────
# 6. Gemini — text
# ──────────────────────────────────────────────────────────
def gemini_text():
    _print(_post({
        "model": "gemini-2-flash",
        "instructions": "Be concise.",
        "inputs": [{"role": "user", "content": [{"type": "text", "text": "What is photosynthesis?"}]}],
        "options": {"temperature": 0.3, "max_tokens": 256},
    }))


# ──────────────────────────────────────────────────────────
# 7. HTTP JSON — custom mapped endpoint
# ──────────────────────────────────────────────────────────
def http_json_custom():
    _print(_post({
        "model": "custom-translate-api",
        "inputs": [{"role": "user", "content": [{"type": "text", "text": "Hello, world!"}]}],
        "options": {"source_lang": "en", "target_lang": "ja"},
    }))


# ──────────────────────────────────────────────────────────
# 8. HTTP Binary — image generation
# ──────────────────────────────────────────────────────────
def http_binary_image():
    _print(_post({
        "model": "image-generator",
        "inputs": [{"role": "user", "content": [{"type": "text", "text": "A cat wearing sunglasses, oil painting"}]}],
        "options": {"width": 512, "height": 512},
    }))


# ──────────────────────────────────────────────────────────
# 9. Responses API — web search
# ──────────────────────────────────────────────────────────
def responses_api_web_search():
    _print(_post({
        "model": "gpt5.4",
        "instructions": "Use web search for current information.",
        "tools": [{"type": "web_search"}],
        "inputs": [{"role": "user", "content": [{"type": "text", "text": "Latest Python release version?"}]}],
    }))


# ──────────────────────────────────────────────────────────
# 10. Model registration + delete (end-to-end)
# ──────────────────────────────────────────────────────────
def model_lifecycle():
    models_url = f"{BASE_URL}/api/sico/llm/models"

    # Create
    print("--- Create ---")
    create_data = _request_json(
        models_url,
        "POST",
        {
            "displayName": "Lifecycle Demo Model",
            "description": "Lifecycle demo model",
            "providerTemplateType": 2,
            "modelType": 1,
            "config": {"base_url": "https://api.openai.com/v1", "upstream_model_name": "gpt-4o"},
            "auth": {"authType": 1, "token": "sk-demo"},
        },
        timeout=30,
    )
    _print(create_data)
    created_id = create_data["data"]["model"]["id"]

    # Delete
    print("\n--- Delete ---")
    _print(_request_json(models_url, "DELETE", {"id": created_id}, timeout=30))


# ──────────────────────────────────────────────────────────
# 11. OpenRouter model registration + invoke (end-to-end)
# ──────────────────────────────────────────────────────────
def openrouter_lifecycle():
    models_url = f"{BASE_URL}/api/sico/llm/models"
    created_id = None

    print("--- Create OpenRouter model ---")
    create_data = _request_json(
        models_url,
        "POST",
        {
            "displayName": "OpenRouter Claude Sonnet 4 Demo",
            "description": "Dynamic OpenRouter registration example",
            "providerTemplateType": 2,
            "modelType": 1,
            "config": {
                "base_url": "https://openrouter.ai/api/v1",
                "upstream_model_name": "anthropic/claude-sonnet-4",
                "site_url": "https://example.com",
                "app_name": "Sico",
                "max_tokens": 2048,
                "timeout_ms": 60000,
            },
            "auth": {"authType": 1, "token": "sk-or-demo"},
        },
        timeout=30,
    )
    _print(create_data)

    created_model = create_data["data"]["model"]
    created_id = created_model["id"]
    created_key = created_model["modelKey"]

    try:
        print("\n--- Invoke OpenRouter model ---")
        _print(_post({
            "model": created_key,
            "instructions": "You are a concise assistant.",
            "inputs": [{"role": "user", "content": [{"type": "text", "text": "Say hello in one sentence."}]}],
            "options": {
                "temperature": 0.2,
                "max_tokens": 128,
                "provider": {"allow_fallbacks": False},
                "route": "fallback",
            },
        }))
    finally:
        if created_id is not None:
            print("\n--- Delete OpenRouter model ---")
            _print(_request_json(models_url, "DELETE", {"id": created_id}, timeout=30))


# ──────────────────────────────────────────────────────────
EXAMPLES = {
    "azure_text": azure_openai_text,
    "azure_multimodal": azure_openai_multimodal,
    "azure_tools": azure_openai_tool_calling,
    "deepseek": openai_compat_deepseek,
    "anthropic": anthropic_text,
    "gemini": gemini_text,
    "http_json": http_json_custom,
    "http_binary": http_binary_image,
    "web_search": responses_api_web_search,
    "lifecycle": model_lifecycle,
    "openrouter_lifecycle": openrouter_lifecycle,
}

if __name__ == "__main__":
    if not TOKEN:
        print("Set TOKEN env var first.", file=sys.stderr)
        sys.exit(1)

    name = sys.argv[1] if len(sys.argv) > 1 else ""
    if name in EXAMPLES:
        EXAMPLES[name]()
    else:
        print(f"Usage: python {sys.argv[0]} <example_name>")
        print(f"Available: {', '.join(sorted(EXAMPLES))}")
