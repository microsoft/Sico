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

"""OpenAI-compatible adapter (provider_template_type=2).

Uses the Responses API by default for native OpenAI endpoints, while keeping
Chat Completions as a compatibility fallback for unsupported request shapes and
non-OpenAI providers that only emulate the older wire format.
"""

from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator, Callable
from dataclasses import asdict, is_dataclass
from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from app.llmhubs.adapters.base import BaseAdapter, detect_media_type
from app.llmhubs.errors import LLMHubRuntimeError
from app.llmhubs.image_detail import resolve_image_detail
from app.llmhubs.types import (
    ModelRegistryEntry,
    OutputItem,
    Request,
    Response,
    StreamChunk,
    Usage,
)

logger = logging.getLogger(__name__)

# Built-in tool types that require the Responses API (not Chat Completions).
_RESPONSES_API_TOOL_TYPES = frozenset(
    {
        "computer",
        "web_search",
        "file_search",
        "code_interpreter",
    }
)
_CHAT_COMPLETIONS_FALLBACK_OPTION_KEYS = frozenset(
    {
        "frequency_penalty",
        "presence_penalty",
        "seed",
        "stop",
    }
)
_OPENROUTER_CHAT_COMPLETIONS_OPTION_KEYS = frozenset(
    {
        "cache_control",
        "image_config",
        "logit_bias",
        "logprobs",
        "max_completion_tokens",
        "metadata",
        "min_p",
        "modalities",
        "models",
        "plugins",
        "prediction",
        "provider",
        "reasoning",
        "repetition_penalty",
        "route",
        "session_id",
        "stream_options",
        "structured_outputs",
        "top_a",
        "top_k",
        "top_logprobs",
        "trace",
        "transforms",
        "user",
        "verbosity",
    }
)
_OPENROUTER_RESPONSES_OPTION_KEYS = frozenset(
    {
        "include",
        "metadata",
        "models",
        "plugins",
        "provider",
        "prompt_cache_key",
        "route",
        "safety_identifier",
        "service_tier",
        "store",
        "top_k",
        "transforms",
        "user",
        "verbosity",
    }
)
_RESPONSES_LOGPROBS_INCLUDE = "message.output_text.logprobs"


def _needs_responses_api(request: Request) -> bool:
    """Return True if the request should use the Responses API endpoint."""
    if request.previous_response_id:
        return True
    return any(tool.get("type") in _RESPONSES_API_TOOL_TYPES for tool in request.tools)


def _extract_reasoning_option(
    options: dict[str, Any],
    entry: ModelRegistryEntry | None = None,
) -> Any:
    # Allow models to explicitly opt out by setting io_profile.supports_reasoning=false.
    if entry is not None:
        supports_reasoning = entry.io_profile.get("supports_reasoning")
        if supports_reasoning is False:
            if options.get("reasoning") is not None or options.get("reasoning_effort") is not None:
                logger.debug(
                    "dropping reasoning option for model %s (supports_reasoning=false)",
                    entry.model_key,
                )
            return None
    if options.get("reasoning") is not None:
        return options["reasoning"]
    reasoning_effort = options.get("reasoning_effort")
    if reasoning_effort is not None:
        return {"effort": reasoning_effort}
    return None


def _prepare_responses_tool(tool: dict[str, Any]) -> dict[str, Any]:
    if tool.get("type") != "function":
        return dict(tool)

    function = tool.get("function") or {}
    if not isinstance(function, dict):
        return dict(tool)

    prepared = {
        "type": "function",
        "name": function.get("name", ""),
        "parameters": function.get("parameters", {}),
    }
    if function.get("description"):
        prepared["description"] = function["description"]
    if "strict" in function:
        prepared["strict"] = function["strict"]
    return prepared


def _extract_responses_text_format(response_format: Any) -> dict[str, Any] | None:
    if not isinstance(response_format, dict):
        return None

    response_type = response_format.get("type")
    if response_type == "json_schema":
        schema_config = response_format.get("json_schema") or {}
        if not isinstance(schema_config, dict):
            return None
        return {
            "type": "json_schema",
            "name": schema_config.get("name", "ResponseModel"),
            "schema": schema_config.get("schema", {}),
            "strict": schema_config.get("strict", True),
        }
    if response_type in {"json_object", "text"}:
        return {"type": response_type}

    return None


def _serialize_pydantic_or_dict(value: Any) -> Any | None:
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        try:
            return model_dump(mode="json")
        except TypeError:
            return model_dump()

    dict_method = getattr(value, "dict", None)
    if callable(dict_method):
        return dict_method()

    return None


def _serialize_temporal_or_uuid(value: Any) -> Any | None:
    if isinstance(value, datetime | date | time):
        return value.isoformat()

    if isinstance(value, Decimal | UUID | Path):
        return str(value)

    return None


def _json_default(value: Any) -> Any:
    pydantic_or_dict = _serialize_pydantic_or_dict(value)
    if pydantic_or_dict is not None:
        return pydantic_or_dict

    if is_dataclass(value):
        return asdict(value)

    if isinstance(value, Enum):
        return value.value

    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")

    temporal_or_uuid = _serialize_temporal_or_uuid(value)
    if temporal_or_uuid is not None:
        return temporal_or_uuid

    return str(value)


def _serialize_json_payload(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, default=_json_default)


def _normalize_string_set(value: Any) -> set[str]:
    if value is None:
        return set()
    if isinstance(value, str):
        normalized = value.strip()
        return {normalized} if normalized else set()
    if isinstance(value, list | tuple | set | frozenset):
        items: set[str] = set()
        for item in value:
            normalized = str(item).strip()
            if normalized:
                items.add(normalized)
        return items
    return set()


def _normalize_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        normalized = value.strip()
        return [normalized] if normalized else []
    if isinstance(value, list | tuple | set | frozenset):
        items: list[str] = []
        seen: set[str] = set()
        for item in value:
            normalized = str(item).strip()
            if not normalized or normalized in seen:
                continue
            items.append(normalized)
            seen.add(normalized)
        return items
    return []


def _merge_string_lists(items: list[str], extras: list[str]) -> list[str]:
    merged = list(items)
    seen = set(items)
    for item in extras:
        if item in seen:
            continue
        merged.append(item)
        seen.add(item)
    return merged


def _apply_chat_logprobs_options(body: dict[str, Any], options: dict[str, Any]) -> None:
    top_logprobs = options.get("top_logprobs")
    wants_logprobs = options.get("logprobs")

    if top_logprobs is not None and wants_logprobs is None:
        body["logprobs"] = True
    elif wants_logprobs is not None:
        body["logprobs"] = wants_logprobs

    if top_logprobs is not None:
        body["top_logprobs"] = top_logprobs


def _process_content_item(content_item: Any, entry: ModelRegistryEntry) -> dict[str, Any] | None:
    """Convert a single ``InputContent`` into a tagged chat-completions part.

    Returns a dict ``{"__kind": "content"|"tool_call"|"tool_result", "value": ...}``
    or ``None`` if the item does not map to a chat-completions field.
    """
    c = content_item
    if c.type in ("input_text", "text") and c.text:
        return {"__kind": "content", "value": {"type": "text", "text": c.text}}
    if c.type in ("input_image", "image") and c.image_base64:
        media = c.media_type or detect_media_type(base64_data=c.image_base64)
        image_part: dict[str, Any] = {
            "type": "image_url",
            "image_url": {"url": f"data:{media};base64,{c.image_base64}"},
        }
        detail = resolve_image_detail(entry, c.detail)
        if detail is not None:
            image_part["image_url"]["detail"] = detail
        return {"__kind": "content", "value": image_part}
    if c.type in ("input_image", "image") and (c.image_url or c.file_url):
        image_part = {
            "type": "image_url",
            "image_url": {"url": c.image_url or c.file_url},
        }
        detail = resolve_image_detail(entry, c.detail)
        if detail is not None:
            image_part["image_url"]["detail"] = detail
        return {"__kind": "content", "value": image_part}
    if c.type == "function_call":
        arguments = c.arguments
        if not isinstance(arguments, str):
            arguments = _serialize_json_payload(arguments)
        return {
            "__kind": "tool_call",
            "value": {
                "id": c.call_id,
                "type": "function",
                "function": {
                    "name": c.name,
                    "arguments": arguments or "",
                },
            },
        }
    if c.type == "function_result":
        return {
            "__kind": "tool_result",
            "value": {
                "role": "tool",
                "tool_call_id": c.call_id,
                "content": _serialize_json_payload(c.result),
            },
        }
    return None


def _flush_responses_message(
    role: str,
    parts: list[dict[str, Any]],
    items: list[dict[str, Any]],
) -> None:
    """Append a Responses API ``message`` item for the pending parts and clear them."""
    if not parts:
        return
    items.append(
        {
            "type": "message",
            "role": role,
            "content": list(parts),
        }
    )
    parts.clear()


def _process_responses_content_item(
    content_item: Any,
    role: str,
    entry: ModelRegistryEntry,
) -> dict[str, Any] | None:
    """Map a single text/image ``InputContent`` to a Responses API content part."""
    c = content_item
    if c.type in ("text", "input_text") and c.text:
        text_type = "output_text" if role == "assistant" else "input_text"
        return {"type": text_type, "text": c.text}
    if c.type in ("image", "input_image"):
        if c.image_base64:
            media = c.media_type or detect_media_type(base64_data=c.image_base64)
            image_part: dict[str, Any] = {
                "type": "input_image",
                "image_url": f"data:{media};base64,{c.image_base64}",
            }
            detail = resolve_image_detail(entry, c.detail)
            if detail is not None:
                image_part["detail"] = detail
            return image_part
        if c.image_url or c.file_url:
            image_part = {
                "type": "input_image",
                "image_url": c.image_url or c.file_url,
            }
            detail = resolve_image_detail(entry, c.detail)
            if detail is not None:
                image_part["detail"] = detail
            return image_part
    return None


def _extract_response_annotations(item: dict[str, Any]) -> list[dict[str, Any]]:
    """Return the first non-empty ``output_text`` annotations list on a message item."""
    for content in item.get("content", []):
        if content.get("type") == "output_text" and content.get("annotations"):
            return content["annotations"]
    return []


def _handle_output_item_done(data: dict[str, Any]) -> StreamChunk | None:
    """Dispatch on the ``item.type`` of a ``response.output_item.done`` event."""
    item = data.get("item", {})
    item_type = item.get("type", "")
    if item_type == "computer_call":
        action = item.get("action")
        actions = item.get("actions")
        if action is not None:
            actions = [action]
        return StreamChunk(
            outputs=[
                OutputItem(
                    type="computer_call",
                    call_id=item.get("call_id", ""),
                    actions=actions,
                )
            ],
        )
    if item_type == "function_call":
        return StreamChunk(
            outputs=[
                OutputItem(
                    type="function_call",
                    call_id=item.get("call_id", ""),
                    name=item.get("name", ""),
                    arguments=item.get("arguments", ""),
                )
            ],
        )
    if item_type == "web_search_call":
        return StreamChunk(
            outputs=[
                OutputItem(
                    type="web_search_call",
                    call_id=item.get("id", ""),
                    action=item.get("action") or None,
                )
            ],
        )
    if item_type == "message":
        # Text was already streamed via deltas, but capture annotations.
        annotations = _extract_response_annotations(item)
        if annotations:
            return StreamChunk(
                outputs=[OutputItem(type="text", text="", annotations=annotations)],
            )
    # Skip other "message" items without annotations.
    return None


def _handle_output_text_delta(_event_type: str, data: dict[str, Any]) -> StreamChunk | None:
    delta = data.get("delta", "")
    if not delta:
        return None
    return StreamChunk(
        delta=delta,
        outputs=[OutputItem(type="text", text=delta)],
    )


def _handle_refusal_delta(_event_type: str, data: dict[str, Any]) -> StreamChunk | None:
    delta = data.get("delta", "")
    if not delta:
        return None
    return StreamChunk(
        delta=delta,
        outputs=[OutputItem(type="refusal", text=delta)],
    )


def _handle_refusal_done(_event_type: str, data: dict[str, Any]) -> StreamChunk | None:
    refusal = data.get("refusal", "")
    if not refusal:
        return None
    return StreamChunk(
        outputs=[OutputItem(type="refusal", text=refusal)],
    )


def _handle_output_item_done_event(_event_type: str, data: dict[str, Any]) -> StreamChunk | None:
    # Thin adapter: the dispatch table expects (event_type, data); the
    # underlying handler only needs data. Keeping it as a named function
    # instead of a lambda makes stack traces clearer when the handler raises.
    return _handle_output_item_done(data)


def _handle_response_completed(_event_type: str, data: dict[str, Any]) -> StreamChunk | None:
    return StreamChunk(
        finish_reason="stop",
        usage=OpenAICompatAdapter._responses_usage_from_event(data),
    )


def _handle_response_terminal(event_type: str, data: dict[str, Any]) -> StreamChunk | None:
    return StreamChunk(
        finish_reason=OpenAICompatAdapter._responses_finish_reason_from_event(event_type, data),
        usage=OpenAICompatAdapter._responses_usage_from_event(data),
    )


_RESPONSES_STREAM_EVENT_HANDLERS: dict[str, Callable[[str, dict[str, Any]], StreamChunk | None]] = {
    "response.output_text.delta": _handle_output_text_delta,
    "response.refusal.delta": _handle_refusal_delta,
    "response.refusal.done": _handle_refusal_done,
    "response.output_item.done": _handle_output_item_done_event,
    "response.completed": _handle_response_completed,
    "response.incomplete": _handle_response_terminal,
    "response.failed": _handle_response_terminal,
    "response.cancelled": _handle_response_terminal,
}


class OpenAICompatAdapter(BaseAdapter):
    """Built-in adapter for OpenAI-compatible providers."""

    @staticmethod
    def _is_openrouter_entry(entry: ModelRegistryEntry) -> bool:
        base_url = str(entry.config.get("base_url", ""))
        try:
            host = urlparse(base_url).hostname or ""
        except ValueError:
            return False
        host = host.lower()
        return host == "openrouter.ai" or host.endswith(".openrouter.ai")

    async def generate(self, request: Request, entry: ModelRegistryEntry) -> Response:
        self._enforce_capability_constraints(request, entry)
        if self._should_use_responses_api(request, entry):
            return await self._generate_responses(request, entry)
        url, body, headers, timeout = self._prepare_request(request, entry)
        resp = await self._post(url, json=body, headers=headers, timeout=timeout)
        data = resp.json()
        return self._parse_response(data)

    async def generate_stream(self, request: Request, entry: ModelRegistryEntry) -> AsyncIterator[StreamChunk]:
        self._enforce_capability_constraints(request, entry)
        if self._should_use_responses_api(request, entry):
            async for chunk in self._generate_responses_stream(request, entry):
                yield chunk
            return
        url, body, headers, timeout = self._prepare_request(request, entry)
        body["stream"] = True
        tool_call_state: dict[int, dict[str, str]] = {}
        async for data in self._post_stream(url, json_body=body, headers=headers, timeout=timeout):
            chunk = self._parse_stream_chunk(data, tool_call_state)
            if chunk is not None:
                yield chunk

    @staticmethod
    def _enforce_capability_constraints(request: Request, entry: ModelRegistryEntry) -> None:
        """Reject requests that conflict with the entry's declared io_profile.

        Without this, a model that declares ``supports_previous_response_id=false``
        would still have the continuation id forwarded to the upstream (because
        ``_needs_responses_api`` forces the Responses path), and the failure would
        only surface as an opaque 4xx from the provider. Fail fast so callers can
        route to a compatible model instead.
        """
        if request.previous_response_id and entry.io_profile.get("supports_previous_response_id") is False:
            raise LLMHubRuntimeError(
                f"model '{entry.model_key}' does not support previous_response_id continuation",
                code=400,
                model=entry.model_key,
            )

    # ------------------------------------------------------------------

    @staticmethod
    def _is_native_openai_entry(entry: ModelRegistryEntry) -> bool:
        base_url = str(entry.config.get("base_url", "")).lower()
        return "api.openai.com" in base_url

    @classmethod
    def _prefers_responses_api(cls, entry: ModelRegistryEntry) -> bool:
        if entry.config.get("use_chat_completions") is True:
            return False
        if entry.config.get("use_responses_api") is True:
            return True
        return cls._is_native_openai_entry(entry)

    @staticmethod
    def _requires_chat_completions_fallback(request: Request) -> bool:
        for key in _CHAT_COMPLETIONS_FALLBACK_OPTION_KEYS:
            if request.options.get(key) is not None:
                return True

        response_format = request.options.get("response_format")
        if response_format is not None and _extract_responses_text_format(response_format) is None:
            return True

        return False

    @classmethod
    def _should_use_responses_api(cls, request: Request, entry: ModelRegistryEntry) -> bool:
        if _needs_responses_api(request):
            return True
        if not cls._prefers_responses_api(entry):
            return False
        return not cls._requires_chat_completions_fallback(request)

    def _prepare_request(self, request: Request, entry: ModelRegistryEntry) -> tuple[str, dict[str, Any], dict[str, str], float]:
        base_url = entry.config.get("base_url", "").rstrip("/")
        path = entry.config.get("path", "/chat/completions")
        upstream_model = entry.config.get("upstream_model_name") or entry.model_key
        timeout = self._resolve_timeout(request, entry)

        messages = self._build_messages(request, entry)
        body: dict[str, Any] = {"model": upstream_model, "messages": messages}

        if request.options.get("temperature") is not None:
            body["temperature"] = request.options["temperature"]
        max_tokens = self._resolve_max_tokens(request, entry)
        if max_tokens is not None:
            body["max_tokens"] = max_tokens

        # Pass through known OpenAI options
        for key in (
            "top_p",
            "frequency_penalty",
            "presence_penalty",
            "stop",
            "response_format",
            "seed",
            "tool_choice",
        ):
            if key in request.options:
                body[key] = request.options[key]
        _apply_chat_logprobs_options(body, request.options)
        if request.options.get("allow_multiple_tool_calls") is not None:
            body["parallel_tool_calls"] = request.options["allow_multiple_tool_calls"]
        if request.tools:
            body["tools"] = request.tools
        else:
            body.pop("tool_choice", None)
            body.pop("parallel_tool_calls", None)

        # reasoning is only injected here when the entry explicitly opts in via
        # io_profile.supports_reasoning=true. Otherwise we leave it to the
        # passthrough step below: OpenRouter entries auto-allow reasoning via
        # _OPENROUTER_CHAT_COMPLETIONS_OPTION_KEYS, while explicit
        # supports_reasoning=false strips reasoning out of the passthrough set
        # in _get_passthrough_option_keys. `_apply_option_passthrough` skips
        # keys already present in body, so there is no risk of double-writing.
        if entry.io_profile.get("supports_reasoning") is True:
            reasoning = _extract_reasoning_option(request.options, entry)
            if reasoning is not None:
                body["reasoning"] = reasoning

        self._apply_option_passthrough(
            body,
            request.options,
            self._get_passthrough_option_keys(entry, request_kind="chat_completions"),
            handled_keys={
                "allow_multiple_tool_calls",
                "frequency_penalty",
                "logprobs",
                "max_output_tokens",
                "max_tokens",
                "presence_penalty",
                "request_timeout_ms",
                "response_format",
                "seed",
                "stop",
                "temperature",
                "timeout_ms",
                "top_logprobs",
                "tool_choice",
                "top_p",
            },
        )

        headers = self._build_request_headers(entry)

        url = f"{base_url}{path}"
        return url, body, headers, timeout

    # ------------------------------------------------------------------

    def _build_messages(self, request: Request, entry: ModelRegistryEntry) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = []

        if request.instructions:
            messages.append({"role": "system", "content": request.instructions})

        for inp in request.inputs:
            content_parts: list[dict[str, Any]] = []
            tool_calls: list[dict[str, Any]] = []
            tool_results: list[dict[str, Any]] = []
            for c in inp.content:
                processed = _process_content_item(c, entry)
                if processed is None:
                    continue
                kind = processed["__kind"]
                if kind == "content":
                    content_parts.append(processed["value"])
                elif kind == "tool_call":
                    tool_calls.append(processed["value"])
                elif kind == "tool_result":
                    tool_results.append(processed["value"])

            message: dict[str, Any] = {"role": inp.role}
            if len(content_parts) == 1 and content_parts[0].get("type") == "text":
                message["content"] = content_parts[0]["text"]
            elif content_parts:
                message["content"] = content_parts
            if tool_calls:
                message["tool_calls"] = tool_calls
            if "content" in message or "tool_calls" in message:
                messages.append(message)
            if tool_results:
                messages.extend(tool_results)

        return messages

    @staticmethod
    def _parse_response(data: dict[str, Any]) -> Response:
        outputs: list[OutputItem] = []
        choices = data.get("choices", [])
        if choices:
            message = choices[0].get("message", {})
            text = message.get("content", "")
            if text:
                outputs.append(OutputItem(type="text", text=text))
            refusal = message.get("refusal")
            if refusal:
                outputs.append(OutputItem(type="refusal", text=str(refusal)))
            for tool_call in message.get("tool_calls", []) or []:
                function_data = tool_call.get("function", {}) or {}
                outputs.append(
                    OutputItem(
                        type="function_call",
                        call_id=tool_call.get("id", ""),
                        name=function_data.get("name", ""),
                        arguments=function_data.get("arguments", "") or "",
                    )
                )

        usage_data = data.get("usage", {})
        usage = Usage(
            prompt_tokens=usage_data.get("prompt_tokens", 0),
            completion_tokens=usage_data.get("completion_tokens", 0),
            total_tokens=usage_data.get("total_tokens", 0),
        )

        return Response(outputs=outputs, usage=usage, payload=data)

    @staticmethod
    def _parse_stream_chunk(
        data: dict[str, Any],
        tool_call_state: dict[int, dict[str, str]] | None = None,
    ) -> StreamChunk | None:
        choices = data.get("choices", [])
        finish = None
        text_parts: list[str] = []
        outputs: list[OutputItem] = []
        finalized_tool_calls: list[OutputItem] = []
        state = tool_call_state if tool_call_state is not None else {}
        for choice in choices:
            delta = choice.get("delta", {}) or {}
            text = delta.get("content") or ""
            if text:
                text_parts.append(text)
                outputs.append(OutputItem(type="text", text=text))
            for tool_call in delta.get("tool_calls", []) or []:
                index = tool_call.get("index")
                if not isinstance(index, int):
                    index = len(state)
                function_data = tool_call.get("function", {}) or {}
                current = state.setdefault(
                    index,
                    {
                        "call_id": f"tool_call_{index}",
                        "name": "",
                        "arguments": "",
                    },
                )
                if tool_call.get("id"):
                    current["call_id"] = tool_call["id"]
                if function_data.get("name"):
                    current["name"] = function_data["name"]
                if function_data.get("arguments"):
                    current["arguments"] += function_data["arguments"]
            finish = choice.get("finish_reason") or finish
        if finish is not None and state:
            for index in sorted(state):
                current = state[index]
                finalized_tool_calls.append(
                    OutputItem(
                        type="function_call",
                        call_id=current["call_id"],
                        name=current["name"],
                        arguments=current["arguments"],
                    )
                )
            state.clear()
        usage_data = data.get("usage")
        usage = None
        if usage_data:
            usage = Usage(
                prompt_tokens=usage_data.get("prompt_tokens", 0),
                completion_tokens=usage_data.get("completion_tokens", 0),
                total_tokens=usage_data.get("total_tokens", 0),
            )
        outputs.extend(finalized_tool_calls)
        if outputs or finish or usage:
            return StreamChunk(
                delta="".join(text_parts),
                outputs=outputs,
                finish_reason=finish,
                usage=usage,
            )
        return None

    # ------------------------------------------------------------------
    # Responses API support (computer use, built-in tools)
    # ------------------------------------------------------------------

    async def _generate_responses(self, request: Request, entry: ModelRegistryEntry) -> Response:
        url, body, headers, timeout = self._prepare_responses_request(request, entry)
        resp = await self._post(
            url,
            json=body,
            headers=headers,
            timeout=timeout,
            retry_mode="connect-only",
        )
        data = resp.json()
        return self._parse_responses_response(data)

    async def _generate_responses_stream(self, request: Request, entry: ModelRegistryEntry) -> AsyncIterator[StreamChunk]:
        url, body, headers, timeout = self._prepare_responses_request(request, entry)
        body["stream"] = True
        async for event_type, data in self._post_stream_sse(url, json_body=body, headers=headers, timeout=timeout):
            chunk = self._parse_responses_stream_event(event_type, data)
            if chunk is not None:
                yield chunk

    def _prepare_responses_request(
        self, request: Request, entry: ModelRegistryEntry
    ) -> tuple[str, dict[str, Any], dict[str, str], float]:
        base_url = entry.config.get("base_url", "").rstrip("/")
        path = entry.config.get("responses_path", "/responses")
        upstream_model = entry.config.get("upstream_model_name") or entry.model_key
        timeout = self._resolve_timeout(request, entry)

        input_data = self._build_responses_input(request, entry)
        body: dict[str, Any] = {
            "model": upstream_model,
            "input": input_data,
        }
        if request.tools:
            body["tools"] = [_prepare_responses_tool(tool) for tool in request.tools]
        if request.previous_response_id:
            body["previous_response_id"] = request.previous_response_id
        if request.instructions:
            body["instructions"] = request.instructions

        for key in ("temperature", "top_p", "max_output_tokens", "truncation"):
            val = request.options.get(key)
            if val is not None:
                body[key] = val
        reasoning = _extract_reasoning_option(request.options, entry)
        if reasoning is not None:
            body["reasoning"] = reasoning
        text_format = _extract_responses_text_format(request.options.get("response_format"))
        if text_format is not None:
            body["text"] = {"format": text_format}
        if request.options.get("tool_choice") is not None:
            body["tool_choice"] = request.options["tool_choice"]
        max_tokens = self._resolve_max_tokens(request, entry)
        if max_tokens is not None:
            body.setdefault("max_output_tokens", max_tokens)
        self._apply_responses_logprobs_options(body, request.options)

        self._apply_option_passthrough(
            body,
            request.options,
            self._get_passthrough_option_keys(entry, request_kind="responses"),
            handled_keys={
                "include",
                "logprobs",
                "max_output_tokens",
                "max_tokens",
                "reasoning",
                "reasoning_effort",
                "request_timeout_ms",
                "response_format",
                "temperature",
                "timeout_ms",
                "top_logprobs",
                "tool_choice",
                "top_p",
                "truncation",
            },
        )

        headers = self._build_request_headers(entry)

        url = f"{base_url}{path}"
        return url, body, headers, timeout

    @classmethod
    def _get_passthrough_option_keys(
        cls,
        entry: ModelRegistryEntry,
        *,
        request_kind: str,
    ) -> set[str]:
        keys = _normalize_string_set(entry.config.get("passthrough_options"))
        keys.update(_normalize_string_set(entry.config.get(f"{request_kind}_passthrough_options")))
        if request_kind == "chat_completions" and cls._is_openrouter_entry(entry):
            keys.update(_OPENROUTER_CHAT_COMPLETIONS_OPTION_KEYS)
        if request_kind == "responses" and cls._is_openrouter_entry(entry):
            keys.update(_OPENROUTER_RESPONSES_OPTION_KEYS)
        # Explicit opt-out wins over the OpenRouter default passthrough.
        if entry.io_profile.get("supports_reasoning") is False:
            keys.discard("reasoning")
            keys.discard("reasoning_effort")
        return keys

    @staticmethod
    def _apply_option_passthrough(
        body: dict[str, Any],
        options: dict[str, Any],
        passthrough_keys: set[str],
        *,
        handled_keys: set[str],
    ) -> None:
        for key in sorted(passthrough_keys):
            if key in handled_keys:
                continue
            value = options.get(key)
            if value is not None and key not in body:
                body[key] = value

    @staticmethod
    def _apply_responses_logprobs_options(body: dict[str, Any], options: dict[str, Any]) -> None:
        include_items = _normalize_string_list(options.get("include"))
        top_logprobs = options.get("top_logprobs")
        wants_logprobs = bool(options.get("logprobs"))

        if wants_logprobs or top_logprobs is not None:
            include_items = _merge_string_lists(include_items, [_RESPONSES_LOGPROBS_INCLUDE])
        if top_logprobs is not None:
            body["top_logprobs"] = top_logprobs
        if include_items:
            body["include"] = include_items

    @classmethod
    def _build_request_headers(cls, entry: ModelRegistryEntry) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        headers.update(cls._build_auth_headers(entry))

        default_headers = entry.config.get("default_headers") or {}
        if isinstance(default_headers, dict):
            headers.update({str(key): str(value) for key, value in default_headers.items()})

        if cls._is_openrouter_entry(entry):
            normalized_header_names = {key.lower() for key in headers}
            site_url = str(entry.config.get("site_url") or entry.config.get("http_referer") or "").strip()
            app_name = str(
                entry.config.get("app_name") or entry.config.get("site_name") or entry.config.get("openrouter_title") or ""
            ).strip()

            if site_url and "http-referer" not in normalized_header_names:
                headers["HTTP-Referer"] = site_url
            if app_name and "x-openrouter-title" not in normalized_header_names and "x-title" not in normalized_header_names:
                headers["X-OpenRouter-Title"] = app_name
        return headers

    def _build_responses_input(self, request: Request, entry: ModelRegistryEntry) -> str | list[dict[str, Any]]:
        """Convert inputs → Responses API ``input`` field."""
        items: list[dict[str, Any]] = []

        for inp in request.inputs:
            message_parts: list[dict[str, Any]] = []

            for c in inp.content:
                if c.type == "computer_call_output":
                    _flush_responses_message(inp.role, message_parts, items)
                    item: dict[str, Any] = {
                        "type": "computer_call_output",
                        "call_id": c.call_id,
                    }
                    if c.output:
                        item["output"] = c.output
                    items.append(item)
                elif c.type == "computer_call":
                    _flush_responses_message(inp.role, message_parts, items)
                    item = {
                        "type": "computer_call",
                        "call_id": c.call_id,
                    }
                    if c.actions:
                        item["action"] = c.actions[0]
                    items.append(item)
                elif c.type == "function_call":
                    _flush_responses_message(inp.role, message_parts, items)
                    arguments = c.arguments
                    if not isinstance(arguments, str):
                        arguments = _serialize_json_payload(arguments)
                    items.append(
                        {
                            "type": "function_call",
                            "call_id": c.call_id,
                            "name": c.name,
                            "arguments": arguments or "",
                        }
                    )
                elif c.type == "function_result":
                    _flush_responses_message(inp.role, message_parts, items)
                    items.append(
                        {
                            "type": "function_call_output",
                            "call_id": c.call_id,
                            "output": _serialize_json_payload(c.result),
                        }
                    )
                else:
                    part = _process_responses_content_item(c, inp.role, entry)
                    if part is not None:
                        message_parts.append(part)
            _flush_responses_message(inp.role, message_parts, items)

        # Simplify: single user text without previous_response_id → plain string
        if (
            len(items) == 1
            and items[0].get("type") == "message"
            and items[0].get("role") == "user"
            and not request.previous_response_id
        ):
            parts = items[0].get("content", [])
            if len(parts) == 1 and parts[0].get("type") == "input_text":
                return parts[0]["text"]

        return items

    @staticmethod
    def _parse_responses_response(data: dict[str, Any]) -> Response:
        """Parse a Responses API response into Response."""
        outputs: list[OutputItem] = []
        for item in data.get("output", []):
            item_type = item.get("type", "")
            if item_type == "computer_call":
                action = item.get("action")
                actions = item.get("actions")
                if action is not None:
                    actions = [action]
                outputs.append(
                    OutputItem(
                        type="computer_call",
                        call_id=item.get("call_id", ""),
                        actions=actions,
                    )
                )
            elif item_type == "message":
                for content in item.get("content", []):
                    if content.get("type") == "output_text":
                        outputs.append(
                            OutputItem(
                                type="text",
                                text=content.get("text", ""),
                                annotations=content.get("annotations") or None,
                            )
                        )
                    elif content.get("type") == "refusal":
                        outputs.append(OutputItem(type="refusal", text=content.get("refusal", "")))
            elif item_type == "function_call":
                outputs.append(
                    OutputItem(
                        type="function_call",
                        call_id=item.get("call_id", ""),
                        name=item.get("name", ""),
                        arguments=item.get("arguments", ""),
                    )
                )
            elif item_type == "web_search_call":
                outputs.append(
                    OutputItem(
                        type="web_search_call",
                        call_id=item.get("id", ""),
                        action=item.get("action") or None,
                    )
                )

        usage_data = data.get("usage") or {}
        input_tokens = usage_data.get("input_tokens", 0)
        output_tokens = usage_data.get("output_tokens", 0)
        usage = Usage(
            prompt_tokens=input_tokens,
            completion_tokens=output_tokens,
            total_tokens=usage_data.get("total_tokens", input_tokens + output_tokens),
        )

        return Response(outputs=outputs, usage=usage, payload=data)

    @staticmethod
    def _parse_responses_stream_event(event_type: str, data: dict[str, Any]) -> StreamChunk | None:
        """Parse a single Responses API SSE event into a StreamChunk."""
        handler = _RESPONSES_STREAM_EVENT_HANDLERS.get(event_type)
        if handler is not None:
            return handler(event_type, data)
        return None

    @staticmethod
    def _responses_usage_from_event(data: dict[str, Any]) -> Usage | None:
        response_data = data.get("response") if isinstance(data.get("response"), dict) else data
        usage_data = response_data.get("usage") or {}
        if not usage_data:
            return None
        input_tokens = usage_data.get("input_tokens", 0)
        output_tokens = usage_data.get("output_tokens", 0)
        return Usage(
            prompt_tokens=input_tokens,
            completion_tokens=output_tokens,
            total_tokens=usage_data.get("total_tokens", input_tokens + output_tokens),
        )

    @staticmethod
    def _responses_finish_reason_from_event(event_type: str, data: dict[str, Any]) -> str:
        response_data = data.get("response") if isinstance(data.get("response"), dict) else data
        if event_type == "response.cancelled":
            return "cancelled"
        if event_type == "response.failed":
            return "error"
        incomplete_details = response_data.get("incomplete_details") or data.get("incomplete_details") or {}
        reason = incomplete_details.get("reason")
        if reason == "max_output_tokens":
            return "length"
        if reason:
            return reason
        status = response_data.get("status") or data.get("status")
        return status or "incomplete"
