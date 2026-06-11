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

"""Tests for ``TurnContext`` — the trusted per-turn identity envelope."""

from __future__ import annotations

import asyncio
import dataclasses

import pytest

from app.biz.task_runtime.context import TurnContext
from app.tools.common import ToolContext
from app.tools.plan import PlanEditor


class _FakePlanEditor(PlanEditor):
    def __init__(self) -> None:  # type: ignore[no-untyped-def]
        pass


def _make_tool_context(*, agent_instance_id: int | None = 7) -> ToolContext:
    return ToolContext(
        username="alice",
        agent_id="agent-1",
        agent_instance_id=agent_instance_id,
        turn_id=42,
        project_id=100,
        conversation_id=200,
        response_queue=asyncio.Queue(),
        plan_editor=_FakePlanEditor(),
    )


def test_from_tool_context_copies_identity_fields() -> None:
    tc = _make_tool_context()
    ctx = TurnContext.from_tool_context(tc)

    assert ctx.username == "alice"
    assert ctx.agent_id == "agent-1"
    assert ctx.agent_instance_id == 7
    assert ctx.project_id == 100
    assert ctx.conversation_id == 200
    assert ctx.turn_id == 42
    assert ctx.plan_editor is tc.plan_editor


def test_from_tool_context_coerces_none_agent_instance_id_to_zero() -> None:
    ctx = TurnContext.from_tool_context(_make_tool_context(agent_instance_id=None))
    assert ctx.agent_instance_id == 0


def test_turn_context_is_frozen() -> None:
    ctx = TurnContext.from_tool_context(_make_tool_context())
    with pytest.raises(dataclasses.FrozenInstanceError):
        ctx.username = "bob"  # type: ignore[misc]


def test_with_plan_editor_returns_copy_with_new_editor() -> None:
    ctx = TurnContext.from_tool_context(_make_tool_context())
    new_editor = _FakePlanEditor()
    rebound = ctx.with_plan_editor(new_editor)

    assert rebound is not ctx
    assert rebound.plan_editor is new_editor
    # Identity fields preserved
    assert rebound.username == ctx.username
    assert rebound.turn_id == ctx.turn_id
