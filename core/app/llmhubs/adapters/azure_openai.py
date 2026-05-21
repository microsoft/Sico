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

"""Azure OpenAI adapter (provider_template_type=1).

Extends OpenAI-compatible with Azure-specific deployment routing and auth.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any

from azure.identity import CredentialUnavailableError, DefaultAzureCredential

from app.llmhubs.adapters.openai_compat import (
    OpenAICompatAdapter,
    _apply_chat_logprobs_options,
    _extract_reasoning_option,
    _extract_responses_text_format,
    _needs_responses_api,
    _prepare_responses_tool,
)
from app.llmhubs.types import ModelRegistryEntry, Request, Response, StreamChunk

logger = logging.getLogger(__name__)


def _responses_api_override(entry: ModelRegistryEntry) -> bool | None:
    """Return an explicit config override for Responses API routing, or ``None``."""
    if entry.config.get("use_chat_completions") is True:
        return False
    if entry.config.get("use_responses_api") is False and "use_responses_api" in entry.config:
        return False
    if entry.config.get("use_responses_api") is True:
        if not AzureOpenAIAdapter._supports_responses_api(entry):
            logger.warning(
                "use_responses_api=true for model=%s but api_version=%r does not support "
                "Responses API; falling back to Chat Completions",
                entry.model_key,
                entry.config.get("api_version", ""),
            )
            return False
        return True
    return None


def _responses_api_supported(entry: ModelRegistryEntry) -> bool:
    """Thin wrapper around the Azure adapter eligibility check."""
    return AzureOpenAIAdapter._supports_responses_api(entry)


class AzureOpenAIAdapter(OpenAICompatAdapter):
    """Built-in adapter for Azure OpenAI deployments."""

    @staticmethod
    def _sanitize_request_options(request: Request, entry: ModelRegistryEntry) -> dict[str, Any]:
        options = dict(request.options)
        unsupported = entry.config.get("unsupported_request_options", []) or []
        if not unsupported:
            return options

        removed: list[str] = []
        for key in unsupported:
            if key in options:
                options.pop(key, None)
                removed.append(str(key))

        if removed:
            logger.info(
                "dropping unsupported request options for model=%s: %s",
                entry.model_key,
                ", ".join(sorted(removed)),
            )
        return options

    async def generate(self, request: Request, entry: ModelRegistryEntry) -> Response:
        if self._should_use_responses_api(request, entry):
            return await self._generate_azure_responses(request, entry)
        url, body, headers, timeout = self._azure_prepare(request, entry)
        resp = await self._post(url, json=body, headers=headers, timeout=timeout)
        data = resp.json()
        return self._parse_response(data)

    async def generate_stream(self, request: Request, entry: ModelRegistryEntry) -> AsyncIterator[StreamChunk]:
        if self._should_use_responses_api(request, entry):
            async for chunk in self._generate_azure_responses_stream(request, entry):
                yield chunk
            return
        url, body, headers, timeout = self._azure_prepare(request, entry)
        body["stream"] = True
        tool_call_state: dict[int, dict[str, str]] = {}
        async for data in self._post_stream(url, json_body=body, headers=headers, timeout=timeout):
            chunk = self._parse_stream_chunk(data, tool_call_state)
            if chunk is not None:
                yield chunk

    def _azure_prepare(self, request: Request, entry: ModelRegistryEntry) -> tuple[str, dict[str, Any], dict[str, str], float]:
        base_url = entry.config.get("base_url", entry.config.get("endpoint", "")).rstrip("/")
        deployment = entry.config.get("deployment_name", entry.config.get("upstream_model_name", entry.model_key))
        api_version = entry.config.get("api_version", "2024-02-01")
        timeout = self._resolve_timeout(request, entry)
        options = self._sanitize_request_options(request, entry)

        is_openai_v1 = self._is_openai_v1_endpoint(base_url)
        use_v1 = is_openai_v1 or self._is_v1_api_version(api_version)

        messages = self._build_messages(request, entry)
        body: dict[str, Any] = {"messages": messages}

        # v1 API requires model/deployment name in body
        if use_v1:
            body["model"] = deployment

        if options.get("temperature") is not None:
            body["temperature"] = options["temperature"]
        max_tokens = self._resolve_max_tokens(request, entry)
        if max_tokens is not None:
            # v1/preview API supports max_completion_tokens; legacy versions only accept max_tokens
            body["max_completion_tokens" if use_v1 else "max_tokens"] = max_tokens
        for key in (
            "top_p",
            "frequency_penalty",
            "presence_penalty",
            "stop",
            "response_format",
            "seed",
            "tool_choice",
        ):
            if key in options:
                body[key] = options[key]
        _apply_chat_logprobs_options(body, options)
        if options.get("allow_multiple_tool_calls") is not None:
            body["parallel_tool_calls"] = options["allow_multiple_tool_calls"]
        if request.tools:
            body["tools"] = request.tools
        else:
            body.pop("tool_choice", None)
            body.pop("parallel_tool_calls", None)

        headers = {"Content-Type": "application/json"}
        api_key = (
            entry.secrets.get("api_key_value")
            or entry.secrets.get("api_key")
            or entry.config.get("api_key_value", "")
            or entry.config.get("api_key", "")
        )
        if api_key:
            headers["api-key"] = api_key
        else:
            headers.update(self._build_azure_auth_headers(entry))
        headers.update(entry.config.get("default_headers", {}))

        if is_openai_v1:
            # AI Foundry: {base_url}/chat/completions (base_url already has /openai/v1)
            url = f"{base_url}/chat/completions"
        elif use_v1:
            # v1 API: {endpoint}/openai/v1/chat/completions (no api-version param)
            url = f"{base_url}/openai/v1/chat/completions"
        else:
            # Legacy versioned API: /openai/deployments/{deployment}/...
            from urllib.parse import urlencode

            qs = urlencode({"api-version": str(api_version)})
            url = f"{base_url}/openai/deployments/{deployment}/chat/completions?{qs}"
        return url, body, headers, timeout

    @staticmethod
    def _is_openai_v1_endpoint(base_url: str) -> bool:
        """Detect AI Foundry /openai/v1 endpoints that use OpenAI-compat URL format."""
        return base_url.rstrip("/").endswith("/openai/v1")

    @staticmethod
    def _is_v1_api_version(api_version: Any) -> bool:
        """Return True if api_version indicates the Azure v1 API."""
        av = str(api_version or "").strip().lower()
        return av in ("preview", "v1")

    @staticmethod
    def _is_azure_openai_endpoint(entry: ModelRegistryEntry) -> bool:
        """Return True for Azure OpenAI endpoints (vs AI Foundry third-party models).

        AI Foundry third-party models (DeepSeek, Grok, etc.) use
        *.services.ai.azure.com; Azure OpenAI models use
        *.openai.azure.com or *.cognitiveservices.azure.com.
        """
        base_url = str(entry.config.get("base_url", entry.config.get("endpoint", "")) or "").lower()
        if "services.ai.azure.com" in base_url:
            return False
        return True

    # ------------------------------------------------------------------
    # Responses API (computer use, built-in tools) — Azure variant
    # ------------------------------------------------------------------

    async def _generate_azure_responses(self, request: Request, entry: ModelRegistryEntry) -> Response:
        url, body, headers, timeout = self._azure_prepare_responses(request, entry)
        resp = await self._post(
            url,
            json=body,
            headers=headers,
            timeout=timeout,
            retry_mode="connect-only",
        )
        data = resp.json()
        return self._parse_responses_response(data)

    async def _generate_azure_responses_stream(self, request: Request, entry: ModelRegistryEntry) -> AsyncIterator[StreamChunk]:
        url, body, headers, timeout = self._azure_prepare_responses(request, entry)
        body["stream"] = True
        async for event_type, data in self._post_stream_sse(url, json_body=body, headers=headers, timeout=timeout):
            chunk = self._parse_responses_stream_event(event_type, data)
            if chunk is not None:
                yield chunk

    def _azure_prepare_responses(
        self, request: Request, entry: ModelRegistryEntry
    ) -> tuple[str, dict[str, Any], dict[str, str], float]:
        self._validate_responses_api_support(entry)
        base_url = self._normalize_azure_responses_base_url(entry.config.get("base_url", entry.config.get("endpoint", "")))
        deployment = entry.config.get(
            "deployment_name",
            entry.config.get("upstream_model_name", entry.model_key),
        )
        api_version = entry.config.get("api_version", "2025-04-01-preview")
        timeout = self._resolve_timeout(request, entry)
        options = self._sanitize_request_options(request, entry)

        input_data = self._build_responses_input(request, entry)
        body: dict[str, Any] = {"model": deployment, "input": input_data}
        if request.tools:
            body["tools"] = [_prepare_responses_tool(tool) for tool in request.tools]
        if request.previous_response_id:
            body["previous_response_id"] = request.previous_response_id
        if request.instructions:
            body["instructions"] = request.instructions

        for key in ("temperature", "top_p", "max_output_tokens", "truncation"):
            val = options.get(key)
            if val is not None:
                body[key] = val
        reasoning = _extract_reasoning_option(options, entry)
        if reasoning is not None:
            body["reasoning"] = reasoning
        text_format = _extract_responses_text_format(options.get("response_format"))
        if text_format is not None:
            body["text"] = {"format": text_format}
        if options.get("tool_choice") is not None:
            body["tool_choice"] = options["tool_choice"]
        max_tokens = self._resolve_max_tokens(request, entry)
        if max_tokens is not None:
            body.setdefault("max_output_tokens", max_tokens)
        self._apply_responses_logprobs_options(body, options)

        headers = {"Content-Type": "application/json"}
        api_key = (
            entry.secrets.get("api_key_value")
            or entry.secrets.get("api_key")
            or entry.config.get("api_key_value", "")
            or entry.config.get("api_key", "")
        )
        if api_key:
            headers["api-key"] = api_key
        else:
            headers.update(self._build_azure_auth_headers(entry))
        headers.update(entry.config.get("default_headers", {}))

        url = f"{base_url}responses"
        av = str(api_version).strip().lower() if api_version else ""
        if av and av not in ("v1", "preview"):
            from urllib.parse import urlencode

            url = f"{url}?{urlencode({'api-version': str(api_version)})}"
        return url, body, headers, timeout

    @staticmethod
    def _normalize_azure_responses_base_url(value: Any) -> str:
        base_url = str(value or "").rstrip("/")
        if base_url.endswith("/openai/v1"):
            return f"{base_url}/"
        if "/openai/v1" in base_url:
            return base_url.split("/openai/v1")[0] + "/openai/v1/"
        return f"{base_url}/openai/v1/"

    @staticmethod
    def _should_use_responses_api(request: Request, entry: ModelRegistryEntry) -> bool:
        # Request explicitly needs Responses API (computer tools, previous_response_id)
        # — Chat Completions simply cannot handle these, so honour regardless of config.
        if _needs_responses_api(request):
            return True

        override = _responses_api_override(entry)
        if override is not None:
            return override

        # Must be technically possible
        if not _responses_api_supported(entry):
            return False

        # Keep chat completions fallback for request shapes that the current
        # Responses mapping does not preserve yet, to avoid silently dropping
        # caller intent (for example stop/seed/frequency_penalty).
        if AzureOpenAIAdapter._requires_chat_completions_fallback(request):
            return False

        # Default routing per Microsoft recommendation:
        # Azure OpenAI models → Responses API (better perf, lower cost, future-proof)
        # AI Foundry third-party models → Chat Completions (wider compatibility)
        return AzureOpenAIAdapter._is_azure_openai_endpoint(entry)

    @staticmethod
    def _supports_responses_api(entry: ModelRegistryEntry) -> bool:
        base_url = str(entry.config.get("base_url", entry.config.get("endpoint", "")) or "").rstrip("/")
        if base_url.endswith("/openai/v1"):
            return True

        api_version = str(entry.config.get("api_version", "") or "").strip().lower()
        if not api_version:
            return False
        return api_version == "preview" or api_version.startswith("v1") or api_version.endswith("-preview")

    @classmethod
    def _validate_responses_api_support(cls, entry: ModelRegistryEntry) -> None:
        if cls._supports_responses_api(entry):
            return
        api_version = entry.config.get("api_version", "") or "<unset>"
        raise ValueError(
            "Azure Responses API requires an /openai/v1 endpoint or a preview/v1 api_version; "
            f"got api_version={api_version!r} for model={entry.model_key}"
        )

    def _build_azure_auth_headers(
        self,
        entry: ModelRegistryEntry,
    ) -> dict[str, str]:
        headers = self._build_auth_headers(entry)
        if headers:
            return headers

        if not entry.config.get("use_default_credential", True):
            return headers

        # Scope matches the endpoint domain:
        # AI Foundry (services.ai.azure.com) → ai.azure.com scope
        # Azure OpenAI (cognitiveservices / openai.azure.com) → cognitiveservices scope
        is_ai_foundry = not self._is_azure_openai_endpoint(entry)
        default_scope = "https://ai.azure.com/.default" if is_ai_foundry else "https://cognitiveservices.azure.com/.default"
        token_scope = entry.config.get("token_scope", default_scope)
        try:
            credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)
            token = credential.get_token(token_scope).token
        except CredentialUnavailableError:
            return headers
        except Exception:
            logger.exception("failed to acquire Azure AD token for model=%s", entry.model_key)
            return headers

        return {"Authorization": f"Bearer {token}"}
