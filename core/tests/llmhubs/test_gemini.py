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

import json

from app.llmhubs.adapters.gemini import (
    GeminiAdapter,
    _build_call_id_name_map,
    _build_call_id_realid_map,
    _build_function_declarations,
    _content_to_part,
    _sanitize_schema,
)
from app.llmhubs.types import Input, InputContent, ModelRegistryEntry, OutputItem, Request


def _has_key(node: object, key: str) -> bool:
    """Return True if *key* appears anywhere in the nested dict/list *node*."""
    if isinstance(node, dict):
        if key in node:
            return True
        return any(_has_key(v, key) for v in node.values())
    if isinstance(node, list):
        return any(_has_key(v, key) for v in node)
    return False


def _model_entry(**config) -> ModelRegistryEntry:
    return ModelRegistryEntry(
        model_key="gemini-2.5-flash",
        display_name="Gemini 2.5 Flash",
        model_type=1,
        provider_template_type=7,
        config={"upstream_model_name": "gemini-2.5-flash", **config},
        secrets={"api_key": "test-key"},
    )


_WEATHER_TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the current weather for a city.",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}


def test_prepare_request_builds_function_declarations_and_tool_config() -> None:
    request = Request(
        model="gemini-2.5-flash",
        inputs=[Input(role="user", content=[InputContent(type="text", text="Weather in Tokyo?")])],
        tools=[_WEATHER_TOOL],
        options={"tool_choice": "auto"},
    )

    _url, body, _headers, _timeout = GeminiAdapter()._prepare_request(request, _model_entry())

    assert body["tools"] == [
        {
            "functionDeclarations": [
                {
                    "name": "get_weather",
                    "description": "Get the current weather for a city.",
                    "parameters": {
                        "type": "object",
                        "properties": {"city": {"type": "string"}},
                        "required": ["city"],
                    },
                }
            ]
        }
    ]
    assert body["toolConfig"] == {"functionCallingConfig": {"mode": "AUTO"}}


def test_prepare_request_maps_specific_tool_choice_to_allowed_function_names() -> None:
    request = Request(
        model="gemini-2.5-flash",
        inputs=[Input(role="user", content=[InputContent(type="text", text="hi")])],
        tools=[_WEATHER_TOOL],
        options={"tool_choice": {"type": "function", "function": {"name": "get_weather"}}},
    )

    _url, body, _headers, _timeout = GeminiAdapter()._prepare_request(request, _model_entry())

    assert body["toolConfig"] == {"functionCallingConfig": {"mode": "ANY", "allowedFunctionNames": ["get_weather"]}}


def test_prepare_request_without_tools_omits_tool_fields() -> None:
    request = Request(
        model="gemini-2.5-flash",
        inputs=[Input(role="user", content=[InputContent(type="text", text="hi")])],
    )

    _url, body, _headers, _timeout = GeminiAdapter()._prepare_request(request, _model_entry())

    assert "tools" not in body
    assert "toolConfig" not in body


def test_build_contents_maps_function_call_and_result() -> None:
    request = Request(
        model="gemini-2.5-flash",
        inputs=[
            Input(role="user", content=[InputContent(type="text", text="Weather in Tokyo?")]),
            Input(
                role="assistant",
                content=[
                    InputContent(
                        type="function_call",
                        call_id="call-1",
                        name="get_weather",
                        arguments='{"city": "Tokyo"}',
                    )
                ],
            ),
            Input(
                role="tool",
                content=[
                    # ``function_result`` carries only the call_id; the name must be
                    # recovered from the matching function_call.
                    InputContent(
                        type="function_result",
                        call_id="call-1",
                        result={"temperature": 30},
                    )
                ],
            ),
        ],
    )

    contents = GeminiAdapter()._build_contents(request)

    assert contents == [
        {"role": "user", "parts": [{"text": "Weather in Tokyo?"}]},
        {
            "role": "model",
            "parts": [{"functionCall": {"name": "get_weather", "args": {"city": "Tokyo"}}}],
        },
        {
            "role": "user",
            "parts": [{"functionResponse": {"name": "get_weather", "response": {"temperature": 30}}}],
        },
    ]


def test_build_contents_wraps_scalar_function_result() -> None:
    request = Request(
        model="gemini-2.5-flash",
        inputs=[
            Input(
                role="tool",
                content=[
                    InputContent(
                        type="function_result",
                        call_id="call-1",
                        name="get_weather",
                        result="sunny",
                    )
                ],
            ),
        ],
    )

    contents = GeminiAdapter()._build_contents(request)

    assert contents == [
        {
            "role": "user",
            "parts": [{"functionResponse": {"name": "get_weather", "response": {"result": "sunny"}}}],
        },
    ]


def test_parse_response_extracts_function_call() -> None:
    data = {
        "candidates": [
            {
                "content": {
                    "role": "model",
                    "parts": [{"functionCall": {"name": "get_weather", "args": {"city": "Tokyo"}}}],
                }
            }
        ],
        "usageMetadata": {"promptTokenCount": 5, "candidatesTokenCount": 7, "totalTokenCount": 12},
    }

    response = GeminiAdapter._parse_response(data)

    assert len(response.outputs) == 1
    output = response.outputs[0]
    assert output.type == "function_call"
    assert output.name == "get_weather"
    assert json.loads(output.arguments) == {"city": "Tokyo"}
    assert output.call_id == "gemini-get_weather-0"
    assert response.usage.total_tokens == 12


def test_parse_response_extracts_text() -> None:
    data = {"candidates": [{"content": {"parts": [{"text": "hello"}]}}]}

    response = GeminiAdapter._parse_response(data)

    assert response.text == "hello"


def test_validate_request_allows_tools() -> None:
    request = Request(
        model="gemini-2.5-flash",
        inputs=[Input(role="user", content=[InputContent(type="text", text="hi")])],
        tools=[_WEATHER_TOOL],
    )

    # Should not raise now that Gemini supports tools.
    GeminiAdapter._validate_request(request)


def test_sanitize_schema_inlines_refs_and_strips_unsupported_keys() -> None:
    parameters = {
        "type": "object",
        "$defs": {
            "Point": {
                "type": "object",
                "properties": {"x": {"type": "integer"}, "y": {"type": "integer"}},
                "additionalProperties": False,
            }
        },
        "properties": {
            "origin": {"$ref": "#/$defs/Point"},
            "tags": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["origin"],
        "additionalProperties": False,
    }

    decls = _build_function_declarations(
        [{"type": "function", "function": {"name": "plot", "parameters": parameters}}]
    )
    params = decls[0]["parameters"]

    # No unsupported keywords survive anywhere in the tree.
    assert not _has_key(params, "$defs")
    assert not _has_key(params, "$ref")
    assert not _has_key(params, "additionalProperties")
    # The reference was inlined.
    assert params["properties"]["origin"]["type"] == "object"
    assert params["properties"]["origin"]["properties"]["x"] == {"type": "integer"}
    assert params["properties"]["tags"] == {"type": "array", "items": {"type": "string"}}
    assert params["required"] == ["origin"]


def test_sanitize_schema_flattens_single_allof() -> None:
    schema = {
        "type": "object",
        "$defs": {"Inner": {"type": "object", "properties": {"n": {"type": "integer"}}}},
        "properties": {
            "field": {"allOf": [{"$ref": "#/$defs/Inner"}], "description": "an inner"},
        },
    }

    out = _sanitize_schema(schema)
    field = out["properties"]["field"]

    assert field["type"] == "object"
    assert field["description"] == "an inner"
    assert field["properties"]["n"] == {"type": "integer"}
    assert not _has_key(out, "$ref")


def test_sanitize_schema_handles_recursive_ref() -> None:
    schema = {
        "type": "object",
        "$defs": {"Node": {"type": "object", "properties": {"child": {"$ref": "#/$defs/Node"}}}},
        "properties": {"root": {"$ref": "#/$defs/Node"}},
    }

    # Must terminate (no infinite recursion) and drop all refs/defs.
    out = _sanitize_schema(schema)
    assert not _has_key(out, "$ref")
    assert not _has_key(out, "$defs")


def test_prepare_request_maps_json_schema_response_format() -> None:
    schema = {
        "type": "object",
        "$defs": {"Route": {"type": "string", "enum": ["fast", "task"]}},
        "properties": {"route": {"$ref": "#/$defs/Route"}, "confidence": {"type": "number"}},
        "required": ["route"],
        "additionalProperties": False,
    }
    request = Request(
        model="gemini-2.5-flash",
        inputs=[Input(role="user", content=[InputContent(type="text", text="classify")])],
        options={
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "Intent", "schema": schema, "strict": True},
            }
        },
    )

    _url, body, _headers, _timeout = GeminiAdapter()._prepare_request(request, _model_entry())
    gen = body["generationConfig"]

    assert gen["responseMimeType"] == "application/json"
    response_schema = gen["responseSchema"]
    assert not _has_key(response_schema, "$defs")
    assert not _has_key(response_schema, "$ref")
    assert not _has_key(response_schema, "additionalProperties")
    # The ref was inlined into the response schema.
    assert response_schema["properties"]["route"] == {"type": "string", "enum": ["fast", "task"]}
    assert response_schema["required"] == ["route"]


def test_prepare_request_json_object_sets_mime_only() -> None:
    request = Request(
        model="gemini-2.5-flash",
        inputs=[Input(role="user", content=[InputContent(type="text", text="hi")])],
        options={"response_format": {"type": "json_object"}},
    )

    _url, body, _headers, _timeout = GeminiAdapter()._prepare_request(request, _model_entry())
    gen = body["generationConfig"]

    assert gen["responseMimeType"] == "application/json"
    assert "responseSchema" not in gen


def test_validate_request_allows_json_schema_response_format() -> None:
    request = Request(
        model="gemini-2.5-flash",
        inputs=[Input(role="user", content=[InputContent(type="text", text="hi")])],
        options={"response_format": {"type": "json_schema", "json_schema": {"schema": {"type": "object"}}}},
    )

    # Should not raise now that Gemini supports structured output.
    GeminiAdapter._validate_request(request)


def test_sanitize_schema_optional_becomes_nullable() -> None:
    schema = {
        "type": "object",
        "properties": {
            "note": {"anyOf": [{"type": "string"}, {"type": "null"}], "description": "optional note"},
        },
    }

    out = _sanitize_schema(schema)
    note = out["properties"]["note"]

    assert note["type"] == "string"
    assert note["nullable"] is True
    assert note["description"] == "optional note"
    assert "anyOf" not in note


def test_sanitize_schema_optional_ref_becomes_nullable() -> None:
    schema = {
        "type": "object",
        "$defs": {"Point": {"type": "object", "properties": {"x": {"type": "integer"}}}},
        "properties": {
            "origin": {"anyOf": [{"$ref": "#/$defs/Point"}, {"type": "null"}]},
        },
    }

    out = _sanitize_schema(schema)
    origin = out["properties"]["origin"]

    assert origin["type"] == "object"
    assert origin["nullable"] is True
    assert origin["properties"]["x"] == {"type": "integer"}
    assert not _has_key(out, "$ref")
    assert not _has_key(out, "$defs")


def test_sanitize_schema_multi_union_with_null_keeps_anyof() -> None:
    schema = {"anyOf": [{"type": "string"}, {"type": "integer"}, {"type": "null"}]}

    out = _sanitize_schema(schema)

    assert out["nullable"] is True
    assert out["anyOf"] == [{"type": "string"}, {"type": "integer"}]
    assert all(sub.get("type") != "null" for sub in out["anyOf"])


def test_sanitize_schema_union_without_null_is_unchanged() -> None:
    schema = {"anyOf": [{"type": "string"}, {"type": "integer"}]}

    out = _sanitize_schema(schema)

    assert out == {"anyOf": [{"type": "string"}, {"type": "integer"}]}
    assert "nullable" not in out


# ---------------------------------------------------------------------------
# Function-call id + thoughtSignature round trip (provider_metadata passthrough)
# ---------------------------------------------------------------------------


def test_parse_response_preserves_real_call_id_and_part() -> None:
    data = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "functionCall": {
                                "id": "call_abc",
                                "name": "get_weather",
                                "args": {"city": "Tokyo"},
                            },
                            "thoughtSignature": "SIGNATURE==",
                        }
                    ]
                }
            }
        ]
    }

    resp = GeminiAdapter._parse_response(data)

    assert len(resp.outputs) == 1
    out = resp.outputs[0]
    assert out.type == "function_call"
    assert out.call_id == "call_abc"  # comment 1: real id preserved, not synthesized
    assert out.name == "get_weather"
    part = out.provider_metadata["gemini"]["part"]
    assert part["functionCall"]["id"] == "call_abc"
    assert part["thoughtSignature"] == "SIGNATURE=="  # comment 3: signature preserved


def test_parse_response_synthesizes_call_id_when_missing() -> None:
    data = {
        "candidates": [
            {"content": {"parts": [{"functionCall": {"name": "get_weather", "args": {"city": "Paris"}}}]}}
        ]
    }

    resp = GeminiAdapter._parse_response(data)

    out = resp.outputs[0]
    assert out.call_id == "gemini-get_weather-0"  # legacy fallback
    assert "id" not in out.provider_metadata["gemini"]["part"]["functionCall"]


def test_content_to_part_replays_original_part_verbatim() -> None:
    original = {
        "functionCall": {"id": "call_abc", "name": "get_weather", "args": {"city": "Tokyo"}},
        "thoughtSignature": "SIGNATURE==",
    }
    c = InputContent(
        type="function_call",
        call_id="call_abc",
        name="get_weather",
        arguments='{"city": "Tokyo"}',
        provider_metadata={"gemini": {"part": original}},
    )

    part = _content_to_part(c, {}, {})

    # comments 2/3: the original Part (id + thoughtSignature) is replayed unchanged.
    assert part == original


def test_content_to_part_reconstructs_when_no_provider_metadata() -> None:
    c = InputContent(type="function_call", call_id="x", name="get_weather", arguments='{"city": "Tokyo"}')

    part = _content_to_part(c, {}, {})

    assert part == {"functionCall": {"name": "get_weather", "args": {"city": "Tokyo"}}}
    assert "id" not in part["functionCall"]


def test_function_response_echoes_real_id() -> None:
    c = InputContent(type="function_result", call_id="call_abc", name="get_weather", result={"tempC": 20})

    part = _content_to_part(c, {"call_abc": "get_weather"}, {"call_abc": "call_abc"})

    assert part["functionResponse"]["name"] == "get_weather"
    assert part["functionResponse"]["id"] == "call_abc"


def test_function_response_omits_synthetic_id() -> None:
    c = InputContent(type="function_result", call_id="gemini-get_weather-0", name="get_weather", result={"tempC": 20})

    # No real-id mapping → this call had a synthesized id which must NOT be echoed.
    part = _content_to_part(c, {}, {})

    assert "id" not in part["functionResponse"]


def test_build_call_id_realid_map_only_keeps_real_ids() -> None:
    request = Request(
        inputs=[
            Input(
                role="assistant",
                content=[
                    InputContent(
                        type="function_call",
                        call_id="call_abc",
                        name="f",
                        provider_metadata={"gemini": {"part": {"functionCall": {"id": "call_abc", "name": "f"}}}},
                    ),
                    InputContent(type="function_call", call_id="gemini-g-1", name="g"),  # synthesized, no part
                ],
            )
        ]
    )

    assert _build_call_id_realid_map(request) == {"call_abc": "call_abc"}


def test_parallel_same_function_calls_stay_distinct() -> None:
    part_a = {"functionCall": {"id": "call_A", "name": "search", "args": {"q": "a"}}, "thoughtSignature": "SA"}
    part_b = {"functionCall": {"id": "call_B", "name": "search", "args": {"q": "b"}}, "thoughtSignature": "SB"}
    request = Request(
        inputs=[
            Input(
                role="assistant",
                content=[
                    InputContent(
                        type="function_call", call_id="call_A", name="search",
                        arguments='{"q": "a"}', provider_metadata={"gemini": {"part": part_a}},
                    ),
                    InputContent(
                        type="function_call", call_id="call_B", name="search",
                        arguments='{"q": "b"}', provider_metadata={"gemini": {"part": part_b}},
                    ),
                ],
            ),
            Input(
                role="tool",
                content=[
                    InputContent(type="function_result", call_id="call_A", name="search", result={"r": "a"}),
                    InputContent(type="function_result", call_id="call_B", name="search", result={"r": "b"}),
                ],
            ),
        ]
    )
    name_map = _build_call_id_name_map(request)
    real_id_map = _build_call_id_realid_map(request)

    # Assistant calls replay verbatim with their distinct ids + signatures.
    assert _content_to_part(request.inputs[0].content[0], name_map, real_id_map) == part_a
    assert _content_to_part(request.inputs[0].content[1], name_map, real_id_map) == part_b
    # Each tool response carries the matching real id.
    fr_a = _content_to_part(request.inputs[1].content[0], name_map, real_id_map)
    fr_b = _content_to_part(request.inputs[1].content[1], name_map, real_id_map)
    assert fr_a["functionResponse"]["id"] == "call_A"
    assert fr_b["functionResponse"]["id"] == "call_B"


def test_chat_client_round_trips_provider_metadata() -> None:
    # End-to-end plumbing: OutputItem → agent_framework Content → InputContent.
    # Also verifies agent_framework preserves Content.additional_properties.
    from app.llmhubs.chat_client import _build_function_call_input, _output_function_call_to_content

    pm = {
        "gemini": {
            "part": {
                "functionCall": {"id": "call_abc", "name": "f", "args": {}},
                "thoughtSignature": "SIG",
            }
        }
    }
    out = OutputItem(type="function_call", call_id="call_abc", name="f", arguments="{}", provider_metadata=pm)

    content = _output_function_call_to_content(out)
    assert content.additional_properties["provider_metadata"] == pm

    back = _build_function_call_input(content)
    assert back.type == "function_call"
    assert back.call_id == "call_abc"
    assert back.provider_metadata == pm


# ---------------------------------------------------------------------------
# Schema sanitizer: allowlist + const/format handling (Comment 1)
# ---------------------------------------------------------------------------


def test_sanitize_schema_const_becomes_enum() -> None:
    # Literal["fixed"] -> {"const": "fixed"}; Gemini has no const, so use enum.
    assert _sanitize_schema({"const": "fixed"}) == {"enum": ["fixed"], "type": "string"}


def test_sanitize_schema_numeric_const_drops_enum() -> None:
    # Gemini's enum accepts strings only, so a numeric literal keeps its type
    # but drops the (unrepresentable) enum constraint.
    assert _sanitize_schema({"const": 3}) == {"type": "integer"}


def test_sanitize_schema_bool_const_drops_enum() -> None:
    assert _sanitize_schema({"const": True}) == {"type": "boolean"}


def test_sanitize_schema_null_const_becomes_null_type() -> None:
    # Literal[None] -> {"const": None}. Gemini's Type enum includes NULL, so keep
    # the null requirement as {"type": "null"} instead of dropping it.
    assert _sanitize_schema({"const": None}) == {"type": "null"}


def test_sanitize_schema_null_type_preserved() -> None:
    # A null-only type (scalar "null" or ["null"]) is a valid Gemini Type.
    assert _sanitize_schema({"type": "null"}) == {"type": "null"}
    assert _sanitize_schema({"type": ["null"]}) == {"type": "null"}


def test_sanitize_schema_all_null_anyof_becomes_null_type() -> None:
    # An anyOf whose only branch is null keeps the null requirement as type: null.
    assert _sanitize_schema({"anyOf": [{"type": "null"}]}) == {"type": "null"}


def test_sanitize_schema_nullable_oneof_becomes_nullable() -> None:
    # oneOf is rewritten to anyOf; a string|null union collapses to a scalar type
    # plus nullable, retaining the null option (not an unconstrained {} branch).
    assert _sanitize_schema({"oneOf": [{"type": "string"}, {"type": "null"}]}) == {
        "type": "string",
        "nullable": True,
    }


def test_sanitize_schema_data_keys_preserved() -> None:
    # default/example hold literal data, not sub-schemas; their (non-keyword)
    # keys must survive rather than being stripped by the field allowlist.
    schema = {"type": "object", "default": {"mode": "fast"}, "example": {"k": 1}}
    assert _sanitize_schema(schema) == {
        "type": "object",
        "default": {"mode": "fast"},
        "example": {"k": 1},
    }


def test_sanitize_schema_int_enum_drops_enum() -> None:
    # IntEnum -> integer-valued enum, which Gemini's string-only enum rejects.
    assert _sanitize_schema({"type": "integer", "enum": [1, 2, 3]}) == {"type": "integer"}


def test_sanitize_schema_string_enum_kept() -> None:
    assert _sanitize_schema({"type": "string", "enum": ["a", "b"]}) == {"type": "string", "enum": ["a", "b"]}


def test_sanitize_schema_nullable_type_array() -> None:
    assert _sanitize_schema({"type": ["string", "null"]}) == {"type": "string", "nullable": True}


def test_sanitize_schema_multi_type_array_becomes_anyof() -> None:
    assert _sanitize_schema({"type": ["string", "integer"]}) == {
        "anyOf": [{"type": "string"}, {"type": "integer"}]
    }


def test_sanitize_schema_oneof_becomes_anyof() -> None:
    assert _sanitize_schema({"oneOf": [{"type": "string"}, {"type": "integer"}]}) == {
        "anyOf": [{"type": "string"}, {"type": "integer"}]
    }


def test_sanitize_schema_drops_exclusive_bounds() -> None:
    # Field(gt=0, lt=10) -> exclusiveMinimum/Maximum, which Gemini cannot represent.
    out = _sanitize_schema({"type": "integer", "exclusiveMinimum": 0, "exclusiveMaximum": 10})
    assert out == {"type": "integer"}


def test_sanitize_schema_drops_unsupported_string_format() -> None:
    # EmailStr -> {"type": "string", "format": "email"}; drop format, keep string.
    out = _sanitize_schema({"type": "string", "format": "email"})
    assert out == {"type": "string"}


def test_sanitize_schema_keeps_supported_format() -> None:
    assert _sanitize_schema({"type": "integer", "format": "int64"}) == {"type": "integer", "format": "int64"}
    assert _sanitize_schema({"type": "string", "format": "date-time"}) == {"type": "string", "format": "date-time"}


def test_sanitize_schema_drops_unrepresentable_keywords() -> None:
    out = _sanitize_schema(
        {
            "type": "array",
            "items": {"type": "number", "multipleOf": 2},
            "uniqueItems": True,
        }
    )
    assert out == {"type": "array", "items": {"type": "number"}}
    assert not _has_key(out, "uniqueItems")
    assert not _has_key(out, "multipleOf")


def test_sanitize_schema_const_inside_properties_keeps_field_names() -> None:
    schema = {
        "type": "object",
        "properties": {
            "kind": {"const": "user"},
            "name": {"type": "string"},
        },
        "required": ["kind"],
    }

    out = _sanitize_schema(schema)

    # Field names under ``properties`` must survive the allowlist.
    assert out["properties"]["kind"] == {"enum": ["user"], "type": "string"}
    assert out["properties"]["name"] == {"type": "string"}
    assert out["required"] == ["kind"]


# ---------------------------------------------------------------------------
# Signed text Part preserved + replayed (Comment 2)
# ---------------------------------------------------------------------------


def test_parse_response_preserves_signed_text_part() -> None:
    data = {"candidates": [{"content": {"parts": [{"text": "Let me think.", "thoughtSignature": "TSIG"}]}}]}

    out = GeminiAdapter._parse_response(data).outputs[0]

    assert out.type == "text"
    assert out.text == "Let me think."
    assert out.provider_metadata["gemini"]["part"]["thoughtSignature"] == "TSIG"


def test_parse_response_unsigned_text_has_no_provider_metadata() -> None:
    data = {"candidates": [{"content": {"parts": [{"text": "hello"}]}}]}

    out = GeminiAdapter._parse_response(data).outputs[0]

    assert out.type == "text"
    assert out.provider_metadata is None


def test_content_to_part_replays_signed_text_part() -> None:
    original = {"text": "Let me think.", "thoughtSignature": "TSIG"}
    c = InputContent(type="text", text="Let me think.", provider_metadata={"gemini": {"part": original}})

    assert _content_to_part(c, {}, {}) == original


def test_two_turn_signed_text_plus_function_call() -> None:
    # Gemini 3 turn: a signed thinking-text Part followed by a signed functionCall.
    data = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {"text": "I'll read the file.", "thoughtSignature": "T_TEXT"},
                        {
                            "functionCall": {"id": "call_1", "name": "read", "args": {"path": "a.txt"}},
                            "thoughtSignature": "T_CALL",
                        },
                    ]
                }
            }
        ]
    }
    outputs = GeminiAdapter._parse_response(data).outputs
    assert [o.type for o in outputs] == ["text", "function_call"]

    # Next-turn request: feed both model parts back plus a tool result.
    request = Request(
        inputs=[
            Input(
                role="assistant",
                content=[
                    InputContent(type="text", text=outputs[0].text, provider_metadata=outputs[0].provider_metadata),
                    InputContent(
                        type="function_call",
                        call_id=outputs[1].call_id,
                        name=outputs[1].name,
                        arguments=outputs[1].arguments,
                        provider_metadata=outputs[1].provider_metadata,
                    ),
                ],
            ),
            Input(
                role="tool",
                content=[InputContent(type="function_result", call_id="call_1", name="read", result={"ok": True})],
            ),
        ]
    )

    contents = GeminiAdapter()._build_contents(request)

    model_parts = contents[0]["parts"]
    # Both signed Parts replayed verbatim, as two distinct parts (not merged).
    assert len(model_parts) == 2
    assert model_parts[0] == {"text": "I'll read the file.", "thoughtSignature": "T_TEXT"}
    assert model_parts[1]["functionCall"]["id"] == "call_1"
    assert model_parts[1]["thoughtSignature"] == "T_CALL"
    # Tool response echoes the real id.
    assert contents[1]["parts"][0]["functionResponse"]["id"] == "call_1"


def test_chat_client_round_trips_text_provider_metadata() -> None:
    from app.llmhubs.chat_client import _build_text_input, _output_text_to_content

    pm = {"gemini": {"part": {"text": "thinking", "thoughtSignature": "SIG"}}}
    out = OutputItem(type="text", text="thinking", provider_metadata=pm)

    content = _output_text_to_content(out)
    assert content.additional_properties["provider_metadata"] == pm

    back = _build_text_input(content)
    assert back.type == "text"
    assert back.provider_metadata == pm


def test_content_to_part_replay_is_defensive_copy() -> None:
    original = {"functionCall": {"id": "call_1", "name": "f", "args": {"x": 1}}, "thoughtSignature": "S"}
    pm = {"gemini": {"part": original}}
    c = InputContent(type="function_call", call_id="call_1", name="f", provider_metadata=pm)

    part = _content_to_part(c, {}, {})
    part["thoughtSignature"] = "MUTATED"
    part["functionCall"]["args"]["x"] = 999

    # Mutating the emitted part must not corrupt the stored provider_metadata.
    assert pm["gemini"]["part"]["thoughtSignature"] == "S"
    assert pm["gemini"]["part"]["functionCall"]["args"]["x"] == 1
