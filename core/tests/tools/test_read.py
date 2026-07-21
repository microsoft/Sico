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

import asyncio
from types import SimpleNamespace

import pytest

from app.tools.common import ToolContext
from app.tools.read import _read_func


class _FakePlanEditor:
    def __init__(self) -> None:
        self.next_id = 0
        self.messages: dict[int, str] = {}

    async def create_tool_call(self, name, initial_message, execution_info=None, parent_tool_call_id=None, sub_call_index=0):
        self.next_id += 1
        self.messages[self.next_id] = initial_message
        return self.next_id

    async def update_tool_call_message(self, tool_call_id: int, message: str):
        self.messages[tool_call_id] = message
        return None


def _ctx(raw_user_message: str = "") -> ToolContext:
    return ToolContext.model_construct(
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        turn_id=7,
        project_id=1,
        conversation_id=42,
        response_queue=asyncio.Queue(),
        plan_editor=_FakePlanEditor(),
        raw_user_message=raw_user_message,
    )


@pytest.mark.asyncio
async def test_read_returns_skill_source_for_normal_execution(monkeypatch) -> None:
    ctx = _ctx("帮我执行这个 Android 测试")
    invocation_ctx = SimpleNamespace(kwargs={"tool_context": ctx})
    monkeypatch.setattr("app.tools.read.CHAT_FS.read_file", lambda *_args, **_kwargs: "skill source content\n")

    result = await _read_func(invocation_ctx, file_path="skills/1/SKILL.md")

    assert result["error_message"] == ""
    assert result["content"] == "skill source content\n"
    assert result["lines_returned"] == 1
    assert ctx.plan_editor.messages[1] == "Read file SKILL.md, line 0 to 1."


@pytest.mark.asyncio
async def test_read_returns_playbook_source_for_normal_execution(monkeypatch) -> None:
    ctx = _ctx("执行测试")
    invocation_ctx = SimpleNamespace(kwargs={"tool_context": ctx})
    monkeypatch.setattr("app.tools.read.CHAT_FS.read_file", lambda *_args, **_kwargs: "playbook content\n")

    result = await _read_func(invocation_ctx, file_path="playbooks/android_sandbox_execution.md")

    assert result["content"] == "playbook content\n"
    assert result["lines_returned"] == 1


@pytest.mark.asyncio
async def test_read_allows_explicit_skill_debug_request(monkeypatch) -> None:
    ctx = _ctx("请调试技能源码")
    invocation_ctx = SimpleNamespace(kwargs={"tool_context": ctx})
    monkeypatch.setattr("app.tools.read.CHAT_FS.read_file", lambda *_args, **_kwargs: "skill source content\n")

    result = await _read_func(invocation_ctx, file_path="skills/1/SKILL.md")

    assert result["content"] == "skill source content\n"
    assert result["lines_returned"] == 1


@pytest.mark.asyncio
async def test_read_returns_skill_source_for_generic_workspace_source_debug(monkeypatch) -> None:
    ctx = _ctx("Debug the delegation guard implementation by inspecting workspace source only")
    invocation_ctx = SimpleNamespace(kwargs={"tool_context": ctx})
    monkeypatch.setattr("app.tools.read.CHAT_FS.read_file", lambda *_args, **_kwargs: "runner source content\n")

    result = await _read_func(invocation_ctx, file_path="skills/1/android_tester/runner.py")

    assert result["content"] == "runner source content\n"
    assert result["lines_returned"] == 1
