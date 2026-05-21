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

"""Anthropic Messages API adapter (provider_template_type=6)."""

from __future__ import annotations

import logging
from typing import Any

from app.llmhubs.adapters.base import BaseAdapter, detect_media_type
from app.llmhubs.errors import LLMHubRuntimeError
from app.llmhubs.types import (
    ModelRegistryEntry,
    OutputItem,
    Request,
    Response,
    Usage,
)

logger = logging.getLogger(__name__)

_DEFAULT_ANTHROPIC_VERSION = "2023-06-01"
_DEFAULT_MAX_TOKENS = 4096


class AnthropicAdapter(BaseAdapter):
    """Built-in adapter for the Anthropic Messages API.

    Limitations:
    - Streaming not yet implemented (falls back to single response).
    - Tool calls not yet supported.
    """

    @staticmethod
    def _validate_request(request: Request) -> None:
        def _reject(msg: str) -> None:
            raise LLMHubRuntimeError(msg, code=400)

        if request.tools:
            _reject("Anthropic adapter does not support tools")
        if request.previous_response_id:
            _reject("Anthropic adapter does not support previous_response_id")
        if request.options.get("response_format") is not None:
            _reject("Anthropic adapter does not support response_format")

        for inp in request.inputs:
            for c in inp.content:
                if c.type in ("input_text", "text") and c.text:
                    continue
                if c.type in ("input_image", "image") and c.image_base64:
                    continue
                if c.type in ("input_image", "image") and c.image_url:
                    _reject("Anthropic adapter does not support remote image URLs")
                if c.type in ("input_file", "file") and (c.file_url or c.file_base64):
                    _reject("Anthropic adapter does not support file inputs")
                if c.type not in ("input_text", "text", "input_image", "image"):
                    _reject(f"Anthropic adapter does not support content type '{c.type}'")

    async def generate(self, request: Request, entry: ModelRegistryEntry) -> Response:
        self._validate_request(request)
        base_url = entry.config.get("base_url", "https://api.anthropic.com").rstrip("/")
        path = entry.config.get("path", "/v1/messages")
        upstream_model = entry.config.get("upstream_model_name", entry.model_key)
        anthropic_version = entry.config.get("anthropic_version", _DEFAULT_ANTHROPIC_VERSION)
        timeout = self._resolve_timeout(request, entry)

        messages = self._build_messages(request)
        max_tokens = self._resolve_max_tokens(request, entry)
        if max_tokens is None:
            max_tokens = _DEFAULT_MAX_TOKENS
        body: dict[str, Any] = {
            "model": upstream_model,
            "messages": messages,
            "max_tokens": max_tokens,
        }

        # System prompt goes as top-level field, not as a message
        if request.instructions:
            body["system"] = request.instructions

        if request.options.get("temperature") is not None:
            body["temperature"] = request.options["temperature"]
        for key in ("top_p", "top_k", "stop_sequences"):
            if key in request.options:
                body[key] = request.options[key]

        headers = {
            "Content-Type": "application/json",
            "anthropic-version": anthropic_version,
        }
        # Anthropic uses x-api-key header
        api_key = entry.secrets.get("api_key_value") or entry.config.get("api_key_value", "")
        if api_key:
            headers["x-api-key"] = api_key
        else:
            headers.update(self._build_auth_headers(entry))
        headers.update(entry.config.get("default_headers", {}))

        url = f"{base_url}{path}"
        resp = await self._post(url, json=body, headers=headers, timeout=timeout)
        data = resp.json()

        return self._parse_response(data)

    # Native Anthropic streaming is not implemented yet; the base class falls
    # back to a single StreamChunk produced from generate(), which preserves
    # backwards compatibility for callers that always use generate_stream().

    def _build_messages(self, request: Request) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []
        for inp in request.inputs:
            content_parts: list[dict[str, Any]] = []
            for c in inp.content:
                if c.type in ("input_text", "text") and c.text:
                    content_parts.append({"type": "text", "text": c.text})
                elif c.type in ("input_image", "image") and c.image_base64:
                    content_parts.append({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": c.media_type or detect_media_type(base64_data=c.image_base64),
                            "data": c.image_base64,
                        },
                    })

            if len(content_parts) == 1 and content_parts[0].get("type") == "text":
                messages.append({"role": inp.role, "content": content_parts[0]["text"]})
            elif content_parts:
                messages.append({"role": inp.role, "content": content_parts})

        return messages

    @staticmethod
    def _parse_response(data: dict[str, Any]) -> Response:
        outputs: list[OutputItem] = []
        for block in data.get("content", []):
            if block.get("type") == "text":
                outputs.append(OutputItem(type="text", text=block.get("text", "")))

        usage_data = data.get("usage", {})
        usage = Usage(
            prompt_tokens=usage_data.get("input_tokens", 0),
            completion_tokens=usage_data.get("output_tokens", 0),
            total_tokens=usage_data.get("input_tokens", 0) + usage_data.get("output_tokens", 0),
        )

        return Response(outputs=outputs, usage=usage, payload=data)
