from __future__ import annotations

import asyncio

import pytest
from agent_framework import Content, FunctionTool
from agent_framework._middleware import FunctionInvocationContext
from pydantic import BaseModel

from app.biz.chat.capabilities import ChatCapabilityToolController
from app.biz.task_runtime.sub_agent.loop import (
    AgentContent,
    AgentLoopLimits,
    AgentLoopRequest,
    AgentLoopSnapshot,
    AgentTask,
    CapabilityCall,
)
from app.tools.common import ToolContext, get_tool_context
from app.tools.plan import PlanEditor


class _Input(BaseModel):
    value: str


@pytest.fixture
def tool_context() -> ToolContext:
    return ToolContext(
        username="alice",
        agent_id="agent-1",
        agent_instance_id=7,
        turn_id=2,
        project_id=1,
        conversation_id=44,
        response_queue=asyncio.Queue(),
        plan_editor=PlanEditor(7, "alice", 2, conversation_id=44),
    )


@pytest.mark.asyncio
async def test_controller_exposes_namespaced_capability_and_invokes_with_chat_context(tool_context) -> None:
    async def run(invocation_ctx: FunctionInvocationContext, value: str):
        assert get_tool_context(invocation_ctx) is tool_context
        return {"value": value}

    tool = FunctionTool(name="plan_read", description="Read", input_model=_Input, func=run)
    controller = ChatCapabilityToolController((tool, {"type": "web_search"}), tool_context)
    snapshot = await controller.snapshot()

    assert [item.descriptor.tool_id for item in snapshot.tools] == ["builtin:plan:read"]
    request = AgentLoopRequest(
        engine_run_id="turn-2",
        task=AgentTask(title="test"),
        system_prompt="",
        tools=snapshot.descriptors,
        limits=AgentLoopLimits(max_model_turns=2),
    )
    observation = await snapshot.tools[0].invoke(
        CapabilityCall(capability="builtin:plan:read", args={"value": "ok"}, call_id="call-1"),
        AgentLoopSnapshot(request=request, turn=1, history=()),
    )

    assert observation.ok
    assert '"value": "ok"' in observation.content


@pytest.mark.asyncio
async def test_controller_maps_delegate_and_plan_names(tool_context) -> None:
    async def run(invocation_ctx):
        return "ok"

    tools = (
        FunctionTool(name="delegate", description="Delegate", func=run),
        FunctionTool(name="plan_write", description="Write plan", func=run),
        FunctionTool(name="plan_tool_call_message_update", description="Update", func=run),
    )

    snapshot = await ChatCapabilityToolController(tools, tool_context).snapshot()

    assert [tool.descriptor.tool_id for tool in snapshot.tools] == [
        "builtin:delegate",
        "builtin:plan:write",
        "builtin:plan:update_call",
    ]


@pytest.mark.asyncio
async def test_controller_maps_tool_payload_usage_to_observation(tool_context) -> None:
    async def run(invocation_ctx: FunctionInvocationContext):
        return {"usage": {"input_tokens": 5, "output_tokens": 2, "total_tokens": 7}}

    snapshot = await ChatCapabilityToolController(
        (FunctionTool(name="delegate", description="Delegate", func=run),),
        tool_context,
    ).snapshot()
    request = AgentLoopRequest(
        engine_run_id="turn-2",
        task=AgentTask(title="test"),
        system_prompt="",
        tools=snapshot.descriptors,
        limits=AgentLoopLimits(max_model_turns=2),
    )

    observation = await snapshot.tools[0].invoke(
        CapabilityCall(capability="builtin:delegate", call_id="call-1"),
        AgentLoopSnapshot(request=request, turn=1, history=()),
    )

    assert observation.usage.total_tokens == 7


@pytest.mark.asyncio
async def test_controller_preserves_image_tool_content(tool_context) -> None:
    async def run(invocation_ctx: FunctionInvocationContext):
        return [Content.from_text("Captured screenshot."), Content.from_data(b"image-bytes", "image/png")]

    snapshot = await ChatCapabilityToolController(
        (FunctionTool(name="screenshot", description="Capture screen", func=run),),
        tool_context,
    ).snapshot()
    request = AgentLoopRequest(
        engine_run_id="turn-2",
        task=AgentTask(title="test"),
        system_prompt="",
        tools=snapshot.descriptors,
        limits=AgentLoopLimits(max_model_turns=2),
    )

    observation = await snapshot.tools[0].invoke(
        CapabilityCall(capability="builtin:screenshot", call_id="call-1"),
        AgentLoopSnapshot(request=request, turn=1, history=()),
    )

    assert observation.contents == (
        AgentContent(
            type="image",
            uri="data:image/png;base64,aW1hZ2UtYnl0ZXM=",
            mime_type="image/png",
        ),
    )


@pytest.mark.asyncio
async def test_controller_enforces_profile_capability_ceiling(tool_context) -> None:
    async def run(invocation_ctx: FunctionInvocationContext):
        return "ok"

    snapshot = await ChatCapabilityToolController(
        (
            FunctionTool(name="plan_read", description="Read", func=run),
            FunctionTool(name="delegate", description="Delegate", func=run),
        ),
        tool_context,
        capability_ceiling=frozenset({"builtin:plan:**"}),
    ).snapshot()

    assert [tool.descriptor.tool_id for tool in snapshot.tools] == ["builtin:plan:read"]
