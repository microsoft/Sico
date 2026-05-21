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

"""Custom JSON API adapter (provider_template_type=4).

Uses admin-defined request_field_mapping and response_extraction.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from typing import Any

from jsonpath_ng.ext import parse as parse_jsonpath

from app.llmhubs.adapters.base import BaseAdapter
from app.llmhubs.types import (
    ModelRegistryEntry,
    OutputItem,
    Request,
    Response,
)

logger = logging.getLogger(__name__)


class HttpJsonAdapter(BaseAdapter):
    """Configurable adapter for arbitrary JSON HTTP endpoints."""

    async def generate(self, request: Request, entry: ModelRegistryEntry) -> Response:
        base_url = entry.config.get("base_url", "").rstrip("/")
        path = entry.config.get("path", "")
        timeout = self._resolve_timeout(request, entry)

        body = self._build_upstream_body(request, entry)

        headers = {"Content-Type": "application/json"}
        headers.update(self._build_auth_headers(entry))
        headers.update(entry.config.get("default_headers", {}))

        url = f"{base_url}{path}" if path else base_url
        resp = await self._post(url, json=body, headers=headers, timeout=timeout)
        data = resp.json()

        return self._extract_response(data, entry)

    # ------------------------------------------------------------------

    def _build_upstream_body(self, request: Request, entry: ModelRegistryEntry) -> dict[str, Any]:
        mapping: dict[str, str] = entry.config.get("request_field_mapping", {})
        static: dict[str, Any] = entry.config.get("request_static_fields", {})

        body: dict[str, Any] = dict(static)  # static defaults first

        slot_values = self._resolve_slots(request)

        for upstream_field, slot_name in mapping.items():
            value = slot_values.get(slot_name)
            if value is not None:
                body[upstream_field] = value  # mapped value overrides static

        return body

    def _resolve_slots(self, request: Request) -> dict[str, Any]:
        """Build a dict of slot_name → resolved value."""
        slots: dict[str, Any] = {
            "input_text": self._extract_first_text(request),
            "input_image": self._extract_first_image(request),
            "input_file": self._extract_first_file(request),
            "instructions": request.instructions,
        }
        for key, val in request.options.items():
            slots[f"options.{key}"] = val
        return slots

    @staticmethod
    def _extract_response(data: dict[str, Any], entry: ModelRegistryEntry) -> Response:
        extraction: dict[str, Any] = entry.config.get("response_extraction", {})
        output_type = extraction.get("output_type", "text")

        outputs: list[OutputItem] = []

        if output_type == "text":
            text_path = extraction.get("text_path", "")
            value = _jsonpath_extract(data, text_path)
            outputs.append(OutputItem(type="text", text=_stringify_text_output(value)))

        elif output_type == "json":
            json_path = extraction.get("json_path", "")
            value = _jsonpath_extract(data, json_path)
            if isinstance(value, dict):
                outputs.append(OutputItem(type="json", json=value))
            else:
                outputs.append(OutputItem(type="json", json={"result": value}))

        return Response(outputs=outputs, payload=data)


def _jsonpath_extract(data: Any, path: str) -> Any:
    """Extract data using a JSONPath expression.

    Returns ``None`` when the expression matches nothing, the single value when
    exactly one match is found, and a list of values when multiple matches are
    found.
    """
    if not path:
        return data

    expression = _compile_jsonpath(path)
    matches = [match.value for match in expression.find(data)]
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]
    return matches


def _stringify_text_output(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, dict | list):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


@lru_cache(maxsize=128)
def _compile_jsonpath(path: str):
    normalized_path = path.strip()
    if not normalized_path:
        raise ValueError("JSONPath expression cannot be empty")
    if not normalized_path.startswith("$"):
        normalized_path = f"$.{normalized_path.lstrip('.')}"
    try:
        return parse_jsonpath(normalized_path)
    except Exception as exc:
        raise ValueError(f"Invalid JSONPath expression: {path}") from exc
