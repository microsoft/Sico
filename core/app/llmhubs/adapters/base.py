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

"""Base adapter interface for provider templates."""

from __future__ import annotations

import asyncio
import json
import logging
import math
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from typing import Any, Literal
from urllib.parse import urlparse

import httpx

from app.llmhubs.errors import LLMHubRuntimeError
from app.llmhubs.types import ModelRegistryEntry, Request, Response, StreamChunk

logger = logging.getLogger(__name__)

# Base64 magic-byte prefixes → MIME types.
# Only the first few characters of the base64 string are needed.
_BASE64_SIGNATURES: list[tuple[str, str]] = [
    ("/9j/", "image/jpeg"),
    ("iVBOR", "image/png"),
    ("R0lGOD", "image/gif"),
    ("UklGR", "image/webp"),
    ("Qk", "image/bmp"),
]

_EXT_MIME_MAP: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
}


def detect_media_type(
    *,
    base64_data: str = "",
    url: str = "",
    fallback: str = "image/png",
) -> str:
    """Auto-detect image MIME type from base64 data or URL.

    Priority: base64 magic bytes > URL file extension > fallback.
    """
    if base64_data:
        for prefix, mime in _BASE64_SIGNATURES:
            if base64_data.startswith(prefix):
                return mime

    if url:
        path = urlparse(url).path.lower()
        # Strip query fragments that sometimes appear as suffix
        for ext, mime in _EXT_MIME_MAP.items():
            if path.endswith(ext):
                return mime

    return fallback

# Module-level shared httpx client for connection pooling across adapters.
_shared_client: httpx.AsyncClient | None = None

_MAX_RETRIES = 3
_RETRY_BASE_DELAY = 1.0  # seconds; exponential backoff: 1s, 2s, 4s
_RETRYABLE_STATUS_CODES = frozenset({429, 500, 502, 503, 504})
_MAX_SSE_BUF_SIZE = 10 * 1024 * 1024  # 10 MB guard against unbounded growth
_DEFAULT_TIMEOUT_MS = 60000
_MIN_TIMEOUT_SECONDS = 5.0
_REQUEST_TIMEOUT_OPTION_KEYS = ("timeout_ms", "request_timeout_ms")
RetryMode = Literal["full", "connect-only", "none"]


def _get_shared_client() -> httpx.AsyncClient:
    """Return a module-level shared httpx.AsyncClient (lazy-initialized)."""
    global _shared_client
    if _shared_client is None or _shared_client.is_closed:
        _shared_client = httpx.AsyncClient(timeout=180.0)
    return _shared_client


def _log_http_error(resp: httpx.Response, url: str) -> None:
    """Log an HTTP error response with structured detail.

    Extracts the provider error message (if available) without dumping
    the entire raw body — keeps log lines readable and avoids leaking
    prompt/completion content into logs.
    """
    error_msg = ""
    try:
        body = resp.json()
        error_msg = body.get("error", {}).get("message", "") or ""
    except Exception:
        try:
            error_msg = resp.text[:500]
        except Exception:
            error_msg = "<unreadable>"
    logger.error(
        "upstream HTTP %d | url=%s | error=%s",
        resp.status_code, url, error_msg,
    )


class BaseAdapter(ABC):
    """Abstract base for all provider adapters."""

    @abstractmethod
    async def generate(self, request: Request, entry: ModelRegistryEntry) -> Response:
        """Transform *request* using *entry* config, call upstream, return response."""

    async def generate_stream(
        self, request: Request, entry: ModelRegistryEntry
    ) -> AsyncIterator[StreamChunk]:
        """Streaming variant — override in adapters that support SSE.

        Default implementation falls back to a single non-streaming call.
        """
        response = await self.generate(request, entry)
        yield StreamChunk(
            delta=response.text,
            outputs=list(response.outputs),
            finish_reason="stop",
            usage=response.usage,
        )

    # ------------------------------------------------------------------
    # HTTP helpers
    # ------------------------------------------------------------------

    @staticmethod
    async def _post(
        url: str,
        *,
        json: Any,
        headers: dict[str, str],
        timeout: float,
        retry_mode: RetryMode = "full",
    ) -> httpx.Response:
        """POST with configurable retry semantics.

        ``full`` retries retryable HTTP status codes and network/transient errors.
        ``connect-only`` retries only failures that occur before a request is
        likely accepted upstream.
        """
        client = _get_shared_client()
        if retry_mode == "none":
            resp = await client.post(url, json=json, headers=headers, timeout=timeout)
            resp.raise_for_status()
            return resp

        last_exc: Exception | None = None
        for attempt in range(_MAX_RETRIES):
            try:
                resp = await client.post(url, json=json, headers=headers, timeout=timeout)
                should_retry_status = (
                    retry_mode == "full" and resp.status_code in _RETRYABLE_STATUS_CODES
                )
                if not should_retry_status or attempt == _MAX_RETRIES - 1:
                    if resp.is_error:
                        _log_http_error(resp, url)
                    resp.raise_for_status()
                    return resp
                logger.warning("retryable status %d from %s (attempt %d/%d)",
                               resp.status_code, url, attempt + 1, _MAX_RETRIES)
            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as exc:
                last_exc = exc
                if attempt == _MAX_RETRIES - 1:
                    raise
                logger.warning("connect-phase transient error on %s (attempt %d/%d): %s",
                               url, attempt + 1, _MAX_RETRIES, exc)
            except (httpx.ReadTimeout, httpx.WriteTimeout, httpx.RemoteProtocolError) as exc:
                last_exc = exc
                if retry_mode != "full" or attempt == _MAX_RETRIES - 1:
                    raise
                logger.warning("transient error on %s (attempt %d/%d): %s",
                               url, attempt + 1, _MAX_RETRIES, exc)
            except httpx.TimeoutException as exc:
                last_exc = exc
                if retry_mode != "full" or attempt == _MAX_RETRIES - 1:
                    raise
                logger.warning("transient error on %s (attempt %d/%d): %s",
                               url, attempt + 1, _MAX_RETRIES, exc)
            delay = _RETRY_BASE_DELAY * (2 ** attempt)  # 1s, 2s, 4s
            await asyncio.sleep(delay)
        # Should not reach here, but satisfy type checker
        raise last_exc or RuntimeError("retry exhausted")

    @staticmethod
    async def _post_stream(
        url: str, *, json_body: Any, headers: dict[str, str], timeout: float,
    ) -> AsyncIterator[dict[str, Any]]:
        """POST with ``stream=True`` and yield parsed SSE data objects.

        Retries are NOT applied — streaming connections are not idempotent.
        """
        client = _get_shared_client()
        async with client.stream(
            "POST", url, json=json_body, headers=headers, timeout=timeout,
        ) as resp:
            if resp.status_code >= 400:
                await resp.aread()
                resp.raise_for_status()
            buf = ""
            async for raw in resp.aiter_text():
                buf += raw
                if len(buf) > _MAX_SSE_BUF_SIZE:
                    raise ValueError(f"SSE buffer exceeded {_MAX_SSE_BUF_SIZE} bytes")
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    line = line.strip()
                    if not line or line.startswith(":"):
                        continue
                    if line == "data: [DONE]":
                        return
                    if line.startswith("data: "):
                        payload = line[len("data: "):]
                        try:
                            yield json.loads(payload)
                        except json.JSONDecodeError:
                            logger.debug("unparseable SSE payload: %s", payload)

    @staticmethod
    async def _post_stream_sse(
        url: str, *, json_body: Any, headers: dict[str, str], timeout: float,
    ) -> AsyncIterator[tuple[str, dict[str, Any]]]:
        """POST with ``stream=True`` and yield ``(event_type, data)`` tuples.

        Similar to ``_post_stream`` but preserves SSE event types, which is
        required for the Responses API streaming format.
        """
        client = _get_shared_client()
        async with client.stream(
            "POST", url, json=json_body, headers=headers, timeout=timeout,
        ) as resp:
            if resp.status_code >= 400:
                # Read the full error body before raising so that
                # _extract_upstream_error can parse the provider message.
                await resp.aread()
                resp.raise_for_status()
            buf = ""
            current_event = ""
            async for raw in resp.aiter_text():
                buf += raw
                if len(buf) > _MAX_SSE_BUF_SIZE:
                    raise ValueError(f"SSE buffer exceeded {_MAX_SSE_BUF_SIZE} bytes")
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    line = line.strip()
                    if not line:
                        current_event = ""
                        continue
                    if line.startswith(":"):
                        continue
                    if line.startswith("event: "):
                        current_event = line[len("event: "):]
                        continue
                    if line == "data: [DONE]":
                        return
                    if line.startswith("data: "):
                        payload = line[len("data: "):]
                        try:
                            yield (current_event, json.loads(payload))
                        except json.JSONDecodeError:
                            logger.debug("unparseable SSE payload: %s", payload)

    # ------------------------------------------------------------------
    # Helpers shared by adapters
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_first_text(request: Request) -> str:
        """Extract the first input_text content from the request."""
        for inp in request.inputs:
            for c in inp.content:
                if c.type in ("input_text", "text") and c.text:
                    return c.text
        return ""

    @staticmethod
    def _extract_first_image(request: Request) -> str:
        """Extract the first input_image base64 from the request."""
        for inp in request.inputs:
            for c in inp.content:
                if c.type in ("input_image", "image") and c.image_base64:
                    return c.image_base64
        return ""

    @staticmethod
    def _extract_first_file(request: Request) -> str:
        """Extract the first input_file URL or base64."""
        for inp in request.inputs:
            for c in inp.content:
                if c.type in ("input_file", "file"):
                    return c.file_url or c.file_base64
        return ""

    @staticmethod
    def _build_auth_headers(entry: ModelRegistryEntry) -> dict[str, str]:
        """Build auth headers from entry secrets and config."""
        headers: dict[str, str] = {}
        token = (
            entry.secrets.get("bearer_token")
            or entry.secrets.get("token")
            or entry.config.get("bearer_token", "")
            or entry.config.get("token", "")
        )
        if token:
            headers["Authorization"] = f"Bearer {token}"
            return headers

        header_name = (
            entry.secrets.get("header_name")
            or entry.config.get("header_name", "")
            or "x-api-key"
        )
        api_key = (
            entry.secrets.get("api_key_value")
            or entry.secrets.get("api_key")
            or entry.config.get("api_key_value", "")
            or entry.config.get("api_key", "")
        )
        if api_key:
            headers[header_name] = api_key
        return headers

    @classmethod
    def _resolve_timeout(cls, request: Request, entry: ModelRegistryEntry) -> float:
        """Resolve timeout: request override first, then model config default."""
        for option_key in _REQUEST_TIMEOUT_OPTION_KEYS:
            timeout_ms = request.options.get(option_key)
            if timeout_ms is None:
                continue
            try:
                return cls._coerce_timeout_seconds(
                    timeout_ms,
                    source=f"request.options.{option_key}",
                )
            except ValueError as exc:
                raise LLMHubRuntimeError(
                    str(exc),
                    code=400,
                    model=request.model or entry.model_key,
                ) from exc
        return cls._get_timeout(entry)

    @classmethod
    def _get_timeout(cls, entry: ModelRegistryEntry) -> float:
        try:
            return cls._coerce_timeout_seconds(
                entry.config.get("timeout_ms", _DEFAULT_TIMEOUT_MS),
                source="config.timeout_ms",
            )
        except ValueError:
            logger.warning(
                "invalid config.timeout_ms for model=%s, falling back to %dms",
                entry.model_key, _DEFAULT_TIMEOUT_MS,
            )
            return _DEFAULT_TIMEOUT_MS / 1000.0

    @staticmethod
    def _coerce_timeout_seconds(value: Any, *, source: str) -> float:
        error_message = f"{source} must be a positive number of milliseconds"
        if isinstance(value, bool):
            raise ValueError(error_message)
        try:
            timeout_ms = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(error_message) from exc
        if not math.isfinite(timeout_ms) or timeout_ms <= 0:
            raise ValueError(error_message)
        return max(timeout_ms / 1000.0, _MIN_TIMEOUT_SECONDS)

    @staticmethod
    def _resolve_max_tokens(request: Request, entry: ModelRegistryEntry) -> int | None:
        """Resolve max_tokens: request.options > entry.config > None (omit)."""
        val = request.options.get("max_output_tokens")
        if val is None:
            val = request.options.get("max_tokens")
        if val is None:
            val = entry.config.get("max_tokens")
        return int(val) if val is not None else None
