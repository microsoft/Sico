"""Microsoft Agent Framework-backed AgentLoopEngine implementation."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, replace
from typing import Never

from agent_framework import Executor, WorkflowBuilder, WorkflowContext, WorkflowEvent, handler

from .contracts import (
    AgentAction,
    AgentLoopRequest,
    AgentLoopRuntime,
    AgentLoopSnapshot,
    AgentModel,
    AgentModelOutputDelta,
    AgentModelState,
    AgentModelTurn,
    BoundAgentTool,
    CapabilityCall,
    FinalAnswer,
    InvalidAction,
    Observation,
    TokenUsage,
    current_toolset,
    stream_model_turn,
)
from .events import (
    AgentLoopEvent,
    CompletionProposedEvent,
    ContextPreparedEvent,
    LoopFinishedEvent,
    ModelOutputDeltaEvent,
    ModelTurnCompletedEvent,
    ModelTurnStartedEvent,
    ToolCallCompletedEvent,
    ToolCallRequestedEvent,
)
from .native import _call_id, _failed_observation, _normalized_call_id, _normalized_capability_id, _signature, _stalled


@dataclass(frozen=True, slots=True)
class _LoopState:
    request: AgentLoopRequest
    turn: int = 1
    history: tuple[Observation, ...] = ()
    usage: TokenUsage = TokenUsage()
    tool_calls: int = 0
    used_call_ids: frozenset[str] = frozenset()
    stall_signature: str = ""
    stall_count: int = 0
    action: AgentAction | None = None
    terminal: LoopFinishedEvent | None = None
    toolset_revision: int = 0


@dataclass(frozen=True, slots=True)
class _SicoEvent:
    event: AgentLoopEvent


class MafAgentLoopEngine:
    """Drive the bounded Sico agent loop using Microsoft Agent Framework."""

    def __init__(self, model: AgentModel) -> None:
        self._model = model

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

        model_executor = _ModelExecutor(self._model, tools, runtime)
        action_executor = _ActionExecutor(tools, runtime)
        finish_executor = _FinishExecutor()
        workflow = (
            WorkflowBuilder(
                start_executor=model_executor,
                max_iterations=max(10, request.limits.max_model_turns * 2 + 3),
            )
            .add_edge(model_executor, action_executor)
            .add_edge(action_executor, model_executor, condition=lambda state: state.terminal is None)
            .add_edge(action_executor, finish_executor, condition=lambda state: state.terminal is not None)
            .build()
        )
        stream = await workflow.run(_LoopState(request=request), stream=True)
        async for event in stream:
            if event.type == "data" and isinstance(event.data, _SicoEvent):
                yield event.data.event


class _ModelExecutor(Executor):
    def __init__(self, model: AgentModel, fallback_tools: tuple[BoundAgentTool, ...], runtime: AgentLoopRuntime) -> None:
        super().__init__(id="sico-model")
        self._model = model
        self._fallback_tools = fallback_tools
        self._runtime = runtime

    @handler
    async def complete_turn(self, state: _LoopState, ctx: WorkflowContext[_LoopState]) -> None:
        toolset = await current_toolset(self._runtime, self._fallback_tools)
        prepared = await self._runtime.context_controller.before_model(_snapshot(state, toolset.revision))
        await _emit(ctx, ContextPreparedEvent(turn=state.turn, block_count=len(prepared.blocks)))
        await _emit(ctx, ModelTurnStartedEvent(turn=state.turn))
        model_state = AgentModelState(
            task=state.request.task,
            tools=toolset.descriptors,
            turn=state.turn,
            max_model_turns=state.request.limits.max_model_turns,
            system_prompt=state.request.system_prompt,
            context=prepared.blocks,
            history=prepared.history if prepared.history is not None else state.history,
            initial_messages=state.request.initial_messages,
            toolset_revision=toolset.revision,
            provider_tools=state.request.provider_tools,
        )
        started = time.perf_counter()
        model_turn: AgentModelTurn | None = None
        async for item in stream_model_turn(self._model, model_state):
            if isinstance(item, AgentModelOutputDelta):
                await _emit(ctx, ModelOutputDeltaEvent(turn=state.turn, content=item.content))
            elif model_turn is None:
                model_turn = item
            else:
                raise RuntimeError("agent model stream emitted more than one terminal turn")
        if model_turn is None:
            raise RuntimeError("agent model stream ended without a terminal turn")
        latency_ms = model_turn.latency_ms or int((time.perf_counter() - started) * 1000)
        await _emit(ctx, ModelTurnCompletedEvent(state.turn, model_turn.usage, model_turn.model, latency_ms))
        await ctx.send_message(
            replace(
                state,
                action=model_turn.action,
                usage=state.usage + model_turn.usage,
                toolset_revision=toolset.revision,
            )
        )


class _ActionExecutor(Executor):
    def __init__(self, fallback_tools: tuple[BoundAgentTool, ...], runtime: AgentLoopRuntime) -> None:
        super().__init__(id="sico-action")
        self._fallback_tools = fallback_tools
        self._runtime = runtime

    @handler
    async def apply_action(self, state: _LoopState, ctx: WorkflowContext[_LoopState]) -> None:
        action = state.action
        if isinstance(action, FinalAnswer):
            next_state = await self._complete(state, action, ctx)
        elif isinstance(action, InvalidAction):
            next_state = self._invalid(state, action)
        elif isinstance(action, CapabilityCall):
            next_state = await self._call_tool(state, action, ctx)
        else:
            raise TypeError("action executor requires an AgentAction")
        await ctx.send_message(next_state)

    async def _complete(
        self,
        state: _LoopState,
        action: FinalAnswer,
        ctx: WorkflowContext[_LoopState],
    ) -> _LoopState:
        directive = await self._runtime.evaluate_completion(action, _snapshot(state))
        await _emit(ctx, CompletionProposedEvent(state.turn, action, directive))
        if directive.outcome == "accept":
            return replace(
                state,
                terminal=LoopFinishedEvent(
                    outcome="completed",
                    summary=action.summary,
                    output=action.output,
                    usage=state.usage,
                    model_turns=state.turn,
                    tool_calls=state.tool_calls,
                ),
            )
        reason = directive.reason or "The completion policy did not accept the proposed final answer."
        if directive.outcome == "reject":
            return replace(state, terminal=_failed_terminal(state, reason, "policy_denied"))
        history = (*state.history, _failed_observation("", _call_id(state.turn, 1), reason, "policy_deny"))
        return _continue_or_stop(state, history, _signature("final_answer", {}, reason))

    def _invalid(self, state: _LoopState, action: InvalidAction) -> _LoopState:
        message = f"Could not decode the requested action: {action.reason}"
        history = (
            *state.history,
            _failed_observation(action.capability, _call_id(state.turn, 1), message, "internal"),
        )
        return _continue_or_stop(state, history, _signature(action.capability, {}, action.reason))

    async def _call_tool(
        self,
        state: _LoopState,
        action: CapabilityCall,
        ctx: WorkflowContext[_LoopState],
    ) -> _LoopState:
        capability = _normalized_capability_id(action.capability)
        if capability is None:
            return replace(
                state,
                terminal=_failed_terminal(
                    state,
                    f"Agent requested disallowed capability {action.capability!r}.",
                    "policy_denied",
                ),
            )
        call = replace(
            action,
            capability=capability,
            call_id=_normalized_call_id(action.call_id, state.turn, 1),
        )
        if call.call_id in state.used_call_ids:
            return replace(
                state,
                terminal=_failed_terminal(
                    state,
                    f"Agent emitted duplicate capability call id {call.call_id!r}.",
                    "internal",
                ),
            )
        used_call_ids = state.used_call_ids | {call.call_id}
        toolset = await current_toolset(self._runtime, self._fallback_tools)
        tools = {tool.descriptor.tool_id: tool for tool in toolset.tools}
        tool = tools.get(call.capability)
        if tool is None:
            return replace(
                state,
                used_call_ids=used_call_ids,
                terminal=_failed_terminal(
                    state,
                    f"Agent requested disallowed capability {call.capability!r}.",
                    "policy_denied",
                ),
            )
        max_tool_calls = state.request.limits.max_tool_calls
        if max_tool_calls is not None and state.tool_calls >= max_tool_calls:
            return replace(
                state,
                used_call_ids=used_call_ids,
                terminal=_failed_terminal(
                    state,
                    f"Agent reached its capability-call budget ({max_tool_calls}).",
                    "transient",
                ),
            )

        await _emit(ctx, ToolCallRequestedEvent(state.turn, call))
        started = time.perf_counter()
        observation = await tool.invoke(call, _snapshot(state, toolset.revision))
        observation = replace(observation, arguments=call.args)
        duration_ms = int((time.perf_counter() - started) * 1000)
        tool_calls = state.tool_calls + 1
        await _emit(ctx, ToolCallCompletedEvent(state.turn, call, observation, duration_ms))
        charged_state = replace(state, usage=state.usage + observation.usage)
        return replace(
            _continue_or_stop(
            charged_state,
                (*state.history, observation),
                _signature(call.capability, call.args, ""),
                tool_calls=tool_calls,
            ),
            used_call_ids=used_call_ids,
        )


class _FinishExecutor(Executor):
    def __init__(self) -> None:
        super().__init__(id="sico-finish")

    @handler
    async def finish(self, state: _LoopState, ctx: WorkflowContext[Never, LoopFinishedEvent]) -> None:
        if state.terminal is None:
            raise RuntimeError("agent loop reached finish without a terminal event")
        await _emit(ctx, state.terminal)
        await ctx.yield_output(state.terminal)


async def _emit(ctx: WorkflowContext, event: AgentLoopEvent) -> None:
    await ctx.add_event(WorkflowEvent("data", _SicoEvent(event)))


def _continue_or_stop(
    state: _LoopState,
    history: tuple[Observation, ...],
    signature: str,
    *,
    tool_calls: int | None = None,
) -> _LoopState:
    next_tool_calls = state.tool_calls if tool_calls is None else tool_calls
    stall_signature, stall_count = _next_stall(state, signature)
    terminal = None
    stall_limit = max(1, state.request.limits.stall_limit)
    if stall_count >= stall_limit:
        terminal = _stalled(stall_limit, state.usage, state.turn, next_tool_calls)
    elif state.turn >= state.request.limits.max_model_turns:
        terminal = _turn_budget_exhausted(state.request, state.usage, next_tool_calls)
    return replace(
        state,
        turn=state.turn if terminal is not None else state.turn + 1,
        history=history,
        tool_calls=next_tool_calls,
        stall_signature=stall_signature,
        stall_count=stall_count,
        action=None,
        terminal=terminal,
    )


def _next_stall(state: _LoopState, signature: str) -> tuple[str, int]:
    if signature != state.stall_signature:
        return signature, 1
    return signature, state.stall_count + 1


def _snapshot(state: _LoopState, toolset_revision: int | None = None) -> AgentLoopSnapshot:
    return AgentLoopSnapshot(
        state.request,
        state.turn,
        state.history,
        state.usage,
        state.tool_calls,
        state.toolset_revision if toolset_revision is None else toolset_revision,
    )


def _failed_terminal(state: _LoopState, summary: str, error_kind: str) -> LoopFinishedEvent:
    return LoopFinishedEvent(
        outcome="failed",
        summary=summary,
        error_kind=error_kind,
        usage=state.usage,
        model_turns=state.turn,
        tool_calls=state.tool_calls,
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
