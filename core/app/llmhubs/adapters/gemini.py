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

"""Google Gemini adapter (provider_template_type=7).

Supports the Gemini generateContent REST API.
"""

from __future__ import annotations

import logging
from typing import Any

from app.llmhubs.adapters.base import BaseAdapter, detect_media_type
from app.llmhubs.types import (
    ModelRegistryEntry,
    OutputItem,
    Request,
    Response,
    Usage,
)

logger = logging.getLogger(__name__)

_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com"


class GeminiAdapter(BaseAdapter):
    """Built-in adapter for Google Gemini generateContent API.

    Limitations:
    - Streaming not yet implemented (falls back to single response).
    - Tool calls not yet supported.
    """

    @staticmethod
    def _validate_request(request: Request) -> None:
        if request.tools:
            raise ValueError("Gemini adapter does not support tools")
        if request.previous_response_id:
            raise ValueError("Gemini adapter does not support previous_response_id")

        response_format = request.options.get("response_format")
        if response_format is not None:
            if not (isinstance(response_format, dict) and response_format.get("type") == "json_object"):
                raise ValueError("Gemini adapter only supports response_format.type=json_object")

        for inp in request.inputs:
            for c in inp.content:
                if c.type in ("input_text", "text") and c.text:
                    continue
                if c.type in ("input_image", "image") and c.image_base64:
                    continue
                if c.type in ("input_file", "file") and c.file_url:
                    continue
                if c.type in ("input_image", "image") and c.image_url:
                    raise ValueError("Gemini adapter does not support remote image URLs")
                if c.type in ("input_file", "file") and c.file_base64:
                    raise ValueError("Gemini adapter does not support base64 file inputs")
                if c.type not in ("input_text", "text", "input_image", "image", "input_file", "file"):
                    raise ValueError(f"Gemini adapter does not support content type '{c.type}'")

    async def generate(self, request: Request, entry: ModelRegistryEntry) -> Response:
        self._validate_request(request)
        url, body, headers, timeout = self._prepare_request(request, entry)

        resp = await self._post(url, json=body, headers=headers, timeout=timeout)
        data = resp.json()

        return self._parse_response(data)

    def _prepare_request(
        self,
        request: Request,
        entry: ModelRegistryEntry,
    ) -> tuple[str, dict[str, Any], dict[str, str], float | None]:
        base_url = entry.config.get("base_url", _DEFAULT_BASE_URL).rstrip("/")
        api_version = entry.config.get("api_version", "v1beta")
        upstream_model = entry.config.get("upstream_model_name", entry.model_key)
        timeout = self._resolve_timeout(request, entry)

        body: dict[str, Any] = {
            "contents": self._build_contents(request),
        }

        if request.instructions:
            body["systemInstruction"] = {
                "parts": [{"text": request.instructions}],
            }

        generation_config: dict[str, Any] = {}
        if request.options.get("temperature") is not None:
            generation_config["temperature"] = request.options["temperature"]
        max_tokens = self._resolve_max_tokens(request, entry)
        if max_tokens is not None:
            generation_config["maxOutputTokens"] = max_tokens
        for key, gemini_key in (("top_p", "topP"), ("top_k", "topK")):
            if key in request.options:
                generation_config[gemini_key] = request.options[key]
        wants_logprobs = bool(request.options.get("logprobs"))
        top_logprobs = request.options.get("top_logprobs")
        if wants_logprobs or top_logprobs is not None:
            generation_config["responseLogprobs"] = True
        if top_logprobs is not None:
            generation_config["logprobs"] = top_logprobs
        if request.options.get("stop") is not None:
            generation_config["stopSequences"] = request.options["stop"]
        if request.options.get("response_format") is not None:
            resp_fmt = request.options["response_format"]
            if isinstance(resp_fmt, dict) and resp_fmt.get("type") == "json_object":
                generation_config["responseMimeType"] = "application/json"

        if generation_config:
            body["generationConfig"] = generation_config

        headers = {"Content-Type": "application/json"}
        headers.update(self._build_auth_headers(entry))
        headers.update(entry.config.get("default_headers", {}))

        url = f"{base_url}/{api_version}/models/{upstream_model}:generateContent"
        api_key = (
            entry.secrets.get("api_key_value")
            or entry.secrets.get("api_key")
            or entry.config.get("api_key_value", "")
            or entry.config.get("api_key", "")
        )
        if api_key:
            headers.pop("Authorization", None)
            headers.pop("x-api-key", None)
            headers["x-goog-api-key"] = api_key

        return url, body, headers, timeout

    # ------------------------------------------------------------------

    def _build_contents(self, request: Request) -> list[dict[str, Any]]:
        contents: list[dict[str, Any]] = []

        for inp in request.inputs:
            parts: list[dict[str, Any]] = []
            for c in inp.content:
                if c.type in ("input_text", "text") and c.text:
                    parts.append({"text": c.text})
                elif c.type in ("input_image", "image") and c.image_base64:
                    parts.append({
                        "inlineData": {
                            "mimeType": c.media_type or detect_media_type(base64_data=c.image_base64),
                            "data": c.image_base64,
                        },
                    })
                elif c.type in ("input_file", "file") and c.file_url:
                    parts.append({
                        "fileData": {
                            "fileUri": c.file_url,
                            "mimeType": c.media_type or "application/octet-stream",
                        },
                    })

            if parts:
                # Gemini uses "user"/"model" roles (not "assistant")
                role = "model" if inp.role == "assistant" else inp.role
                contents.append({"role": role, "parts": parts})

        return contents

    @staticmethod
    def _parse_response(data: dict[str, Any]) -> Response:
        outputs: list[OutputItem] = []
        candidates = data.get("candidates", [])
        if candidates:
            content = candidates[0].get("content", {})
            for part in content.get("parts", []):
                if "text" in part:
                    outputs.append(OutputItem(type="text", text=part["text"]))

        usage_data = data.get("usageMetadata", {})
        usage = Usage(
            prompt_tokens=usage_data.get("promptTokenCount", 0),
            completion_tokens=usage_data.get("candidatesTokenCount", 0),
            total_tokens=usage_data.get("totalTokenCount", 0),
        )

        return Response(outputs=outputs, usage=usage, payload=data)
