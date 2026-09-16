from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest
from agent_framework import ChatResponseUpdate, Content, FunctionTool, Message
from agent_framework._middleware import FunctionInvocationContext

from app.biz.chat.runtime_agent import ChatAgent
from app.biz.task_runtime.sub_agent.loop import (
    AgentContent,
    AgentModelOutputDelta,
    AgentModelTurn,
    CapabilityCall,
    FinalAnswer,
    TokenUsage,
)
from app.pb.conversation.chat import ChatContentType, ChatResponse
from app.schemas.conversation.plan import Plan, PlanStep, PlanStepStatus
from app.storage.fs import CHAT_FS
from app.tools.common import ToolContext, get_tool_context
from app.tools.plan import PlanEditor


class _TwoTurnModel:
    def __init__(self) -> None:
        self.states = []

    async def stream_turn(self, state):
        self.states.append(state)
        if state.turn == 1:
            yield AgentModelOutputDelta(AgentContent(type="text", text="Before."))
            yield AgentModelTurn(
                CapabilityCall(capability="builtin:echo", args={"value": "ok"}, call_id="call-1"),
                usage=TokenUsage(total_tokens=3),
            )
            return
        yield AgentModelOutputDelta(AgentContent(type="text", text="After."))
        yield AgentModelTurn(FinalAnswer(summary="done", output="After."), usage=TokenUsage(total_tokens=2))


@pytest.mark.asyncio
async def test_shared_runtime_agent_streams_capability_boundaries_history_and_transcript(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(CHAT_FS, "_root", tmp_path)
    monkeypatch.setattr("app.biz.chat.runtime_agent.get_context_length", lambda model: 128_000)
    CHAT_FS.write_conversation(
        7,
        "alice",
        1,
        json.dumps(
            [
                {"role": "user", "contents": [{"type": "text", "text": "prepare it"}]},
                {"role": "assistant", "contents": [{"type": "text", "text": "prepared"}]},
            ]
        ),
        conversation_id=44,
    )
    queue = asyncio.Queue()
    tool_context = ToolContext(
        username="alice",
        agent_id="agent-1",
        agent_instance_id=7,
        turn_id=2,
        project_id=1,
        conversation_id=44,
        response_queue=queue,
        plan_editor=PlanEditor(7, "alice", 2, conversation_id=44),
    )
    calls = []

    async def echo(invocation_ctx: FunctionInvocationContext, value: str):
        assert get_tool_context(invocation_ctx) is tool_context
        calls.append(value)
        return {"value": value}

    agent = ChatAgent(
        username="alice",
        agent_instance_id=7,
        tool_context=tool_context,
        model="test-model",
    )
    model = _TwoTurnModel()
    agent._model = model

    await agent.run_stream(
        queue,
        Message(role="user", contents=[Content.from_text("retry it")]),
        "Be concise.",
        options=SimpleNamespace(
            turn_id=2,
            tools=[FunctionTool(name="echo", description="Echo", func=echo), {"type": "web_search"}],
        ),
    )

    emitted = []
    while not queue.empty():
        emitted.append(await queue.get())
    assert calls == ["ok"]
    assert [item.contents[0].text for item in emitted if isinstance(item, ChatResponseUpdate)] == ["Before.", "After."]
    assert [
        item.content.content
        for item in emitted
        if isinstance(item, ChatResponse) and item.content.type == ChatContentType.TEXT and item.is_internal
    ] == ["Before."]
    assert emitted[-1] is None
    assert [message.contents[0].text for message in model.states[0].initial_messages] == ["prepare it", "prepared"]
    assert model.states[1].history[0].content == '{"value": "ok"}'
    assert model.states[0].provider_tools == ({"type": "web_search"},)

    conversation = json.loads(CHAT_FS.read_conversation(7, "alice", 2, conversation_id=44))
    assert [message["role"] for message in conversation] == ["user", "assistant", "assistant"]
    events_path = CHAT_FS.get_turn_path(7, "alice", 2, 44) / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text(encoding="utf-8").splitlines()]
    event_types = [event["event"] for event in events]
    assert event_types == [
        "context_prepared",
        "model_turn_started",
        "model_output_delta",
        "model_turn_completed",
        "tool_call_requested",
        "tool_call_completed",
        "context_prepared",
        "model_turn_started",
        "model_output_delta",
        "model_turn_completed",
        "completion_proposed",
        "loop_finished",
    ]
    assert events[4]["data"]["call"]["capability"] == "builtin:echo"
    assert events[5]["data"]["observation"]["content"] == '{"value": "ok"}'


@pytest.mark.asyncio
async def test_completed_runtime_agent_finishes_updated_plan(tmp_path, monkeypatch) -> None:
    class _FinalModel:
        async def stream_turn(self, state):
            yield AgentModelTurn(FinalAnswer(summary="done", output="done"), usage=TokenUsage(total_tokens=1))

    monkeypatch.setattr(CHAT_FS, "_root", tmp_path)
    monkeypatch.setattr("app.biz.chat.runtime_agent.get_context_length", lambda model: 128_000)
    monkeypatch.setattr(
        "app.biz.chat.runtime_agent.default_agent_profile_resolver",
        lambda: SimpleNamespace(
            resolve=lambda name: SimpleNamespace(system_prompt="", capability_ceiling=frozenset())
        ),
    )
    queue = asyncio.Queue()
    plan = Plan(
        steps=[
            PlanStep(title="Execute task", status=PlanStepStatus.IN_PROGRESS),
            PlanStep(title="Report result", status=PlanStepStatus.PENDING),
        ]
    )
    updated_plans = []

    async def get_plan(self) -> Plan:
        return plan

    async def update_plan(self, updated_plan: Plan) -> None:
        updated_plans.append(updated_plan)

    monkeypatch.setattr(PlanEditor, "get_plan", get_plan)
    monkeypatch.setattr(PlanEditor, "update_plan", update_plan)
    plan_editor = PlanEditor(7, "alice", 1, conversation_id=44)
    tool_context = ToolContext(
        username="alice",
        agent_id="agent-1",
        agent_instance_id=7,
        turn_id=1,
        project_id=1,
        conversation_id=44,
        response_queue=queue,
        plan_editor=plan_editor,
    )
    tool_context.plan_editor._has_plan_updates = True
    agent = ChatAgent(username="alice", agent_instance_id=7, tool_context=tool_context, model="test-model")
    agent._model = _FinalModel()

    await agent.run_stream(
        queue,
        Message(role="user", contents=[Content.from_text("run it")]),
        "Be concise.",
        options=SimpleNamespace(turn_id=1, tools=[]),
    )

    assert [(step.title, step.status) for step in updated_plans[-1].steps] == [
        ("Execute task", PlanStepStatus.COMPLETED)
    ]
