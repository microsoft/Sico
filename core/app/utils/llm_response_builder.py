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
from collections.abc import Mapping, Sequence
from typing import Any

from app.pb.llmhubs.google.protobuf import Struct
from app.pb.llmhubs.llmhubs import GenerateResponse


def build_generate_response(result: Any) -> GenerateResponse:
    response = GenerateResponse(text=extract_text(result))
    payload = to_struct_payload(result)
    if payload is not None:
        response.payload = payload
    return response


def to_struct_payload(value: Any) -> Struct | None:
    plain = to_plain_value(value)
    if plain is None:
        return None

    if not isinstance(plain, Mapping):
        if isinstance(plain, Sequence) and not isinstance(plain, str | bytes):
            plain = {"items": list(plain)}
        else:
            plain = {"value": plain}

    try:
        return Struct.from_dict(plain)
    except Exception:  # pragma: no cover - best effort serialization
        return None


def to_plain_value(value: Any, *, _seen: set[int] | None = None) -> Any:
    if value is None or isinstance(value, str | int | float | bool):
        return value

    if _seen is None:
        _seen = set()
    object_id = id(value)
    if object_id in _seen:
        return "[circular]"
    _seen.add(object_id)

    if isinstance(value, Mapping):
        return {str(key): to_plain_value(val, _seen=_seen) for key, val in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, str | bytes):
        return [to_plain_value(item, _seen=_seen) for item in value]

    converted, ok = _convert_custom_object(value, _seen)
    if ok:
        return converted

    return str(value)


def _convert_custom_object(value: Any, _seen: set[int]) -> tuple[Any, bool]:
    for attr in ("to_dict", "model_dump", "dict"):
        method = getattr(value, attr, None)
        if callable(method):
            try:
                return to_plain_value(method(), _seen=_seen), True
            except Exception:
                continue

    json_method = getattr(value, "to_json", None)
    if callable(json_method):
        try:
            raw = json_method()
            if isinstance(raw, str) and raw.strip():
                return json.loads(raw), True
        except Exception:
            pass

    if hasattr(value, "__dict__"):
        return to_plain_value(vars(value), _seen=_seen), True

    return None, False


def extract_text(payload: Any) -> str:
    text_attr = _custom_getattr(payload, "text", None)
    if isinstance(text_attr, str) and text_attr.strip():
        return text_attr.strip()

    for extractor in (_extract_from_choices, _extract_from_message, _extract_from_content):
        text = extractor(payload)
        if text:
            return text

    if isinstance(payload, Mapping):
        return _flatten_content(payload.get("content") or payload.get("text"))

    if isinstance(payload, Sequence) and not isinstance(payload, str | bytes):
        merged = "\n".join(_flatten_content(item) for item in payload)
        if merged.strip():
            return merged.strip()

    return str(payload).strip() if isinstance(payload, str | int | float | bool) else ""


def _extract_from_choices(payload: Any) -> str:
    choices = _custom_getattr(payload, "choices", None)
    if not isinstance(choices, Sequence):
        return ""
    lines = [extract_text(choice) for choice in choices]
    return "\n".join(chunk for chunk in lines if chunk)


def _extract_from_message(payload: Any) -> str:
    message_attr = _custom_getattr(payload, "message", None) or _custom_getattr(payload, "delta", None)
    if not message_attr:
        return ""
    return extract_text(message_attr)


def _extract_from_content(payload: Any) -> str:
    content_attr = _custom_getattr(payload, "content", None)
    return _flatten_content(content_attr)


def _custom_getattr(obj: Any, attr: str, default: Any = None) -> Any:
    if isinstance(obj, Mapping):
        return obj.get(attr, default)
    return getattr(obj, attr, default)


def _flatten_content(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, Mapping):
        return _flatten_mapping(content)
    if isinstance(content, Sequence) and not isinstance(content, str | bytes):
        return "\n".join(part for part in (_flatten_content(item) for item in content) if part)

    return str(content).strip()


def _flatten_mapping(content: Mapping[Any, Any]) -> str:
    if "text" in content and isinstance(content["text"], str):
        return str(content["text"]).strip()
    if "content" in content:
        return _flatten_content(content["content"])
    return ""
