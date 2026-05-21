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
