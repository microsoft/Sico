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

"""Google Gemini adapter (provider_template_type=7).

Supports the Gemini generateContent REST API.
"""

from __future__ import annotations

import copy
import json
import logging
from typing import Any

from app.llmhubs.adapters.base import BaseAdapter, detect_media_type
from app.llmhubs.types import (
    InputContent,
    ModelRegistryEntry,
    OutputItem,
    Request,
    Response,
    Usage,
)

logger = logging.getLogger(__name__)

_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com"

# OpenAI-style ``tool_choice`` string → Gemini functionCallingConfig.mode.
_TOOL_CHOICE_MODE_MAP = {"auto": "AUTO", "none": "NONE", "required": "ANY"}

# Fields Gemini's OpenAPI-subset ``Schema`` accepts (google-genai ``types.Schema``).
# Anything else is dropped rather than forwarded, because Gemini rejects the whole
# request when it sees an unknown field.
_GEMINI_SCHEMA_ALLOWED_KEYS = frozenset(
    {
        "type", "format", "title", "description", "nullable", "default", "enum",
        "items", "minItems", "maxItems",
        "properties", "required", "propertyOrdering", "minProperties", "maxProperties",
        "minimum", "maximum", "minLength", "maxLength", "pattern", "anyOf", "example",
    }
)
# ``format`` values Gemini accepts; unsupported ones (email/uri/uuid/date/binary/...)
# are dropped while the base ``type`` is kept.
_GEMINI_ALLOWED_FORMATS = frozenset({"date-time", "int32", "int64", "float", "double"})


def _resolve_ref(ref: str, defs: dict[str, Any]) -> dict[str, Any] | None:
    """Resolve a ``#/$defs/Name`` reference against the collected definitions."""
    prefix = "#/$defs/"
    if ref.startswith(prefix):
        target = defs.get(ref[len(prefix):])
        if isinstance(target, dict):
            return target
    return None


def _normalize_optional(schema: dict[str, Any]) -> dict[str, Any] | None:
    """Rewrite a Pydantic ``Optional`` (``anyOf`` with a null branch) via ``nullable``.

    Returns the rewritten schema, or ``None`` if *schema* is not this pattern.
    """
    any_of = schema.get("anyOf")
    if not isinstance(any_of, list):
        return None
    non_null = [s for s in any_of if not (isinstance(s, dict) and s.get("type") == "null")]
    if len(non_null) == len(any_of):
        return None
    rest = {k: v for k, v in schema.items() if k != "anyOf"}
    if len(non_null) == 1 and isinstance(non_null[0], dict):
        return {**non_null[0], **rest, "nullable": True}
    if non_null:
        return {**rest, "anyOf": non_null, "nullable": True}
    return {**rest, "nullable": True}


def _json_type_of(value: Any) -> str:
    """Best-effort JSON-Schema ``type`` for a literal ``const`` value."""
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    return "string"


def _reduce_to_gemini_fields(schema: dict[str, Any]) -> dict[str, Any]:
    """Reduce one schema node to the fields Gemini's ``Schema`` accepts.

    Converts a single-value ``const`` to ``enum`` (adding ``type`` when absent),
    drops ``format`` values Gemini rejects while keeping the base ``type``, and
    filters remaining keys against an explicit allowlist. Constraints Gemini
    cannot represent (``exclusiveMinimum``/``exclusiveMaximum``, ``multipleOf``,
    ``uniqueItems``, ...) fall outside the allowlist and are dropped.
    """
    reduced = dict(schema)
    if "const" in reduced:
        const_value = reduced.pop("const")
        reduced.setdefault("enum", [const_value])
        reduced.setdefault("type", _json_type_of(const_value))
    fmt = reduced.get("format")
    if isinstance(fmt, str) and fmt not in _GEMINI_ALLOWED_FORMATS:
        reduced.pop("format")
    return {key: value for key, value in reduced.items() if key in _GEMINI_SCHEMA_ALLOWED_KEYS}


def _sanitize_schema(
    schema: Any,
    defs: dict[str, Any] | None = None,
    seen: frozenset[str] = frozenset(),
) -> Any:
    """Rewrite a JSON Schema into Gemini's supported subset.

    Pydantic-generated schemas use ``$ref``/``$defs`` references, ``allOf``
    wrappers, ``anyOf`` null branches, and keywords (``const``,
    ``exclusiveMinimum``, unsupported ``format`` values, ...) that Gemini's
    ``Schema`` rejects. This inlines references, flattens single-element
    ``allOf`` wrappers, converts Optional to ``nullable`` and ``const`` to
    ``enum``, and keeps only Gemini-supported fields (allowlist).
    """
    if defs is None:
        defs = schema.get("$defs", {}) if isinstance(schema, dict) else {}

    if isinstance(schema, list):
        return [_sanitize_schema(item, defs, seen) for item in schema]
    if not isinstance(schema, dict):
        return schema

    # Inline ``$ref`` (merging any sibling keys over the referenced schema).
    ref = schema.get("$ref")
    if isinstance(ref, str):
        siblings = {k: v for k, v in schema.items() if k != "$ref"}
        target = _resolve_ref(ref, defs)
        if target is None or ref in seen:
            # Unresolvable or recursive reference -> generic object fallback.
            merged, next_seen = {"type": "object", **siblings}, seen
        else:
            merged, next_seen = {**target, **siblings}, seen | {ref}
        return _sanitize_schema(merged, defs, next_seen)

    # Flatten a single-element ``allOf`` wrapper (common Pydantic pattern).
    all_of = schema.get("allOf")
    if isinstance(all_of, list) and len(all_of) == 1 and isinstance(all_of[0], dict):
        merged = {**all_of[0], **{k: v for k, v in schema.items() if k != "allOf"}}
        return _sanitize_schema(merged, defs, seen)

    # Convert Pydantic's Optional pattern (``anyOf`` with a null branch) to ``nullable``.
    optional = _normalize_optional(schema)
    if optional is not None:
        return _sanitize_schema(optional, defs, seen)

    reduced = _reduce_to_gemini_fields(schema)
    result: dict[str, Any] = {}
    for key, value in reduced.items():
        # ``properties`` is a map of field-name -> schema; recurse into each
        # sub-schema but keep the field names (they are not schema keywords).
        if key == "properties" and isinstance(value, dict):
            result[key] = {name: _sanitize_schema(sub, defs, seen) for name, sub in value.items()}
        else:
            result[key] = _sanitize_schema(value, defs, seen)
    return result


def _extract_json_schema(response_format: dict[str, Any]) -> dict[str, Any] | None:
    """Return the JSON Schema from an OpenAI-style ``json_schema`` response_format."""
    json_schema = response_format.get("json_schema")
    if isinstance(json_schema, dict) and isinstance(json_schema.get("schema"), dict):
        return json_schema["schema"]
    schema = response_format.get("schema")
    if isinstance(schema, dict):
        return schema
    return None


def _build_function_declarations(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert OpenAI-style function tools → Gemini ``functionDeclarations``."""
    declarations: list[dict[str, Any]] = []
    for tool in tools:
        if not isinstance(tool, dict) or tool.get("type") != "function":
            continue
        function = tool.get("function")
        if not isinstance(function, dict):
            continue
        name = function.get("name")
        if not name:
            continue
        declaration: dict[str, Any] = {"name": name}
        description = function.get("description")
        if description:
            declaration["description"] = description
        parameters = function.get("parameters")
        if isinstance(parameters, dict) and parameters:
            declaration["parameters"] = _sanitize_schema(parameters)
        declarations.append(declaration)
    return declarations


def _build_tool_config(tool_choice: Any) -> dict[str, Any] | None:
    """Convert OpenAI-style ``tool_choice`` → Gemini ``toolConfig``."""
    if tool_choice is None:
        return None
    mode: str | None = None
    allowed_names: list[str] | None = None
    if isinstance(tool_choice, str):
        mode = _TOOL_CHOICE_MODE_MAP.get(tool_choice.strip().lower())
    elif isinstance(tool_choice, dict):
        function = tool_choice.get("function")
        if isinstance(function, dict) and function.get("name"):
            mode = "ANY"
            allowed_names = [function["name"]]
    if mode is None:
        return None
    config: dict[str, Any] = {"mode": mode}
    if allowed_names:
        config["allowedFunctionNames"] = allowed_names
    return {"functionCallingConfig": config}


def _apply_tools(body: dict[str, Any], request: Request) -> None:
    """Attach Gemini ``tools``/``toolConfig`` to *body* from the request."""
    if not request.tools:
        return
    declarations = _build_function_declarations(request.tools)
    if not declarations:
        return
    body["tools"] = [{"functionDeclarations": declarations}]
    tool_config = _build_tool_config(request.options.get("tool_choice"))
    if tool_config is not None:
        body["toolConfig"] = tool_config


def _coerce_args(arguments: str | dict[str, Any] | None) -> dict[str, Any]:
    """Return a JSON object for a Gemini ``functionCall.args`` field.

    Internal ``arguments`` follow the OpenAI convention (a JSON string), while
    Gemini expects a JSON object.
    """
    if isinstance(arguments, dict):
        return arguments
    if isinstance(arguments, str) and arguments.strip():
        try:
            parsed = json.loads(arguments)
        except (ValueError, TypeError):
            return {}
        if isinstance(parsed, dict):
            return parsed
    return {}


def _coerce_response(result: Any) -> dict[str, Any]:
    """Return a JSON object for a Gemini ``functionResponse.response`` field."""
    if isinstance(result, dict):
        return result
    if isinstance(result, str) and result.strip():
        try:
            parsed = json.loads(result)
        except (ValueError, TypeError):
            return {"result": result}
        if isinstance(parsed, dict):
            return parsed
        return {"result": parsed}
    return {"result": result}


def _map_role(role: str) -> str:
    """Map internal roles to Gemini's ``user``/``model`` role set."""
    if role == "assistant":
        return "model"
    if role == "tool":
        return "user"
    return role


def _build_call_id_name_map(request: Request) -> dict[str, str]:
    """Map ``call_id`` → function name from prior function_call items.

    Gemini correlates a ``functionResponse`` by function name, but internal
    ``function_result`` items may only carry the ``call_id``; this recovers the
    name from the matching ``function_call``.
    """
    mapping: dict[str, str] = {}
    for inp in request.inputs:
        for c in inp.content:
            if c.type == "function_call" and c.call_id and c.name:
                mapping[c.call_id] = c.name
    return mapping


def _gemini_original_part(c: InputContent) -> dict[str, Any] | None:
    """Return the original Gemini ``Part`` stashed in ``provider_metadata``, if any."""
    provider_metadata = c.provider_metadata
    if not isinstance(provider_metadata, dict):
        return None
    gemini = provider_metadata.get("gemini")
    if not isinstance(gemini, dict):
        return None
    part = gemini.get("part")
    return part if isinstance(part, dict) else None


def _build_call_id_realid_map(request: Request) -> dict[str, str]:
    """Map ``call_id`` → the real Gemini ``functionCall.id`` captured on the way in.

    Only calls where Gemini actually issued an id are included; synthesized ids
    are omitted so a fabricated id is never echoed back in a ``functionResponse``.
    """
    mapping: dict[str, str] = {}
    for inp in request.inputs:
        for c in inp.content:
            if c.type != "function_call" or not c.call_id:
                continue
            part = _gemini_original_part(c)
            real_id = part.get("functionCall", {}).get("id") if part else None
            if real_id:
                mapping[c.call_id] = real_id
    return mapping


def _function_call_part(c: InputContent) -> dict[str, Any]:
    """Build a Gemini ``functionCall`` part.

    Replays Gemini's original Part verbatim when it was captured (so its opaque
    id / thoughtSignature survive the round trip); otherwise reconstructs from
    the neutral fields (legacy / non-Gemini history).
    """
    original = _gemini_original_part(c)
    if original is not None and "functionCall" in original:
        return copy.deepcopy(original)
    return {"functionCall": {"name": c.name, "args": _coerce_args(c.arguments)}}


def _text_part(c: InputContent) -> dict[str, Any]:
    """Build a Gemini text part.

    Replays Gemini's original signed text Part verbatim (keeping its
    ``thoughtSignature``) when captured; otherwise emits a plain text part.
    """
    original = _gemini_original_part(c)
    if original is not None and "text" in original:
        return copy.deepcopy(original)
    return {"text": c.text}


def _content_to_part(
    c: InputContent,
    call_id_to_name: dict[str, str],
    call_id_to_real_id: dict[str, str],
) -> dict[str, Any] | None:
    """Convert a single ``InputContent`` to a Gemini content part."""
    if c.type in ("input_text", "text") and c.text:
        return _text_part(c)
    if c.type in ("input_image", "image") and c.image_base64:
        return {
            "inlineData": {
                "mimeType": c.media_type or detect_media_type(base64_data=c.image_base64),
                "data": c.image_base64,
            },
        }
    if c.type in ("input_file", "file") and c.file_url:
        return {
            "fileData": {
                "fileUri": c.file_url,
                "mimeType": c.media_type or "application/octet-stream",
            },
        }
    if c.type == "function_call":
        return _function_call_part(c)
    if c.type == "function_result":
        name = c.name or call_id_to_name.get(c.call_id, "")
        response_part: dict[str, Any] = {"name": name, "response": _coerce_response(c.result)}
        real_id = call_id_to_real_id.get(c.call_id)
        if real_id:
            # Echo the id Gemini issued so it can match this response to the
            # correct call (disambiguates parallel calls to the same function).
            response_part["id"] = real_id
        return {"functionResponse": response_part}
    return None


def _synthesize_call_id(name: str, index: int) -> str:
    """Gemini responses omit a call id; synthesize a stable one for correlation."""
    return f"gemini-{name or 'function'}-{index}"


class GeminiAdapter(BaseAdapter):
    """Built-in adapter for Google Gemini generateContent API.

    Limitations:
    - Streaming not yet implemented (falls back to single response).
    """

    @staticmethod
    def _validate_request(request: Request) -> None:
        if request.previous_response_id:
            raise ValueError("Gemini adapter does not support previous_response_id")

        response_format = request.options.get("response_format")
        if response_format is not None:
            if not isinstance(response_format, dict):
                raise ValueError("Gemini adapter response_format must be an object")
            if response_format.get("type") not in ("json_object", "json_schema", "text"):
                raise ValueError(
                    "Gemini adapter supports response_format.type of json_object, json_schema, or text"
                )

        for inp in request.inputs:
            for c in inp.content:
                if c.type in ("input_text", "text") and c.text:
                    continue
                if c.type in ("input_image", "image") and c.image_base64:
                    continue
                if c.type in ("input_file", "file") and c.file_url:
                    continue
                if c.type in ("function_call", "function_result"):
                    continue
                if c.type in ("input_image", "image") and c.image_url:
                    raise ValueError("Gemini adapter does not support remote image URLs")
                if c.type in ("input_file", "file") and c.file_base64:
                    raise ValueError("Gemini adapter does not support base64 file inputs")
                if c.type not in ("input_text", "text", "input_image", "image", "input_file", "file"):
                    raise ValueError(f"Gemini adapter does not support content type '{c.type}'")

    async def generate(self, request: Request, entry: ModelRegistryEntry) -> Response:
        self._validate_request(request)
        url, body, headers, timeout = self._prepare_request(request, entry)

        resp = await self._post(url, json=body, headers=headers, timeout=timeout)
        data = resp.json()

        return self._parse_response(data)

    def _prepare_request(
        self,
        request: Request,
        entry: ModelRegistryEntry,
    ) -> tuple[str, dict[str, Any], dict[str, str], float | None]:
        base_url = entry.config.get("base_url", _DEFAULT_BASE_URL).rstrip("/")
        api_version = entry.config.get("api_version", "v1beta")
        upstream_model = entry.config.get("upstream_model_name", entry.model_key)
        timeout = self._resolve_timeout(request, entry)

        body: dict[str, Any] = {
            "contents": self._build_contents(request),
        }

        if request.instructions:
            body["systemInstruction"] = {
                "parts": [{"text": request.instructions}],
            }

        generation_config: dict[str, Any] = {}
        if request.options.get("temperature") is not None:
            generation_config["temperature"] = request.options["temperature"]
        max_tokens = self._resolve_max_tokens(request, entry)
        if max_tokens is not None:
            generation_config["maxOutputTokens"] = max_tokens
        for key, gemini_key in (("top_p", "topP"), ("top_k", "topK")):
            if key in request.options:
                generation_config[gemini_key] = request.options[key]
        wants_logprobs = bool(request.options.get("logprobs"))
        top_logprobs = request.options.get("top_logprobs")
        if wants_logprobs or top_logprobs is not None:
            generation_config["responseLogprobs"] = True
        if top_logprobs is not None:
            generation_config["logprobs"] = top_logprobs
        if request.options.get("stop") is not None:
            generation_config["stopSequences"] = request.options["stop"]
        response_format = request.options.get("response_format")
        if isinstance(response_format, dict):
            fmt_type = response_format.get("type")
            if fmt_type in ("json_object", "json_schema"):
                generation_config["responseMimeType"] = "application/json"
            if fmt_type == "json_schema":
                schema = _extract_json_schema(response_format)
                if schema:
                    generation_config["responseSchema"] = _sanitize_schema(schema)

        if generation_config:
            body["generationConfig"] = generation_config

        _apply_tools(body, request)

        headers = {"Content-Type": "application/json"}
        headers.update(self._build_auth_headers(entry))
        headers.update(entry.config.get("default_headers", {}))

        url = f"{base_url}/{api_version}/models/{upstream_model}:generateContent"
        api_key = (
            entry.secrets.get("api_key_value")
            or entry.secrets.get("api_key")
            or entry.config.get("api_key_value", "")
            or entry.config.get("api_key", "")
        )
        if api_key:
            headers.pop("Authorization", None)
            headers.pop("x-api-key", None)
            headers["x-goog-api-key"] = api_key

        return url, body, headers, timeout

    # ------------------------------------------------------------------

    def _build_contents(self, request: Request) -> list[dict[str, Any]]:
        call_id_to_name = _build_call_id_name_map(request)
        call_id_to_real_id = _build_call_id_realid_map(request)
        contents: list[dict[str, Any]] = []

        for inp in request.inputs:
            parts: list[dict[str, Any]] = []
            for c in inp.content:
                part = _content_to_part(c, call_id_to_name, call_id_to_real_id)
                if part is not None:
                    parts.append(part)

            if parts:
                # Gemini uses "user"/"model" roles (not "assistant"/"tool").
                contents.append({"role": _map_role(inp.role), "parts": parts})

        return contents

    @staticmethod
    def _parse_response(data: dict[str, Any]) -> Response:
        outputs: list[OutputItem] = []
        candidates = data.get("candidates", [])
        if candidates:
            content = candidates[0].get("content", {})
            for index, part in enumerate(content.get("parts", [])):
                function_call = part.get("functionCall")
                if function_call:
                    name = function_call.get("name", "")
                    args = function_call.get("args", {})
                    arguments = json.dumps(args, ensure_ascii=False) if isinstance(args, dict) else str(args or "")
                    outputs.append(
                        OutputItem(
                            type="function_call",
                            # Prefer the id Gemini issued; synthesize only as a
                            # legacy fallback for models that omit it.
                            call_id=function_call.get("id") or _synthesize_call_id(name, index),
                            name=name,
                            arguments=arguments,
                            # Stash the original Part so its opaque id /
                            # thoughtSignature can be replayed verbatim next turn.
                            provider_metadata={"gemini": {"part": part}},
                        )
                    )
                elif "text" in part:
                    # Preserve a signed thinking-text Part so its thoughtSignature
                    # can be replayed verbatim (Gemini 3 requires it echoed back).
                    provider_metadata = {"gemini": {"part": part}} if "thoughtSignature" in part else None
                    outputs.append(OutputItem(type="text", text=part["text"], provider_metadata=provider_metadata))

        usage_data = data.get("usageMetadata", {})
        usage = Usage(
            prompt_tokens=usage_data.get("promptTokenCount", 0),
            completion_tokens=usage_data.get("candidatesTokenCount", 0),
            total_tokens=usage_data.get("totalTokenCount", 0),
        )

        return Response(outputs=outputs, usage=usage, payload=data)
