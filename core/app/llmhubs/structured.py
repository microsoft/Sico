"""Single-shot structured-output client over :class:`~app.llmhubs.hub.LLMHub`.

This is the neutral, domain-agnostic counterpart to the streaming, tool-calling
:class:`~app.llmhubs.chat_client.ChatClient`: it drives exactly one completion
and validates the reply against a Pydantic ``response_model`` (rendered through
``to_strict_json_schema``). It carries no knowledge of experiences, chat,
sub-agents or any other caller, so every layer that just needs "one structured
JSON answer" can depend on it without reaching across domain packages.
"""

from __future__ import annotations

import json
from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Generic, TypeVar

from pydantic import BaseModel

from app.llmhubs.hub import LLMHub
from app.llmhubs.response_format import build_response_format_option
from app.llmhubs.types import Input, InputContent, Request, Response, Trace, Usage

T = TypeVar("T", bound=BaseModel)
ContentBlocks = Sequence[dict[str, Any]]

DEFAULT_CHAT_MODEL = "gpt5.4"


@dataclass(frozen=True, slots=True)
class StructuredCompletion(Generic[T]):
    value: T
    usage: Usage
    trace: Trace


class LLMClient(ABC):
    """Abstract single-shot structured-output interface."""

    async def complete_structured(
        self,
        response_model: type[T],
        *,
        prompt: str | None = None,
        content_blocks: ContentBlocks | None = None,
        **kwargs: Any,
    ) -> T:
        """Return only the validated value for callers that do not need telemetry."""
        completion = await self.complete_structured_result(
            response_model,
            prompt=prompt,
            content_blocks=content_blocks,
            **kwargs,
        )
        return completion.value

    @abstractmethod
    async def complete_structured_result(
        self,
        response_model: type[T],
        *,
        prompt: str | None = None,
        content_blocks: ContentBlocks | None = None,
        **kwargs: Any,
    ) -> StructuredCompletion[T]:
        """Return the validated value together with provider usage and trace."""


class HubLLMClient(LLMClient):
    """Async wrapper over :class:`LLMHub` structured generation."""

    def __init__(self, *, model: str = DEFAULT_CHAT_MODEL) -> None:
        self.model = model
        self._hub = LLMHub()

    async def complete_structured_result(
        self,
        response_model: type[T],
        *,
        prompt: str | None = None,
        content_blocks: ContentBlocks | None = None,
        **kwargs: Any,
    ) -> StructuredCompletion[T]:
        user_content = _resolve_user_content(prompt=prompt, content_blocks=content_blocks)

        request = Request(
            model=self.model,
            inputs=[
                Input(
                    role="user",
                    content=[
                        InputContent(
                            type=block.get("type", "text"),
                            text=block.get("text", ""),
                            image_url=(
                                block.get("image_url", {}).get("url", "") if isinstance(block.get("image_url"), dict) else ""
                            ),
                        )
                        for block in user_content
                    ],
                )
            ],
            options={
                "response_format": build_response_format_option(response_model),
                **({"max_tokens": kwargs["max_tokens"]} if "max_tokens" in kwargs else {}),
                **({"temperature": kwargs["temperature"]} if "temperature" in kwargs else {}),
            },
        )

        response: Response = await self._hub.generate(request)
        if response.code != 0:
            raise RuntimeError(f"LLMHub generate failed: {response.msg}")

        raw_text = response.text
        parsed = json.loads(raw_text)
        return StructuredCompletion(
            value=response_model.model_validate(parsed),
            usage=response.usage,
            trace=response.trace,
        )


def _resolve_user_content(
    *,
    prompt: str | None = None,
    content_blocks: ContentBlocks | None = None,
) -> list[dict[str, Any]]:
    """Resolve the final user message content from either prompt text or explicit blocks."""
    if content_blocks is not None:
        return list(content_blocks)
    if prompt is not None:
        return [{"type": "text", "text": prompt}]
    raise ValueError("Either prompt or content_blocks must be provided for structured completion.")


__all__ = ["ContentBlocks", "DEFAULT_CHAT_MODEL", "HubLLMClient", "LLMClient", "StructuredCompletion"]
