"""provider adapter registry."""

from __future__ import annotations

from app.llmhubs.adapters.anthropic import AnthropicAdapter
from app.llmhubs.adapters.azure_openai import AzureOpenAIAdapter
from app.llmhubs.adapters.base import BaseAdapter
from app.llmhubs.adapters.gemini import GeminiAdapter
from app.llmhubs.adapters.http_binary import HttpBinaryAdapter
from app.llmhubs.adapters.http_json import HttpJsonAdapter
from app.llmhubs.adapters.openai_compat import OpenAICompatAdapter
from app.llmhubs.types import ModelRegistryEntry

__all__ = ["get_adapter"]

# provider_template_type → adapter class
_ADAPTER_REGISTRY: dict[int, type[BaseAdapter]] = {
    1: AzureOpenAIAdapter,
    2: OpenAICompatAdapter,
    4: HttpJsonAdapter,
    5: HttpBinaryAdapter,
    6: AnthropicAdapter,
    7: GeminiAdapter,
}

# Cached singleton per provider_template_type (adapters are stateless)
_CACHE: dict[int, BaseAdapter] = {}


def get_adapter(entry: ModelRegistryEntry) -> BaseAdapter | None:
    """Return (possibly cached) adapter for the entry's provider type."""
    ptype = entry.provider_template_type
    if ptype in _CACHE:
        return _CACHE[ptype]
    adapter_cls = _ADAPTER_REGISTRY.get(ptype)
    if adapter_cls is None:
        return None
    adapter = adapter_cls()
    _CACHE[ptype] = adapter
    return adapter
