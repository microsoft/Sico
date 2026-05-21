import asyncio

import pytest
from agent_framework import Content, FunctionTool
from agent_framework._middleware import FunctionInvocationContext

from app.schemas.conversation.plan import Plan, PlanStep, ToolCall, ToolCallStatus
from app.tools.common import _TOOL_CONTEXT_KWARGS_KEY, ToolCallStatusMiddleware, ToolContext, get_tool_context
from app.tools.plan import _mark_failed_analyzing_tool_calls_as_analyzed, record_tool_call_for_status_tracking


class _FakePlanEditor:
    def __init__(self):
        self.create_calls = []
        self.statuses = {}

    async def create_tool_call(
        self,
        name,
        initial_message,
        execution_info=None,
        parent_tool_call_id=None,
        batch_item_index=0,
        tool_call_status=ToolCallStatus.RUNNING,
    ):
        tool_call_status = ToolCallStatus.RUNNING if tool_call_status == ToolCallStatus.UNKNOWN else tool_call_status
        tool_call_id = len(self.create_calls) + 1
        self.create_calls.append(
            {
                "name": name,
                "initial_message": initial_message,
                "execution_info": execution_info,
                "parent_tool_call_id": parent_tool_call_id,
                "batch_item_index": batch_item_index,
                "tool_call_status": tool_call_status,
            }
        )
        self.statuses[tool_call_id] = tool_call_status
        record_tool_call_for_status_tracking(tool_call_id, tool_call_status)
        return tool_call_id

    async def update_tool_call_status(self, tool_call_id, status):
        self.statuses[tool_call_id] = status
        return None

    async def update_tool_call_status_if_running(self, tool_call_id, status):
        if self.statuses[tool_call_id] == ToolCallStatus.RUNNING:
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
        function=FunctionTool(name="demo_tool", func=lambda: None),
        arguments={},
        kwargs={_TOOL_CONTEXT_KWARGS_KEY: tool_context},
    )


def test_retry_creation_marks_failed_analyzing_tool_calls_as_analyzed():
    plan = Plan(
        steps=[
            PlanStep(
                title="Run web tests",
                tool_calls=[
                    ToolCall(tool_call_id=1, tool_call_status=ToolCallStatus.FAILED_ANALYZING),
                    ToolCall(
                        tool_call_id=2,
                        tool_call_status=ToolCallStatus.RUNNING,
                        batch_calls=[
                            ToolCall(tool_call_id=3, tool_call_status=ToolCallStatus.FAILED_ANALYZING),
                        ],
                    ),
                ],
            )
        ]
    )

    _mark_failed_analyzing_tool_calls_as_analyzed(plan)

    assert plan.steps[0].tool_calls[0].tool_call_status == ToolCallStatus.FAILED_ANALYZED
    assert plan.steps[0].tool_calls[1].tool_call_status == ToolCallStatus.RUNNING
    assert plan.steps[0].tool_calls[1].batch_calls[0].tool_call_status == ToolCallStatus.FAILED_ANALYZED


@pytest.mark.asyncio
async def test_tool_call_status_middleware_marks_created_tool_calls_successful():
    plan_editor = _FakePlanEditor()
    invocation_context = _build_invocation_context(plan_editor)

    async def call_next():
        ctx = get_tool_context(invocation_context)
        await ctx.plan_editor.create_tool_call("Read", "Reading file")
        invocation_context.result = [Content.from_text('{"error_message": ""}')]

    await ToolCallStatusMiddleware().process(invocation_context, call_next)

    assert plan_editor.statuses[1] == ToolCallStatus.SUCCESSFUL


@pytest.mark.asyncio
async def test_tool_call_status_middleware_marks_tool_result_failures_failed():
    plan_editor = _FakePlanEditor()
    invocation_context = _build_invocation_context(plan_editor)

    async def call_next():
        ctx = get_tool_context(invocation_context)
        await ctx.plan_editor.create_tool_call("Read", "Reading file")
        invocation_context.result = [Content.from_text('{"error_message": "file not found"}')]

    await ToolCallStatusMiddleware().process(invocation_context, call_next)

    assert plan_editor.statuses[1] == ToolCallStatus.FAILED


@pytest.mark.asyncio
async def test_tool_call_status_middleware_marks_exceptions_failed():
    plan_editor = _FakePlanEditor()
    invocation_context = _build_invocation_context(plan_editor)

    async def call_next():
        ctx = get_tool_context(invocation_context)
        await ctx.plan_editor.create_tool_call("Read", "Reading file")
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        await ToolCallStatusMiddleware().process(invocation_context, call_next)

    assert plan_editor.statuses[1] == ToolCallStatus.FAILED


@pytest.mark.asyncio
async def test_tool_call_status_middleware_does_not_override_tool_owned_status():
    plan_editor = _FakePlanEditor()
    invocation_context = _build_invocation_context(plan_editor)

    async def call_next():
        ctx = get_tool_context(invocation_context)
        tool_call_id = await ctx.plan_editor.create_tool_call(
            "Run Command",
            "Retrying: pytest",
            tool_call_status=ToolCallStatus.RETRY_RUNNING,
        )
        await ctx.plan_editor.update_tool_call_status(tool_call_id, ToolCallStatus.RETRY_FAILED)
        invocation_context.result = [Content.from_text('{"success": true}')]

    await ToolCallStatusMiddleware().process(invocation_context, call_next)

    assert plan_editor.statuses[1] == ToolCallStatus.RETRY_FAILED