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

"""runtime hub — resolves model_key, selects adapter, invokes upstream."""

from __future__ import annotations

import logging
import os
import time
from collections.abc import AsyncIterator

import httpx

from app.llmhubs.adapters import get_adapter
from app.llmhubs.config_loader import ModelConfigLoader
from app.llmhubs.errors import LLMHubRuntimeError
from app.llmhubs.types import ModelRegistryEntry, Request, Response, StreamChunk, Trace

logger = logging.getLogger(__name__)


# Maximum length of upstream error message exposed to clients.
# Longer messages are truncated to avoid leaking provider-specific internals.
_MAX_UPSTREAM_ERROR_LENGTH = 500


def _extract_upstream_error(exc: Exception) -> str:
    """Extract a user-safe error message from an upstream HTTP exception.

    Parses the structured error body returned by providers (e.g. Azure OpenAI)
    and returns only the ``error.message`` field.  Internal URLs and raw
    HTTP details are logged but never included in the returned string.
    The result is truncated to ``_MAX_UPSTREAM_ERROR_LENGTH`` characters.
    """
    if not isinstance(exc, httpx.HTTPStatusError):
        return ""
    resp = exc.response
    if resp is None:
        return ""
    try:
        body = resp.json()
        if not isinstance(body, dict):
            return ""

        message = ""
        error = body.get("error")
        if isinstance(error, dict):
            for key in ("message", "detail", "msg"):
                value = error.get(key)
                if isinstance(value, str) and value:
                    message = value
                    break

        if not message:
            for key in ("message", "detail", "msg"):
                value = body.get(key)
                if isinstance(value, str) and value:
                    message = value
                    break

        if not message:
            return ""

        # Replace whitespace-like control chars (CR/LF/TAB) with a single space
        # to avoid log line forging, then drop any remaining control chars,
        # then truncate.
        sanitized = "".join(
            " " if ch in ("\r", "\n", "\t") else ch
            for ch in message
            if ch in ("\r", "\n", "\t") or ord(ch) >= 32
        )
        if len(sanitized) > _MAX_UPSTREAM_ERROR_LENGTH:
            sanitized = sanitized[: _MAX_UPSTREAM_ERROR_LENGTH - 3] + "..."
        return sanitized
    except Exception:
        return ""


def _extract_upstream_status_code(exc: Exception) -> int | None:
    """Return the upstream HTTP status code if the exception carries one.

    Used so that auth/permission errors (401/403) and other client errors
    are not silently re-cast as generic 500s by the hub.
    """
    if isinstance(exc, httpx.HTTPStatusError) and exc.response is not None:
        return exc.response.status_code
    return None


# Global default model key — can be overridden via env or constructor arg.
DEFAULT_MODEL_KEY = "gpt5.4"


class LLMHub:
    """Central runtime hub.

    Merges built-in YAML models with dynamically registered DB models.
    Both are resolved through a single ``model_key`` lookup.
    """

    def __init__(
        self,
        *,
        config_dir: str | None = None,
        default_model_key: str | None = None,
    ) -> None:
        self._builtin, configured_default_key = self._load_builtin(config_dir)

        # DB-loaded entries are injected via register_dynamic / refresh
        self._dynamic: dict[str, ModelRegistryEntry] = {}

        requested_default_key = (
            default_model_key
            or os.getenv("CORE_DEFAULT_MODEL_KEY")
            or os.getenv("CORE_DEFAULT_LLM_MODEL")
        )
        self._default_model_key = self._pick_default_model_key(requested_default_key, configured_default_key)
        logger.info("LLMHub initialized, default_model_key=%s, builtin_count=%d",
                     self._default_model_key, len(self._builtin))

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def generate(
        self,
        request: Request,
        *,
        resolved_entry: ModelRegistryEntry | None = None,
    ) -> Response:
        model_key = request.model or (resolved_entry.model_key if resolved_entry is not None else self._default_model_key)
        entry = resolved_entry or self._resolve(model_key)
        if entry is None:
            return Response(code=400, msg=f"unknown model '{model_key}'")
        if entry.status != 1:
            return Response(code=400, msg=f"model '{model_key}' is not active (status={entry.status})")

        adapter = get_adapter(entry)
        if adapter is None:
            return Response(
                code=500,
                msg=f"no adapter for provider_template_type={entry.provider_template_type}",
            )

        start = time.monotonic()
        try:
            response = await adapter.generate(request, entry)
        except LLMHubRuntimeError as exc:
            logger.warning(
                "generate rejected for model=%s | code=%s | msg=%s",
                model_key,
                exc.code or 400,
                str(exc),
            )
            return Response(
                code=exc.code or 400,
                msg=str(exc),
            )
        except Exception as exc:
            upstream_msg = _extract_upstream_error(exc)
            upstream_code = _extract_upstream_status_code(exc)
            logger.exception(
                "generate failed for model=%s | upstream_status=%s | upstream_msg=%s",
                model_key, upstream_code or "<none>", upstream_msg or "<none>",
            )
            return Response(
                code=upstream_code or 500,
                msg=upstream_msg or "runtime generate failed",
            )

        latency_ms = int((time.monotonic() - start) * 1000)
        response.trace = Trace(
            provider_template_type=entry.provider_template_type,
            model=model_key,
            latency_ms=latency_ms,
        )
        return response

    async def generate_stream(
        self,
        request: Request,
        *,
        resolved_entry: ModelRegistryEntry | None = None,
    ) -> AsyncIterator[StreamChunk]:
        """Streaming generation — yields incremental text chunks."""
        model_key = request.model or (resolved_entry.model_key if resolved_entry is not None else self._default_model_key)
        entry = resolved_entry or self._resolve(model_key)
        if entry is None:
            raise LLMHubRuntimeError(f"unknown model '{model_key}'", code=400, model=model_key)
        if entry.status != 1:
            raise LLMHubRuntimeError(
                f"model '{model_key}' is not active (status={entry.status})",
                code=400,
                model=model_key,
            )

        adapter = get_adapter(entry)
        if adapter is None:
            raise LLMHubRuntimeError(
                f"no adapter for provider_template_type={entry.provider_template_type}",
                code=500,
                model=model_key,
            )

        try:
            start = time.monotonic()
            async for chunk in adapter.generate_stream(request, entry):
                yield chunk
        except Exception as exc:
            latency_ms = int((time.monotonic() - start) * 1000)
            if isinstance(exc, LLMHubRuntimeError):
                if exc.model is None:
                    exc.model = model_key
                if exc.provider_template_type is None:
                    exc.provider_template_type = entry.provider_template_type
                if exc.latency_ms is None:
                    exc.latency_ms = latency_ms
                raise
            upstream_msg = _extract_upstream_error(exc)
            upstream_code = _extract_upstream_status_code(exc)
            logger.exception(
                "generate_stream failed for model=%s | upstream_status=%s | upstream_msg=%s",
                model_key, upstream_code or "<none>", upstream_msg or "<none>",
            )
            raise LLMHubRuntimeError(
                upstream_msg or "runtime stream failed",
                code=upstream_code or 500,
                model=model_key,
                provider_template_type=entry.provider_template_type,
                latency_ms=latency_ms,
            ) from exc

    def list_builtin_models(self) -> list[ModelRegistryEntry]:
        return list(self._builtin.values())

    def register_dynamic(self, entries: list[ModelRegistryEntry]) -> None:
        """Replace the dynamic (DB-sourced) registry."""
        new_dynamic: dict[str, ModelRegistryEntry] = {}
        for entry in entries:
            if entry.status != 1:
                continue
            key = entry.model_key.lower()
            if key in new_dynamic:
                logger.warning(
                    "dynamic registry duplicate model_key=%s; overriding previous entry",
                    key,
                )
            new_dynamic[key] = entry
        self._dynamic = new_dynamic
        logger.info("dynamic registry refreshed, count=%d", len(self._dynamic))

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _resolve(self, model_key: str) -> ModelRegistryEntry | None:
        key = model_key.lower()
        # Dynamic (DB) entries take precedence over built-in
        if entry := self._dynamic.get(key):
            return entry
        return self._builtin.get(key)

    def _pick_default_model_key(
        self,
        requested_default_key: str | None,
        configured_default_key: str | None,
    ) -> str:
        if requested_default_key:
            normalized_requested_key = requested_default_key.lower()
            if normalized_requested_key in self._builtin:
                return normalized_requested_key
            raise ValueError(f"Configured default model '{requested_default_key}' is not available.")

        if configured_default_key and configured_default_key in self._builtin:
            return configured_default_key

        fallback_key = DEFAULT_MODEL_KEY.lower()
        if fallback_key in self._builtin:
            return fallback_key

        return next(iter(self._builtin))

    @staticmethod
    def _load_builtin(config_dir: str | None) -> tuple[dict[str, ModelRegistryEntry], str | None]:
        """Load builtin YAML definitions from llmhubs/configs/."""
        entries: dict[str, ModelRegistryEntry] = {}

        loader = ModelConfigLoader(config_dir)
        definitions = loader.load()

        for definition in definitions.values():
            entry = ModelRegistryEntry(
                model_key=definition.model_key,
                display_name=definition.display_name,
                model_type=definition.model_type,
                provider_template_type=definition.provider_template_type,
                is_builtin=True,
                status=1,
                description=definition.description,
                icon_uri=definition.icon_uri,
                io_profile=definition.io_profile,
                config=definition.config,
            )
            entries[definition.model_key] = entry

        return entries, loader.default_model_key
