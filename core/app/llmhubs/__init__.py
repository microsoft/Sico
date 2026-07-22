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

"""LLMHub runtime — merges built-in YAML models with DB-registered models."""

from __future__ import annotations

from collections.abc import AsyncIterator

from app.llmhubs.computer_use import ComputerUseSession
from app.llmhubs.errors import LLMHubRuntimeError
from app.llmhubs.hub import LLMHub
from app.llmhubs.types import (
    ModelRegistryEntry,
    Input,
    InputContent,
    Request,
    Response,
    StreamChunk,
)

__all__ = [
    "LLMHub",
    "generate",
    "generate_stream",
    "get_client",
    "get_computer_use_session",
    "ComputerUseSession",
    "Request",
    "Response",
    "Input",
    "InputContent",
    "StreamChunk",
    "LLMHubRuntimeError",
]

_DEFAULT_HUB: LLMHub | None = None


def _hub() -> LLMHub:
    global _DEFAULT_HUB
    if _DEFAULT_HUB is None:
        _DEFAULT_HUB = LLMHub()
    return _DEFAULT_HUB


async def generate(
    request: Request,
    *,
    resolved_entry: ModelRegistryEntry | None = None,
) -> Response:
    """Generate a response using the runtime."""
    return await _hub().generate(request, resolved_entry=resolved_entry)


async def generate_stream(
    request: Request,
    *,
    resolved_entry: ModelRegistryEntry | None = None,
) -> AsyncIterator[StreamChunk]:
    """Streaming generation — yields incremental text chunks."""
    async for chunk in _hub().generate_stream(request, resolved_entry=resolved_entry):
        yield chunk


def get_client(model: str | None = None):
    """Return a BaseChatClient backed by runtime (supports streaming)."""
    from app.llmhubs.chat_client import ChatClient
    hub = _hub()
    return ChatClient(hub, model or hub._default_model_key)


def get_context_length(model: str | None = None) -> int | None:
    """Return the context window size (in tokens) for a model, or None if not configured."""
    return _hub().get_context_length(model)


def get_computer_use_session(model: str | None = None, **kwargs):
    """Return a ComputerUseSession for the Responses API computer-use flow."""
    from app.llmhubs.computer_use import ComputerUseSession
    hub = _hub()
    return ComputerUseSession(hub, model or hub._default_model_key, **kwargs)


def __getattr__(name: str):
    if name == "ComputerUseSession":
        from app.llmhubs.computer_use import ComputerUseSession
        return ComputerUseSession
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
