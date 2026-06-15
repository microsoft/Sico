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
from typing import Any, TypeVar

from pydantic import BaseModel

from app.llmhubs.hub import LLMHub
from app.llmhubs.response_format import build_response_format_option
from app.llmhubs.types import Input, InputContent, Request, Response

T = TypeVar("T", bound=BaseModel)
ContentBlocks = Sequence[dict[str, Any]]

DEFAULT_CHAT_MODEL = "gpt5.4"


class LLMClient(ABC):
    """Abstract single-shot structured-output interface."""

    @abstractmethod
    async def complete_structured(
        self,
        response_model: type[T],
        *,
        prompt: str | None = None,
        content_blocks: ContentBlocks | None = None,
        **kwargs: Any,
    ) -> T:
        """Return a structured response from either a text prompt or explicit content blocks."""


class HubLLMClient(LLMClient):
    """Async wrapper over :class:`LLMHub` structured generation."""

    def __init__(self, *, model: str = DEFAULT_CHAT_MODEL) -> None:
        self.model = model
        self._hub = LLMHub()

    async def complete_structured(
        self,
        response_model: type[T],
        *,
        prompt: str | None = None,
        content_blocks: ContentBlocks | None = None,
        **kwargs: Any,
    ) -> T:
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
        return response_model.model_validate(parsed)


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


__all__ = ["ContentBlocks", "DEFAULT_CHAT_MODEL", "LLMClient", "HubLLMClient"]
