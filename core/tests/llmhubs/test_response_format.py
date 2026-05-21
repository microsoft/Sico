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

"""Tests for strict JSON schema normalization used in response_format."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.llmhubs.response_format import build_response_format_option, to_strict_json_schema


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _collect_nodes(obj: Any, path: str = "root") -> list[tuple[str, dict]]:
    """Recursively collect all dict nodes with their paths."""
    results: list[tuple[str, dict]] = []
    if isinstance(obj, dict):
        results.append((path, obj))
        for k, v in obj.items():
            results.extend(_collect_nodes(v, f"{path}.{k}"))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            results.extend(_collect_nodes(v, f"{path}[{i}]"))
    return results


def _assert_strict_compliance(schema: dict[str, Any]) -> None:
    """Verify every object node satisfies OpenAI strict-mode requirements."""
    for path, node in _collect_nodes(schema):
        node_type = node.get("type")
        is_object = node_type == "object" or (isinstance(node_type, list) and "object" in node_type)

        if is_object and "properties" in node:
            # additionalProperties must be false
            assert node.get("additionalProperties") is False, (
                f"{path}: additionalProperties must be False, got {node.get('additionalProperties')}"
            )
            # required must list exactly all property keys
            assert set(node.get("required", [])) == set(node["properties"].keys()), (
                f"{path}: required keys mismatch properties"
            )

        # No 'default' values allowed
        assert "default" not in node, f"{path}: 'default' not allowed in strict schema"


# ------------------------------------------------------------------
# Test with the real TrajectoryData model
# ------------------------------------------------------------------

class TestTrajectoryDataSchema:
    """Ensure TrajectoryData produces a valid strict schema."""

    def test_build_response_format_option(self) -> None:
        from app.experiences.runner import TrajectoryData

        result = build_response_format_option(TrajectoryData)

        assert result["type"] == "json_schema"
        assert result["json_schema"]["name"] == "TrajectoryData"
        assert result["json_schema"]["strict"] is True

        schema = result["json_schema"]["schema"]
        assert schema["type"] == "object"
        _assert_strict_compliance(schema)

    def test_schema_has_expected_top_level_properties(self) -> None:
        from app.experiences.runner import TrajectoryData

        result = build_response_format_option(TrajectoryData)
        props = result["json_schema"]["schema"]["properties"]

        expected = {
            "task", "success", "total_steps", "chronological_steps",
            "final_output", "error", "duration_seconds", "agent_type",
            "all_cited_bullet_ids", "metadata", "judge_result",
        }
        assert set(props.keys()) == expected


# ------------------------------------------------------------------
# Test with simple Pydantic models
# ------------------------------------------------------------------

class SimpleModel(BaseModel):
    name: str = Field(description="A name.")
    age: int = Field(description="An age.")


class NestedModel(BaseModel):
    label: str = Field(description="Label.")
    items: list[SimpleModel] = Field(default_factory=list, description="Items.")


class ModelWithOptional(BaseModel):
    value: str = Field(description="Value.")
    extra: dict[str, Any] | None = Field(default=None, description="Extra data.")


class TestSimpleModels:
    def test_simple_model(self) -> None:
        result = build_response_format_option(SimpleModel)
        schema = result["json_schema"]["schema"]
        assert schema["type"] == "object"
        assert set(schema["required"]) == {"name", "age"}
        assert schema["additionalProperties"] is False
        _assert_strict_compliance(schema)

    def test_nested_model(self) -> None:
        result = build_response_format_option(NestedModel)
        schema = result["json_schema"]["schema"]
        _assert_strict_compliance(schema)

        # The nested SimpleModel should be resolved (either via $ref or inlined)
        items_schema = schema["properties"]["items"]
        assert items_schema["type"] == "array"

    def test_model_with_optional(self) -> None:
        result = build_response_format_option(ModelWithOptional)
        schema = result["json_schema"]["schema"]
        _assert_strict_compliance(schema)

    def test_no_defaults_in_output(self) -> None:
        result = build_response_format_option(NestedModel)
        schema = result["json_schema"]["schema"]
        for path, node in _collect_nodes(schema):
            assert "default" not in node, f"{path} still has 'default'"


# ------------------------------------------------------------------
# Test to_strict_json_schema with raw dicts
# ------------------------------------------------------------------

class TestRawSchema:
    def test_adds_additional_properties_false(self) -> None:
        raw = {
            "type": "object",
            "properties": {"x": {"type": "string"}},
        }
        strict = to_strict_json_schema(raw)
        assert strict["additionalProperties"] is False
        assert strict["required"] == ["x"]

    def test_sets_required_from_properties(self) -> None:
        raw = {
            "type": "object",
            "properties": {
                "a": {"type": "string"},
                "b": {"type": "integer"},
            },
        }
        strict = to_strict_json_schema(raw)
        assert set(strict["required"]) == {"a", "b"}

    def test_removes_defaults(self) -> None:
        raw = {
            "type": "object",
            "properties": {
                "x": {"type": "string", "default": "hello"},
            },
        }
        strict = to_strict_json_schema(raw)
        assert "default" not in strict["properties"]["x"]

    def test_resolves_ref_with_siblings(self) -> None:
        raw = {
            "type": "object",
            "$defs": {
                "Inner": {
                    "type": "object",
                    "properties": {"v": {"type": "integer"}},
                },
            },
            "properties": {
                "child": {"$ref": "#/$defs/Inner", "description": "A child."},
            },
        }
        strict = to_strict_json_schema(raw)
        child = strict["properties"]["child"]
        # $ref with sibling keys should be resolved inline
        assert "$ref" not in child
        assert child["type"] == "object"
        assert "v" in child["properties"]

    def test_flattens_single_allof(self) -> None:
        raw = {
            "type": "object",
            "properties": {
                "item": {
                    "allOf": [{"type": "string"}],
                },
            },
        }
        strict = to_strict_json_schema(raw)
        assert strict["properties"]["item"]["type"] == "string"
        assert "allOf" not in strict["properties"]["item"]

    def test_sets_additional_properties_false_when_absent(self) -> None:
        """When additionalProperties is not set, setdefault adds False."""
        raw = {
            "type": "object",
            "properties": {
                "data": {
                    "type": "object",
                },
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                    },
                },
            },
        }
        strict = to_strict_json_schema(raw)
        assert strict["properties"]["data"]["additionalProperties"] is False
        assert strict["properties"]["items"]["items"]["additionalProperties"] is False

    def test_preserves_existing_additional_properties(self) -> None:
        """setdefault does not override an existing additionalProperties value."""
        raw = {
            "type": "object",
            "properties": {
                "data": {
                    "type": "object",
                    "additionalProperties": True,
                },
            },
        }
        strict = to_strict_json_schema(raw)
        # setdefault preserves the existing True value
        assert strict["properties"]["data"]["additionalProperties"] is True
