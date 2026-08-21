from __future__ import annotations

import asyncio

import pytest

from app.biz.task_runtime.factory import _sub_agent_loop_engine
from app.biz.task_runtime.sub_agent.loop import (
    AgentContextBlock,
    AgentLoopLimits,
    AgentLoopRequest,
    AgentLoopRuntime,
    AgentModelTurn,
    AgentTask,
    AgentToolDescriptor,
    BoundAgentTool,
    CapabilityCall,
    CompletionDirective,
    ContextPreparedEvent,
    FinalAnswer,
    LangGraphAgentLoopEngine,
    LoopFinishedEvent,
    MafAgentLoopEngine,
    ModelTurnCompletedEvent,
    NativeAgentLoopEngine,
    Observation,
    PreparedModelContext,
    TokenUsage,
    ToolCallCompletedEvent,
)


@pytest.fixture(
    params=(NativeAgentLoopEngine, LangGraphAgentLoopEngine, MafAgentLoopEngine),
    ids=("native", "langgraph", "maf"),
)
def engine_cls(request):
    return request.param


class _ScriptedModel:
    def __init__(self, *turns: AgentModelTurn) -> None:
        self._turns = list(turns)
        self.states = []

    async def complete_turn(self, state):
        self.states.append(state)
        return self._turns.pop(0)


class _RecordingContext:
    def __init__(self) -> None:
        self.turns: list[int] = []

    async def before_model(self, snapshot):
        self.turns.append(snapshot.turn)
        return PreparedModelContext(
            blocks=(AgentContextBlock(source="knowledge", content=f"context-{snapshot.turn}"),),
        )


class _Completion:
    def __init__(self, *directives: CompletionDirective) -> None:
        self._directives = list(directives)

    async def evaluate(self, proposal, snapshot):
        return self._directives.pop(0)


def _request(*, max_turns: int = 4, max_tool_calls: int | None = None) -> AgentLoopRequest:
    descriptor = AgentToolDescriptor(tool_id="builtin:echo")
    return AgentLoopRequest(
        engine_run_id="run-1",
        task=AgentTask(title="Echo once"),
        system_prompt="Be concise.",
        tools=(descriptor,),
        limits=AgentLoopLimits(max_model_turns=max_turns, max_tool_calls=max_tool_calls),
    )


async def _events(engine, request, tool, context, completion):
    return [
        event
        async for event in engine.run(
            request,
            tools=(tool,),
            runtime=AgentLoopRuntime(
                context_controller=context,
                evaluate_completion=completion.evaluate,
            ),
        )
    ]


@pytest.mark.asyncio
async def test_engine_binds_tool_results_and_accumulates_usage(engine_cls) -> None:
    model = _ScriptedModel(
        AgentModelTurn(
            CapabilityCall(capability="builtin:echo", args={"text": "hi"}),
            usage=TokenUsage(input_tokens=10, output_tokens=2, total_tokens=12),
        ),
        AgentModelTurn(
            FinalAnswer(summary="done"),
            usage=TokenUsage(input_tokens=15, output_tokens=3, total_tokens=18),
        ),
    )
    calls: list[CapabilityCall] = []

    async def invoke(call, snapshot):
        calls.append(call)
        return Observation(capability=call.capability, call_id=call.call_id, ok=True, content="hi")

    descriptor = AgentToolDescriptor(tool_id="builtin:echo")
    context = _RecordingContext()
    events = await _events(
        engine_cls(model),
        _request(),
        BoundAgentTool(descriptor, invoke),
        context,
        _Completion(CompletionDirective(outcome="accept")),
    )

    assert calls == [CapabilityCall(capability="builtin:echo", args={"text": "hi"}, call_id="turn-1-call-1")]
    assert model.states[1].history[0].content == "hi"
    assert model.states[0].context[0].content == "context-1"
    assert context.turns == [1, 2]
    assert sum(isinstance(event, ContextPreparedEvent) for event in events) == 2
    assert sum(isinstance(event, ModelTurnCompletedEvent) for event in events) == 2
    assert sum(isinstance(event, ToolCallCompletedEvent) for event in events) == 1
    finished = next(event for event in events if isinstance(event, LoopFinishedEvent))
    assert finished.outcome == "completed"
    assert finished.usage == TokenUsage(input_tokens=25, output_tokens=5, total_tokens=30)
    assert finished.model_turns == 2
    assert finished.tool_calls == 1


@pytest.mark.asyncio
async def test_engine_completion_can_continue_with_feedback(engine_cls) -> None:
    model = _ScriptedModel(
        AgentModelTurn(FinalAnswer(summary="maybe")),
        AgentModelTurn(FinalAnswer(summary="verified")),
    )
    descriptor = AgentToolDescriptor(tool_id="builtin:echo")

    async def invoke(call, snapshot):
        raise AssertionError("tool should not be called")

    events = await _events(
        engine_cls(model),
        _request(),
        BoundAgentTool(descriptor, invoke),
        _RecordingContext(),
        _Completion(
            CompletionDirective(outcome="continue", reason="provide evidence"),
            CompletionDirective(outcome="accept"),
        ),
    )

    assert model.states[1].history[0].content == "provide evidence"
    finished = next(event for event in events if isinstance(event, LoopFinishedEvent))
    assert finished.outcome == "completed"
    assert finished.summary == "verified"


@pytest.mark.asyncio
async def test_engine_enforces_tool_call_budget(engine_cls) -> None:
    model = _ScriptedModel(
        AgentModelTurn(CapabilityCall(capability="builtin:echo")),
        AgentModelTurn(CapabilityCall(capability="builtin:echo")),
    )
    calls = 0

    async def invoke(call, snapshot):
        nonlocal calls
        calls += 1
        return Observation(capability=call.capability, ok=True)

    descriptor = AgentToolDescriptor(tool_id="builtin:echo")
    events = await _events(
        engine_cls(model),
        _request(max_tool_calls=1),
        BoundAgentTool(descriptor, invoke),
        _RecordingContext(),
        _Completion(),
    )

    assert calls == 1
    finished = next(event for event in events if isinstance(event, LoopFinishedEvent))
    assert finished.outcome == "failed"
    assert finished.error_kind == "transient"
    assert "capability-call budget" in finished.summary


@pytest.mark.asyncio
async def test_engine_enforces_model_turn_budget(engine_cls) -> None:
    model = _ScriptedModel(AgentModelTurn(CapabilityCall(capability="builtin:echo")))

    async def invoke(call, snapshot):
        return Observation(capability=call.capability, ok=True)

    descriptor = AgentToolDescriptor(tool_id="builtin:echo")
    events = await _events(
        engine_cls(model),
        _request(max_turns=1),
        BoundAgentTool(descriptor, invoke),
        _RecordingContext(),
        _Completion(),
    )

    finished = next(event for event in events if isinstance(event, LoopFinishedEvent))
    assert finished.outcome == "failed"
    assert finished.model_turns == 1
    assert finished.tool_calls == 1
    assert "model-turn budget" in finished.summary


@pytest.mark.asyncio
async def test_context_controller_can_replace_model_visible_history(engine_cls) -> None:
    model = _ScriptedModel(
        AgentModelTurn(CapabilityCall(capability="builtin:echo")),
        AgentModelTurn(FinalAnswer(summary="done")),
    )

    class _CompactingContext:
        async def before_model(self, snapshot):
            history = () if snapshot.turn == 2 else None
            return PreparedModelContext(blocks=(), history=history)

    async def invoke(call, snapshot):
        return Observation(capability=call.capability, ok=True, content="large tool output")

    descriptor = AgentToolDescriptor(tool_id="builtin:echo")
    await _events(
        engine_cls(model),
        _request(),
        BoundAgentTool(descriptor, invoke),
        _CompactingContext(),
        _Completion(CompletionDirective(outcome="accept")),
    )

    assert model.states[1].history == ()


@pytest.mark.asyncio
async def test_engine_propagates_cancellation_and_stops(engine_cls) -> None:
    entered = asyncio.Event()
    cancelled = asyncio.Event()

    class _BlockingModel:
        async def complete_turn(self, state):
            entered.set()
            try:
                await asyncio.Future()
            except asyncio.CancelledError:
                cancelled.set()
                raise

    descriptor = AgentToolDescriptor(tool_id="builtin:echo")

    async def invoke(call, snapshot):
        raise AssertionError("tool should not be called")

    task = asyncio.create_task(
        _events(
            engine_cls(_BlockingModel()),
            _request(),
            BoundAgentTool(descriptor, invoke),
            _RecordingContext(),
            _Completion(),
        )
    )
    await entered.wait()
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task
    assert cancelled.is_set()


@pytest.mark.asyncio
async def test_engine_rejects_duplicate_model_call_ids(engine_cls) -> None:
    model = _ScriptedModel(
        AgentModelTurn(CapabilityCall(capability="builtin:echo", call_id="provider-call")),
        AgentModelTurn(CapabilityCall(capability="builtin:echo", call_id="provider-call")),
    )

    async def invoke(call, snapshot):
        return Observation(capability=call.capability, ok=True)

    descriptor = AgentToolDescriptor(tool_id="builtin:echo")
    events = await _events(
        engine_cls(model),
        _request(),
        BoundAgentTool(descriptor, invoke),
        _RecordingContext(),
        _Completion(),
    )

    finished = next(event for event in events if isinstance(event, LoopFinishedEvent))
    assert finished.error_kind == "internal"
    assert "duplicate capability call id" in finished.summary


@pytest.mark.asyncio
async def test_engine_normalizes_unsafe_provider_call_id_stably(engine_cls) -> None:
    unsafe_id = "provider/call:with spaces"
    model = _ScriptedModel(
        AgentModelTurn(CapabilityCall(capability="builtin:echo", call_id=unsafe_id)),
        AgentModelTurn(FinalAnswer(summary="done")),
    )
    seen_ids: list[str] = []

    async def invoke(call, snapshot):
        seen_ids.append(call.call_id)
        return Observation(capability=call.capability, ok=True)

    descriptor = AgentToolDescriptor(tool_id="builtin:echo")
    await _events(
        engine_cls(model),
        _request(),
        BoundAgentTool(descriptor, invoke),
        _RecordingContext(),
        _Completion(CompletionDirective(outcome="accept")),
    )

    assert len(seen_ids) == 1
    assert seen_ids[0].startswith("provider-call-")
    assert "/" not in seen_ids[0] and ":" not in seen_ids[0] and " " not in seen_ids[0]


@pytest.mark.parametrize(
    ("provider", "expected_type"),
    (("native", NativeAgentLoopEngine), ("langgraph", LangGraphAgentLoopEngine), ("maf", MafAgentLoopEngine)),
)
def test_sub_agent_loop_provider_selection(monkeypatch, provider, expected_type) -> None:
    monkeypatch.setenv("TASK_RUNTIME_AGENT_LOOP", provider)
    assert isinstance(_sub_agent_loop_engine(_ScriptedModel()), expected_type)


def test_sub_agent_loop_provider_defaults_to_native(monkeypatch) -> None:
    monkeypatch.delenv("TASK_RUNTIME_AGENT_LOOP", raising=False)
    assert isinstance(_sub_agent_loop_engine(_ScriptedModel()), NativeAgentLoopEngine)


def test_sub_agent_loop_provider_rejects_unknown_value(monkeypatch) -> None:
    monkeypatch.setenv("TASK_RUNTIME_AGENT_LOOP", "unknown")
    with pytest.raises(ValueError, match="Unsupported TASK_RUNTIME_AGENT_LOOP"):
        _sub_agent_loop_engine(_ScriptedModel())
