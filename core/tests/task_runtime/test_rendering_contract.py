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

"""Contract test guarding the frontend ToolCall rendering examples.

The canonical examples under ``docs/rendering/examples`` are the cross-team
contract artifact documented in ``docs/rendering/tool_call_contract.md``. This
test fails if an example drifts away from the real ``ToolCall`` schema, so the
documentation and the reference renderer stay trustworthy.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.schemas.conversation.plan import ToolCall

_EXAMPLES_DIR = Path(__file__).resolve().parents[3] / "docs" / "rendering" / "examples"
_EXAMPLE_FILES = sorted(_EXAMPLES_DIR.glob("*.json"))


def _strip_message(node: object) -> object:
    """Recursively drop every ``message`` key (incl. nested ``subCalls``)."""
    if isinstance(node, dict):
        return {key: _strip_message(value) for key, value in node.items() if key != "message"}
    if isinstance(node, list):
        return [_strip_message(item) for item in node]
    return node

@pytest.mark.parametrize("example", _EXAMPLE_FILES, ids=lambda p: p.name)
def test_example_conforms_to_tool_call_schema(example: Path) -> None:
    raw = json.loads(example.read_text())
    tool_call = ToolCall.model_validate(raw)

    # Structured fields, not prose, must carry identity and progress.
    assert tool_call.tool_name == raw["toolName"]
    assert len(tool_call.sub_calls) == len(raw.get("subCalls", []))

    # The camelCase proto3-JSON wire form round-trips without loss.
    restored = ToolCall.model_validate(tool_call.model_dump(by_alias=True))
    assert restored == tool_call


@pytest.mark.parametrize("example", _EXAMPLE_FILES, ids=lambda p: p.name)
def test_example_outcome_is_renderable_without_message(example: Path) -> None:
    """Every fact the UI needs is reachable from structured fields alone.

    We physically strip the deprecated ``message`` prose (recursively, including
    nested ``subCalls``) and prove the example still validates and exposes its
    identity/progress/outcome structurally â€” so a frontend that ignores
    ``message`` loses nothing.
    """
    raw = _strip_message(json.loads(example.read_text()))
    tool_call = ToolCall.model_validate(raw)

    # No `message` survives anywhere in the parsed tree.
    assert not tool_call.message
    assert all(not child.message for child in tool_call.sub_calls)

    # A parent batch exposes its children structurally (ordered by index).
    if tool_call.sub_calls:
        indices = [child.sub_call_index for child in tool_call.sub_calls]
        assert indices == sorted(indices)

    # Progress/outcome is conveyed by tool_call_status + sub_calls + task_runtime,
    # so the UI never has to parse the deprecated `message` prose.
    assert tool_call.tool_call_status or tool_call.sub_calls or tool_call.execution_info.task_runtime.current_stage
