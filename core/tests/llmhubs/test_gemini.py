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
    _build_function_declarations,
    _sanitize_schema,
)
from app.llmhubs.types import Input, InputContent, ModelRegistryEntry, Request


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
