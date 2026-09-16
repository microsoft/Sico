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
import logging
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

_MALFORMED_RESPONSE_EXCERPT_CHARS = 4_000
_LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class StructuredCompletion(Generic[T]):
    value: T
    usage: Usage
    trace: Trace


class StructuredResponseDecodeError(ValueError):
    """A structured completion did not resolve to one valid semantic value."""

    def __init__(
        self,
        message: str,
        *,
        candidates: tuple[BaseModel, ...] = (),
        usage: Usage | None = None,
        trace: Trace | None = None,
    ) -> None:
        super().__init__(message)
        self.candidates = candidates
        self.usage = usage or Usage()
        self.trace = trace or Trace()


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

    def __init__(self, *, model: str | None = None) -> None:
        self.model = model or ""
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

        text_outputs = [output.text for output in response.outputs if output.type == "text" and output.text]
        validated_outputs = _validated_structured_outputs(text_outputs, response_model)
        duplicate_value = _equivalent_structured_outputs(validated_outputs)
        if duplicate_value is not None:
            _LOGGER.warning(
                "structured_completion_collapsed_equivalent_outputs model=%s output_count=%d",
                response.trace.model or self.model,
                len(text_outputs),
            )
            return StructuredCompletion(value=duplicate_value, usage=response.usage, trace=response.trace)

        raw_text = response.text
        try:
            parsed = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            excerpt = _malformed_response_excerpt(raw_text)
            raise StructuredResponseDecodeError(
                "Structured LLM response was not valid single-value JSON: "
                f"{exc.msg} at line {exc.lineno} column {exc.colno} (char {exc.pos}); "
                f"text_output_count={len(text_outputs)}; response_chars={len(raw_text)}; "
                f"raw_response={excerpt!r}",
                candidates=tuple(validated_outputs),
                usage=response.usage,
                trace=response.trace,
            ) from exc
        return StructuredCompletion(
            value=response_model.model_validate(parsed),
            usage=response.usage,
            trace=response.trace,
        )


def _validated_structured_outputs(text_outputs: list[str], response_model: type[T]) -> list[T]:
    if len(text_outputs) < 2:
        return []
    values: list[T] = []
    try:
        for text in text_outputs:
            values.append(response_model.model_validate(json.loads(text)))
    except (json.JSONDecodeError, ValueError):
        return []
    return values


def _equivalent_structured_outputs(values: list[T]) -> T | None:
    if len(values) < 2:
        return None
    first = values[0]
    return first if all(value == first for value in values[1:]) else None


def _malformed_response_excerpt(raw_text: str) -> str:
    if len(raw_text) <= _MALFORMED_RESPONSE_EXCERPT_CHARS:
        return raw_text
    half = _MALFORMED_RESPONSE_EXCERPT_CHARS // 2
    omitted = len(raw_text) - (half * 2)
    return f"{raw_text[:half]}\n...[{omitted} chars omitted]...\n{raw_text[-half:]}"


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


__all__ = [
    "ContentBlocks",
    "HubLLMClient",
    "LLMClient",
    "StructuredCompletion",
    "StructuredResponseDecodeError",
]
