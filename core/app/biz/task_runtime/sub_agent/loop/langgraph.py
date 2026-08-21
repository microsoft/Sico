"""LangGraph-backed AgentLoopEngine implementation."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, replace
from typing import Literal, TypedDict

from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime
from langgraph.types import StreamWriter

from .contracts import (
    AgentAction,
    AgentLoopRequest,
    AgentLoopRuntime,
    AgentLoopSnapshot,
    AgentModel,
    AgentModelState,
    BoundAgentTool,
    CapabilityCall,
    FinalAnswer,
    InvalidAction,
    Observation,
    TokenUsage,
)
from .events import (
    AgentLoopEvent,
    CompletionProposedEvent,
    ContextPreparedEvent,
    LoopFinishedEvent,
    ModelTurnCompletedEvent,
    ModelTurnStartedEvent,
    ToolCallCompletedEvent,
    ToolCallRequestedEvent,
)
from .native import _call_id, _failed_observation, _normalized_call_id, _signature, _stalled


class _GraphState(TypedDict):
    request: AgentLoopRequest
    turn: int
    history: tuple[Observation, ...]
    usage: TokenUsage
    tool_calls: int
    used_call_ids: frozenset[str]
    stall_signature: str
    stall_count: int
    action: AgentAction | None
    terminal: LoopFinishedEvent | None


@dataclass(frozen=True, slots=True)
class _GraphContext:
    model: AgentModel
    tools: Mapping[str, BoundAgentTool]
    runtime: AgentLoopRuntime


class LangGraphAgentLoopEngine:
    """Drive the bounded Sico agent loop using LangGraph for orchestration."""

    def __init__(self, model: AgentModel) -> None:
        self._model = model
        self._graph = _build_graph()

    async def run(
        self,
        request: AgentLoopRequest,
        *,
        tools: tuple[BoundAgentTool, ...],
        runtime: AgentLoopRuntime,
    ) -> AsyncIterator[AgentLoopEvent]:
        if request.limits.max_model_turns <= 0:
            yield _turn_budget_exhausted(request, TokenUsage(), 0)
            return

        initial_state: _GraphState = {
            "request": request,
            "turn": 1,
            "history": (),
            "usage": TokenUsage(),
            "tool_calls": 0,
            "used_call_ids": frozenset(),
            "stall_signature": "",
            "stall_count": 0,
            "action": None,
            "terminal": None,
        }
        context = _GraphContext(
            model=self._model,
            tools={tool.descriptor.tool_id: tool for tool in tools},
            runtime=runtime,
        )
        config = {"recursion_limit": max(10, request.limits.max_model_turns * 3 + 3)}
        async for part in self._graph.astream(
            initial_state,
            config=config,
            context=context,
            stream_mode="custom",
            version="v2",
        ):
            yield part["data"]


def _build_graph():
    builder = StateGraph(_GraphState, context_schema=_GraphContext)
    builder.add_node("model", _model_node)
    builder.add_node("tool", _tool_node)
    builder.add_node("completion", _completion_node)
    builder.add_node("invalid", _invalid_node)
    builder.add_node("finish", _finish_node)
    builder.add_edge(START, "model")
    builder.add_conditional_edges("model", _route_action)
    builder.add_conditional_edges("tool", _route_after_action)
    builder.add_conditional_edges("completion", _route_after_action)
    builder.add_conditional_edges("invalid", _route_after_action)
    builder.add_edge("finish", END)
    return builder.compile()


async def _model_node(
    state: _GraphState,
    runtime: Runtime[_GraphContext],
    writer: StreamWriter,
) -> dict[str, object]:
    snapshot = _snapshot(state)
    prepared = await runtime.context.runtime.context_controller.before_model(snapshot)
    writer(ContextPreparedEvent(turn=state["turn"], block_count=len(prepared.blocks)))
    writer(ModelTurnStartedEvent(turn=state["turn"]))
    model_state = AgentModelState(
        task=state["request"].task,
        tools=state["request"].tools,
        turn=state["turn"],
        max_model_turns=state["request"].limits.max_model_turns,
        system_prompt=state["request"].system_prompt,
        context=prepared.blocks,
        history=prepared.history if prepared.history is not None else state["history"],
        initial_messages=state["request"].initial_messages,
    )
    started = time.perf_counter()
    model_turn = await runtime.context.model.complete_turn(model_state)
    latency_ms = model_turn.latency_ms or int((time.perf_counter() - started) * 1000)
    usage = state["usage"] + model_turn.usage
    writer(ModelTurnCompletedEvent(state["turn"], model_turn.usage, model_turn.model, latency_ms))
    return {"action": model_turn.action, "usage": usage}


async def _completion_node(
    state: _GraphState,
    runtime: Runtime[_GraphContext],
    writer: StreamWriter,
) -> dict[str, object]:
    action = state["action"]
    if not isinstance(action, FinalAnswer):
        raise TypeError("completion node requires a FinalAnswer")
    directive = await runtime.context.runtime.evaluate_completion(action, _snapshot(state))
    writer(CompletionProposedEvent(state["turn"], action, directive))
    if directive.outcome == "accept":
        return {
            "terminal": LoopFinishedEvent(
                outcome="completed",
                summary=action.summary,
                output=action.output,
                usage=state["usage"],
                model_turns=state["turn"],
                tool_calls=state["tool_calls"],
            )
        }
    reason = directive.reason or "The completion policy did not accept the proposed final answer."
    if directive.outcome == "reject":
        return {
            "terminal": LoopFinishedEvent(
                outcome="failed",
                summary=reason,
                error_kind="policy_denied",
                usage=state["usage"],
                model_turns=state["turn"],
                tool_calls=state["tool_calls"],
            )
        }
    history = (*state["history"], _failed_observation("", _call_id(state["turn"], 1), reason, "policy_deny"))
    return _continue_or_stop(state, history, _signature("final_answer", {}, reason), failed=True)


async def _tool_node(
    state: _GraphState,
    runtime: Runtime[_GraphContext],
    writer: StreamWriter,
) -> dict[str, object]:
    action = state["action"]
    if not isinstance(action, CapabilityCall):
        raise TypeError("tool node requires a CapabilityCall")
    call = replace(action, call_id=_normalized_call_id(action.call_id, state["turn"], 1))
    if call.call_id in state["used_call_ids"]:
        return {
            "terminal": _failed_terminal(
                state,
                f"Agent emitted duplicate capability call id {call.call_id!r}.",
                "internal",
            )
        }
    used_call_ids = state["used_call_ids"] | {call.call_id}
    tool = runtime.context.tools.get(call.capability)
    if tool is None:
        return {
            "used_call_ids": used_call_ids,
            "terminal": _failed_terminal(state, f"Agent requested disallowed capability {call.capability!r}.", "policy_denied"),
        }
    max_tool_calls = state["request"].limits.max_tool_calls
    if max_tool_calls is not None and state["tool_calls"] >= max_tool_calls:
        return {
            "used_call_ids": used_call_ids,
            "terminal": _failed_terminal(
                state,
                f"Agent reached its capability-call budget ({max_tool_calls}).",
                "transient",
            ),
        }

    writer(ToolCallRequestedEvent(state["turn"], call))
    started = time.perf_counter()
    observation = await tool.invoke(call, _snapshot(state))
    duration_ms = int((time.perf_counter() - started) * 1000)
    tool_calls = state["tool_calls"] + 1
    history = (*state["history"], observation)
    writer(ToolCallCompletedEvent(state["turn"], call, observation, duration_ms))
    updates = _continue_or_stop(
        state,
        history,
        _signature(call.capability, call.args, ""),
        failed=not observation.ok,
        tool_calls=tool_calls,
    )
    updates["used_call_ids"] = used_call_ids
    return updates


async def _invalid_node(state: _GraphState) -> dict[str, object]:
    action = state["action"]
    if not isinstance(action, InvalidAction):
        raise TypeError("invalid node requires an InvalidAction")
    message = f"Could not decode the requested action: {action.reason}"
    history = (
        *state["history"],
        _failed_observation(action.capability, _call_id(state["turn"], 1), message, "internal"),
    )
    return _continue_or_stop(state, history, _signature(action.capability, {}, action.reason), failed=True)


async def _finish_node(state: _GraphState, writer: StreamWriter) -> dict[str, object]:
    terminal = state["terminal"]
    if terminal is None:
        raise RuntimeError("agent loop reached finish without a terminal event")
    writer(terminal)
    return {}


def _route_action(state: _GraphState) -> Literal["completion", "invalid", "tool"]:
    if isinstance(state["action"], FinalAnswer):
        return "completion"
    if isinstance(state["action"], InvalidAction):
        return "invalid"
    return "tool"


def _route_after_action(state: _GraphState) -> Literal["finish", "model"]:
    return "finish" if state["terminal"] is not None else "model"


def _continue_or_stop(
    state: _GraphState,
    history: tuple[Observation, ...],
    signature: str,
    *,
    failed: bool,
    tool_calls: int | None = None,
) -> dict[str, object]:
    next_tool_calls = state["tool_calls"] if tool_calls is None else tool_calls
    stall_signature, stall_count = _next_stall(state, signature, failed=failed)
    updates: dict[str, object] = {
        "history": history,
        "tool_calls": next_tool_calls,
        "stall_signature": stall_signature,
        "stall_count": stall_count,
        "action": None,
    }
    stall_limit = max(1, state["request"].limits.stall_limit)
    if stall_count >= stall_limit:
        updates["terminal"] = _stalled(stall_limit, state["usage"], state["turn"], next_tool_calls)
    elif state["turn"] >= state["request"].limits.max_model_turns:
        updates["terminal"] = _turn_budget_exhausted(state["request"], state["usage"], next_tool_calls)
    else:
        updates["turn"] = state["turn"] + 1
    return updates


def _next_stall(state: _GraphState, signature: str, *, failed: bool) -> tuple[str, int]:
    if not failed:
        return "", 0
    if signature != state["stall_signature"]:
        return signature, 1
    return signature, state["stall_count"] + 1


def _snapshot(state: _GraphState) -> AgentLoopSnapshot:
    return AgentLoopSnapshot(
        state["request"],
        state["turn"],
        state["history"],
        state["usage"],
        state["tool_calls"],
    )


def _failed_terminal(
    state: _GraphState,
    summary: str,
    error_kind: Literal["policy_denied", "transient", "internal"],
) -> LoopFinishedEvent:
    return LoopFinishedEvent(
        outcome="failed",
        summary=summary,
        error_kind=error_kind,
        usage=state["usage"],
        model_turns=state["turn"],
        tool_calls=state["tool_calls"],
    )


def _turn_budget_exhausted(request: AgentLoopRequest, usage: TokenUsage, tool_calls: int) -> LoopFinishedEvent:
    return LoopFinishedEvent(
        outcome="failed",
        summary=f"Agent reached its model-turn budget ({request.limits.max_model_turns}) without a final answer.",
        error_kind="transient",
        usage=usage,
        model_turns=request.limits.max_model_turns,
        tool_calls=tool_calls,
    )
