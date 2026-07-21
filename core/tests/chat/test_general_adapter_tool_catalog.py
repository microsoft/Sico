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

"""The general adapter and the runtime tool catalog stay in lock-step.

The builtin ``tool`` payloads are declared once in
``app.biz.task_runtime.tool_catalog``; the adapter renders its docs and enforces
its allow-list from that same source. These tests pin both directions.
"""

from __future__ import annotations

import json

import pytest

from app.biz.chat.adapters.general.adapter import (
    GeneralAdapter,
    GeneralAdapterError,
    PlannedTaskItem,
    _build_task_spec,
    _parse_options,
)
from app.biz.task_runtime.models import ToolDispatch
from app.biz.task_runtime.tool_catalog import (
    ECHO_TOOL_NAME,
    FILE_CONVERT_TOOL_NAME,
    RUN_COMMAND_TOOL_NAME,
    RUNTIME_TOOL_NAMES,
    is_runtime_tool,
    render_runtime_tool_catalog,
    runtime_tool_names_inline,
)


def test_runtime_tool_names_are_the_closed_builtin_set() -> None:
    assert RUNTIME_TOOL_NAMES == {ECHO_TOOL_NAME, FILE_CONVERT_TOOL_NAME, RUN_COMMAND_TOOL_NAME}
    assert is_runtime_tool(RUN_COMMAND_TOOL_NAME)
    assert not is_runtime_tool("curl")


def test_catalog_renders_every_tool_name() -> None:
    catalog = render_runtime_tool_catalog()
    inline = runtime_tool_names_inline()
    for name in RUNTIME_TOOL_NAMES:
        assert f"`{name}`" in catalog
        assert f"`{name}`" in inline


def test_adapter_description_is_generated_from_the_catalog() -> None:
    description = GeneralAdapter.description
    # The bullet block and the inline mention both come from the catalog.
    assert render_runtime_tool_catalog() in description
    assert runtime_tool_names_inline() in description
    assert "instruction-only Markdown skills" in description
    assert "chat tools such as `curl`" in description


def test_parse_options_rejects_unsupported_direct_tool() -> None:
    payload = json.dumps({"instructions": ["x"], "direct_tools": [{"name": "curl"}]})

    with pytest.raises(GeneralAdapterError) as excinfo:
        _parse_options(payload)

    assert excinfo.value.code == "general_options_invalid"
    assert excinfo.value.details["unknown_tools"] == ["curl"]


def test_parse_options_normalizes_default_sandbox_alias() -> None:
    # ``default_required_sandbox`` IS still LLM-supplied free text, so its infra
    # alias normalization is a deliberate boundary defense (not dead code). The
    # ``sandbox.android`` infra token and the bare platform word both resolve to
    # the ``android`` OS capability.
    payload = json.dumps({"instructions": ["x"], "default_required_sandbox": "sandbox.android"})

    options = _parse_options(payload)

    assert options.default_required_sandbox == "android"


def test_parse_options_accepts_supported_direct_tools() -> None:
    payload = json.dumps({"instructions": ["x"], "direct_tools": [{"name": RUN_COMMAND_TOOL_NAME}]})

    options = _parse_options(payload)

    assert [t.name for t in options.direct_tools] == [RUN_COMMAND_TOOL_NAME]


def _tool_dispatch(planned: PlannedTaskItem) -> ToolDispatch:
    options = _parse_options(json.dumps({"instructions": ["x"]}))
    spec = _build_task_spec(1, "x", planned, options, tool_index={}, skill_index={})
    assert isinstance(spec.dispatch, ToolDispatch)
    return spec.dispatch


def test_build_task_spec_rejects_non_runtime_tool_even_without_descriptors() -> None:
    planned = PlannedTaskItem(title="t", dispatch_type="tool", tool_name="curl")

    with pytest.raises(GeneralAdapterError) as excinfo:
        _tool_dispatch(planned)

    assert excinfo.value.code == "general_planner_invalid_output"
    assert excinfo.value.details["supported_tools"] == sorted(RUNTIME_TOOL_NAMES)


def test_build_task_spec_accepts_runtime_tool() -> None:
    planned = PlannedTaskItem(title="t", dispatch_type="tool", tool_name=RUN_COMMAND_TOOL_NAME)

    dispatch = _tool_dispatch(planned)

    assert dispatch.tool_name == RUN_COMMAND_TOOL_NAME
