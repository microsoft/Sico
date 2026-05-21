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

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from app.llmhubs.response_format import build_response_format_option
from app.llmhubs.types import Input, InputContent, Request


def build_llm_request(
    messages: list[dict[str, Any]],
    *,
    model: str | None = None,
    response_format: Any | None = None,
    max_tokens: int | None = None,
    timeout_ms: int | float | None = None,
    **kwargs: Any,
) -> Request:
    """Convert V1-style dict messages into a Request."""
    instructions = ""
    inputs: list[Input] = []

    for msg in messages:
        role = str(msg.get("role", "user"))
        content = msg.get("content", "")

        if role == "system":
            text = _extract_system_text(content)
            instructions = f"{instructions}\n{text}".strip() if instructions else text
            continue

        inputs.append(Input(role=role, content=_convert_msg_content(content)))

    options: dict[str, Any] = {}
    if max_tokens is not None:
        options["max_output_tokens"] = max_tokens
    if timeout_ms is not None:
        options["timeout_ms"] = timeout_ms
    if response_format is not None:
        options["response_format"] = build_response_format_option(response_format)
    reasoning_effort = kwargs.pop("reasoning_effort", None)
    if reasoning_effort is not None and "reasoning" not in kwargs:
        options["reasoning"] = {"effort": reasoning_effort}
    options.update(kwargs)

    return Request(
        model=str(model) if model else "",
        instructions=instructions,
        inputs=inputs,
        options=options,
    )


def _extract_system_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, Mapping):
        return _extract_system_text([content])
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(item.get("text", ""))
        return "\n".join(parts)
    return str(content) if content else ""


def _convert_msg_content(content: Any) -> list[InputContent]:
    if isinstance(content, str):
        return [InputContent(type="text", text=content)]

    if isinstance(content, Mapping):
        return _convert_msg_content([content])

    if isinstance(content, list):
        return [_convert_single_content_item(item) for item in content]

    return [InputContent(type="text", text=str(content) if content else "")]


def _convert_single_content_item(item: Any) -> InputContent:
    if not isinstance(item, dict):
        return InputContent(type="text", text=str(item))

    item_type = str(item.get("type", "text"))
    builder = _CONTENT_ITEM_BUILDERS.get(item_type)
    if builder is not None:
        return builder(item)
    return InputContent(type="text", text=item.get("text", str(item)))


def _build_text_input_content(item: dict[str, Any]) -> InputContent:
    return InputContent(type="text", text=item.get("text", ""))


def _build_function_call_content(item: dict[str, Any]) -> InputContent:
    return InputContent(
        type="function_call",
        call_id=str(item.get("callId") or item.get("call_id") or ""),
        name=str(item.get("name") or ""),
        arguments=_maybe_parse_json(item.get("arguments")),
    )


def _build_function_result_content(item: dict[str, Any]) -> InputContent:
    return InputContent(
        type="function_result",
        call_id=str(item.get("callId") or item.get("call_id") or ""),
        name=str(item.get("name") or ""),
        result=_maybe_parse_json(item.get("result")),
    )


def _build_computer_call_output_content(item: dict[str, Any]) -> InputContent:
    output = item.get("output")
    return InputContent(
        type="computer_call_output",
        call_id=str(item.get("callId") or item.get("call_id") or ""),
        output=dict(output) if isinstance(output, Mapping) else None,
    )


def _build_computer_call_content(item: dict[str, Any]) -> InputContent:
    actions = item.get("actions")
    return InputContent(
        type="computer_call",
        call_id=str(item.get("callId") or item.get("call_id") or ""),
        name=str(item.get("name") or "computer"),
        arguments=item.get("arguments"),
        actions=actions if isinstance(actions, list) else None,
    )


def _parse_image_url_spec(item: dict[str, Any]) -> tuple[str, str]:
    detail = str(item.get("detail", "") or "")
    image_url = item.get("image_url")
    if isinstance(image_url, Mapping):
        url = str(image_url.get("url", ""))
        if not detail:
            detail = str(image_url.get("detail", "") or "")
    elif image_url is not None:
        url = str(image_url)
    else:
        url = str(item.get("image", "") or item.get("url", "") or "")
    return url, detail


def _build_image_input_content(item: dict[str, Any]) -> InputContent:
    url, detail = _parse_image_url_spec(item)
    if url.startswith("data:") and "," in url:
        header, b64 = url.split(",", 1)
        media_type = header[5:].split(";", 1)[0] if header.startswith("data:") else ""
        return InputContent(type="image", image_base64=b64, media_type=media_type, detail=detail)
    if url:
        return InputContent(type="image", image_url=url, file_url=url, detail=detail)
    return InputContent(type="image", image_url=url, detail=detail)


_CONTENT_ITEM_BUILDERS: dict[str, Any] = {
    "text": _build_text_input_content,
    "input_text": _build_text_input_content,
    "image_url": _build_image_input_content,
    "image": _build_image_input_content,
    "input_image": _build_image_input_content,
    "function_call": _build_function_call_content,
    "function_result": _build_function_result_content,
    "computer_call_output": _build_computer_call_output_content,
    "computer_call": _build_computer_call_content,
}


def _maybe_parse_json(value: Any) -> Any:
    if not isinstance(value, str):
        return value

    stripped = value.strip()
    if not stripped:
        return ""
    if stripped[0] not in '[{"0123456789tfn-':
        return value

    try:
        return json.loads(stripped)
    except (TypeError, ValueError):
        return value
