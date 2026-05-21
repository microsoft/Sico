import asyncio

import pytest
from agent_framework import FunctionTool
from agent_framework._middleware import FunctionInvocationContext

from app.schemas.conversation.plan import ToolCallStatus
from app.tools.common import _TOOL_CONTEXT_KWARGS_KEY, ToolContext
from app.tools.run_command import _run_command_func


class _FakePlanEditor:
    def __init__(self):
        self.created_statuses = []
        self.statuses = {}
        self.messages = {}

    async def create_tool_call(self, name, initial_message, execution_info=None, tool_call_status=ToolCallStatus.RUNNING):
        tool_call_id = len(self.created_statuses) + 1
        self.created_statuses.append(tool_call_status)
        self.statuses[tool_call_id] = tool_call_status
        self.messages[tool_call_id] = initial_message
        return tool_call_id

    async def update_tool_call_message(self, tool_call_id, message):
        self.messages[tool_call_id] = message
        return None

    async def update_tool_call_status(self, tool_call_id, status):
        self.statuses[tool_call_id] = status
        return None


def _build_invocation_context(plan_editor):
    tool_context = ToolContext.model_construct(
        username="alice@example.com",
        agent_id="agent-1",
        agent_instance_id=123,
        turn_id=456,
        project_id=789,
        conversation_id=101112,
        response_queue=asyncio.Queue(),
        plan_editor=plan_editor,
        all_tools=[],
    )
    return FunctionInvocationContext(
        function=FunctionTool(name="run_command", func=lambda: None),
        arguments={},
        kwargs={_TOOL_CONTEXT_KWARGS_KEY: tool_context},
    )


@pytest.mark.asyncio
async def test_run_command_marks_first_failed_command_as_failed_analyzing(monkeypatch, tmp_path):
    plan_editor = _FakePlanEditor()
    invocation_context = _build_invocation_context(plan_editor)

    async def fake_run_local(command, workspace_path, timeout, tool_call_id, update_message):
        await update_message("Command finished with exit code 1.")
        return {"return_code": 1, "stdout": "", "stderr": "failed", "system_error": "", "tool_call_id": tool_call_id}

    monkeypatch.setattr("app.tools.run_command._IS_IN_CLUSTER", False)
    monkeypatch.setattr("app.tools.run_command.CHAT_FS.get_workspace_path", lambda agent_instance_id, username: tmp_path)
    monkeypatch.setattr("app.tools.run_command._run_local", fake_run_local)

    result = await _run_command_func(invocation_context, command="pytest", timeout=1)

    assert result["return_code"] == 1
    assert plan_editor.created_statuses == [ToolCallStatus.RUNNING]
    assert plan_editor.statuses[1] == ToolCallStatus.FAILED_ANALYZING


@pytest.mark.asyncio
async def test_run_command_marks_retry_successful(monkeypatch, tmp_path):
    plan_editor = _FakePlanEditor()
    invocation_context = _build_invocation_context(plan_editor)

    async def fake_run_local(command, workspace_path, timeout, tool_call_id, update_message):
        await update_message("Command finished with exit code 0.")
        return {"return_code": 0, "stdout": "ok", "stderr": "", "system_error": "", "tool_call_id": tool_call_id}

    monkeypatch.setattr("app.tools.run_command._IS_IN_CLUSTER", False)
    monkeypatch.setattr("app.tools.run_command.CHAT_FS.get_workspace_path", lambda agent_instance_id, username: tmp_path)
    monkeypatch.setattr("app.tools.run_command._run_local", fake_run_local)

    result = await _run_command_func(invocation_context, command="pytest", timeout=1, is_retry=True)

    assert result["return_code"] == 0
    assert plan_editor.created_statuses == [ToolCallStatus.RETRY_RUNNING]
    assert plan_editor.statuses[1] == ToolCallStatus.RETRY_SUCCESSFUL