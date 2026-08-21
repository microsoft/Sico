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


def get_client(model: str | None = None, resolved_entry: ModelRegistryEntry | None = None):
    """Return a BaseChatClient backed by runtime (supports streaming)."""
    from app.llmhubs.chat_client import ChatClient
    hub = _hub()
    return ChatClient(hub, model or hub._default_model_key, resolved_entry=resolved_entry)


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
