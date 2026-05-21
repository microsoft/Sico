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

import logging
from collections.abc import Mapping
from copy import deepcopy
from typing import Any

logger = logging.getLogger(__name__)

_UNSUPPORTED_STRICT_SCHEMA_KEYWORDS = frozenset({
    "allOf", "not", "dependentRequired", "dependentSchemas", "if", "then", "else",
})


def to_strict_json_schema(schema: dict[str, Any]) -> dict[str, Any]:
    normalized = deepcopy(schema)
    _normalize_schema_node(normalized, root=normalized)
    _validate_strict_json_schema(normalized, path=())
    return normalized


def build_response_format_option(response_format: Any) -> dict[str, Any]:
    if isinstance(response_format, Mapping):
        schema = dict(response_format)
        model_name = str(schema.get("title") or "ResponseModel")
    else:
        schema, model_name = _extract_json_schema(response_format)

    return {
        "type": "json_schema",
        "json_schema": {
            "name": model_name,
            "schema": to_strict_json_schema(schema),
            "strict": True,
        },
    }


def _extract_json_schema(response_format: Any) -> tuple[dict[str, Any], str]:
    """Extract JSON Schema from a Pydantic model class or instance."""
    # Keep model classes as-is; only instances should be converted via type().
    # A blanket type(response_format) would turn a model class into ModelMetaclass,
    # which does not expose model_json_schema().
    cls = response_format if isinstance(response_format, type) else type(response_format)
    model_name = getattr(cls, "__name__", cls.__class__.__name__)

    method = getattr(cls, "model_json_schema", None)
    if not callable(method):
        raise ValueError(f"response_format {model_name!r} has no model_json_schema method")

    try:
        schema = method()
    except Exception as exc:
        logger.exception("failed to build response_format schema for %s", model_name)
        raise ValueError(f"failed to build response_format schema for {model_name}") from exc

    if not isinstance(schema, Mapping):
        raise ValueError(f"response_format {model_name!r} returned non-dict schema")

    return dict(schema), model_name


def _normalize_schema_node(node: Any, *, root: dict[str, Any]) -> None:
    if isinstance(node, dict):
        _normalize_schema_dict(node, root=root)
    elif isinstance(node, list):
        for item in node:
            _normalize_schema_node(item, root=root)


def _normalize_schema_dict(node: dict[str, Any], *, root: dict[str, Any]) -> None:
    # Strict mode forbids 'default' values in the schema.
    node.pop("default", None)

    if _inline_ref_if_needed(node, root=root):
        return

    _set_object_schema_defaults(node)
    _normalize_properties(node, root=root)

    items = node.get("items")
    if items is not None:
        _normalize_schema_node(items, root=root)

    _normalize_named_children(node, keys=("$defs", "definitions"), root=root)

    if _collapse_single_all_of(node, root=root):
        return

    _normalize_named_children(node, keys=("anyOf", "oneOf", "allOf"), root=root)


def _inline_ref_if_needed(node: dict[str, Any], *, root: dict[str, Any]) -> bool:
    ref = node.get("$ref")
    if not isinstance(ref, str) or len(node) <= 1:
        return False

    resolved = _resolve_json_ref(root, ref)
    node.update({**resolved, **node})
    node.pop("$ref", None)
    _normalize_schema_node(node, root=root)
    return True


def _set_object_schema_defaults(node: dict[str, Any]) -> None:
    node_type = node.get("type")
    has_object_type = node_type == "object" or (isinstance(node_type, list) and "object" in node_type)
    if has_object_type or "properties" in node:
        node.setdefault("additionalProperties", False)


def _normalize_properties(node: dict[str, Any], *, root: dict[str, Any]) -> None:
    properties = node.get("properties")
    if not isinstance(properties, dict):
        return

    node["required"] = list(properties.keys())
    for value in properties.values():
        _normalize_schema_node(value, root=root)


def _normalize_named_children(node: dict[str, Any], *, keys: tuple[str, ...], root: dict[str, Any]) -> None:
    for key in keys:
        children = node.get(key)
        if isinstance(children, dict):
            for value in children.values():
                _normalize_schema_node(value, root=root)
        elif isinstance(children, list):
            for value in children:
                _normalize_schema_node(value, root=root)


def _collapse_single_all_of(node: dict[str, Any], *, root: dict[str, Any]) -> bool:
    all_of = node.get("allOf")
    if not isinstance(all_of, list) or len(all_of) != 1:
        return False

    node.update({**all_of[0], **node})
    node.pop("allOf")
    _normalize_schema_node(node, root=root)
    return True


def _resolve_json_ref(root: dict[str, Any], ref: str) -> dict[str, Any]:
    if not ref.startswith("#/"):
        raise ValueError(f"Unexpected JSON schema ref: {ref!r}")

    resolved: Any = root
    for key in ref[2:].split("/"):
        if not isinstance(resolved, dict):
            raise ValueError(f"Invalid JSON schema ref path: {ref!r}")
        try:
            resolved = resolved[key]
        except KeyError:
            raise ValueError(f"JSON schema ref path not found: {ref!r}") from None

    if not isinstance(resolved, Mapping):
        raise ValueError(f"JSON schema ref did not resolve to an object: {ref!r}")

    return deepcopy(dict(resolved))


def _validate_strict_json_schema(node: Any, *, path: tuple[str, ...]) -> None:
    if not isinstance(node, dict):
        return

    if not path:
        if "anyOf" in node:
            raise ValueError("response_format root schema must not use anyOf")
        if node.get("type") != "object":
            raise ValueError("response_format root schema must be a JSON object")

    unsupported = sorted(key for key in _UNSUPPORTED_STRICT_SCHEMA_KEYWORDS if key in node)
    if unsupported:
        dotted_path = ".".join(path) if path else "<root>"
        raise ValueError(
            "response_format schema uses unsupported strict JSON schema keywords "
            f"at {dotted_path}: {', '.join(unsupported)}"
        )

    for key in ("properties", "$defs", "definitions"):
        children = node.get(key)
        if isinstance(children, dict):
            for child_key, child in children.items():
                _validate_strict_json_schema(child, path=(*path, key, str(child_key)))

    items = node.get("items")
    if isinstance(items, dict):
        _validate_strict_json_schema(items, path=(*path, "items"))

    for key in ("anyOf", "oneOf"):
        variants = node.get(key)
        if isinstance(variants, list):
            for index, variant in enumerate(variants):
                _validate_strict_json_schema(variant, path=(*path, key, str(index)))
