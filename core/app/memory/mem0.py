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

"""Shared Mem0 initialization helpers for Azure-backed deployment.

This module centralizes Mem0 configuration and shared instance management so that
multiple providers can reuse the same AsyncMemory without duplicating setup code.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

import yaml
from mem0 import AsyncMemory

from app.utils.sanitize import sanitize_mem0_entity_id

LOGGER = logging.getLogger(__name__)

_shared_memory: AsyncMemory | None = None
_SENSITIVE_CONFIG_KEY_PARTS = ("api_key", "apikey", "api-key", "secret", "token", "password", "authorization")


def build_memory_filters(*, username: str | None = None, agent_id: str | None = None) -> dict[str, str]:
    filters: dict[str, str] = {}
    user_id = sanitize_mem0_entity_id(username)
    sanitized_agent_id = sanitize_mem0_entity_id(agent_id)
    if user_id:
        filters["user_id"] = user_id
    if sanitized_agent_id:
        filters["agent_id"] = sanitized_agent_id
    return filters


def extract_memory_texts(search_response: Any) -> list[str]:
    results = extract_memory_results(search_response)
    memories: list[str] = []
    for item in results:
        memory_text = item.get("memory") or item.get("text") or item.get("content")
        if memory_text:
            memories.append(str(memory_text))
    return memories


def extract_memory_results(search_response: Any) -> list[dict[str, Any]]:
    if isinstance(search_response, dict) and isinstance(search_response.get("results"), list):
        raw_results = search_response["results"]
    elif isinstance(search_response, list):
        raw_results = search_response
    elif search_response:
        raw_results = [search_response]
    else:
        raw_results = []

    results: list[dict[str, Any]] = []
    for item in raw_results:
        if isinstance(item, dict):
            result = item
        else:
            result = {"memory": str(item)}

        results.append(result)
    return results


async def init_shared_mem0(config_file_path: str) -> None:
    """Create the shared Mem0 AsyncMemory instance at application startup."""
    global _shared_memory

    if _shared_memory is not None:
        return

    with open(config_file_path, "r") as f:
        raw = f.read()
    raw = re.sub(
        r"\$\{([^}]+)\}",
        lambda m: os.environ.get(m.group(1), m.group(0)),
        raw,
    )
    config = yaml.safe_load(raw)
    if not isinstance(config, dict):
        raise ValueError(f"Mem0 config file {config_file_path} must contain a YAML mapping at the top level.")
    LOGGER.info("Loaded Mem0 config from %s: %s", config_file_path, _redact_config_for_log(config))
    try:
        _shared_memory = AsyncMemory.from_config(config)
    except Exception as exc:  # pragma: no cover - relies on external services
        LOGGER.exception("Failed to initialize shared Mem0 instance: %s", exc)
        raise


def get_shared_mem0() -> AsyncMemory:
    if _shared_memory is None:
        raise RuntimeError("Shared Mem0 instance is not initialized. Call init_shared_mem0() during application startup.")
    return _shared_memory


def _redact_config_for_log(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "[REDACTED]" if _is_sensitive_config_key(str(key)) else _redact_config_for_log(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_config_for_log(item) for item in value]
    return value


def _is_sensitive_config_key(key: str) -> bool:
    normalized = key.casefold().replace("-", "_")
    return any(part in normalized for part in _SENSITIVE_CONFIG_KEY_PARTS)
