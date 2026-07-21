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

from typing import Any

CANCELLED_TOOL_RESULT = "Cancelled by user"


def complete_unfinished_tool_calls(
    messages: list[dict[str, Any]],
    result: str = CANCELLED_TOOL_RESULT,
) -> tuple[list[dict[str, Any]], int]:
    return _normalize_tool_calls(messages, unfinished_result=result)


def discard_unfinished_tool_calls(messages: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    return _normalize_tool_calls(messages, unfinished_result=None)


def _normalize_tool_calls(
    messages: list[dict[str, Any]],
    *,
    unfinished_result: str | None,
) -> tuple[list[dict[str, Any]], int]:
    result_call_ids = {
        content.get("call_id")
        for message in messages
        for content in message.get("contents", [])
        if isinstance(content, dict) and content.get("type") == "function_result" and content.get("call_id") is not None
    }
    pending_call_ids: list[Any] = []
    unfinished_count = 0
    normalized: list[dict[str, Any]] = []

    for message in messages:
        contents = message.get("contents")
        if not isinstance(contents, list):
            normalized.append(message)
            continue

        retained_contents: list[Any] = []
        for content in contents:
            if not isinstance(content, dict) or content.get("type") != "function_call":
                retained_contents.append(content)
                continue

            call_id = content.get("call_id")
            if call_id in result_call_ids:
                retained_contents.append(content)
                continue

            unfinished_count += 1
            if unfinished_result is not None and call_id is not None:
                retained_contents.append(content)
                if call_id not in pending_call_ids:
                    pending_call_ids.append(call_id)

        if retained_contents:
            normalized.append(message if retained_contents == contents else {**message, "contents": retained_contents})

    if unfinished_result is not None:
        normalized.extend(
            {
                "role": "tool",
                "contents": [
                    {
                        "type": "function_result",
                        "call_id": call_id,
                        "result": unfinished_result,
                    }
                ],
            }
            for call_id in pending_call_ids
        )

    return normalized, unfinished_count
