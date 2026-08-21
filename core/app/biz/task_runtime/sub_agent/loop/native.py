"""Native one-model-action-per-turn AgentLoopEngine implementation."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
from collections.abc import AsyncIterator, Mapping
from dataclasses import replace

from .contracts import (
    AgentLoopRequest,
    AgentLoopRuntime,
    AgentLoopSnapshot,
    AgentModel,
    AgentModelState,
    BoundAgentTool,
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


class NativeAgentLoopEngine:
    """Drive the native bounded loop without owning host persistence or policy."""

    def __init__(self, model: AgentModel) -> None:
        self._model = model

    async def run(  # noqa: PLR0911 - each terminal event immediately closes the async stream.
        self,
        request: AgentLoopRequest,
        *,
        tools: tuple[BoundAgentTool, ...],
        runtime: AgentLoopRuntime,
    ) -> AsyncIterator[AgentLoopEvent]:
        bound = {tool.descriptor.tool_id: tool for tool in tools}
        history: list[Observation] = []
        usage = TokenUsage()
        tool_calls = 0
        used_call_ids: set[str] = set()
        stall = _StallDetector(max(1, request.limits.stall_limit))

        try:
            for turn in range(1, request.limits.max_model_turns + 1):
                snapshot = AgentLoopSnapshot(request, turn, tuple(history), usage, tool_calls)
                prepared = await runtime.context_controller.before_model(snapshot)
                yield ContextPreparedEvent(turn=turn, block_count=len(prepared.blocks))
                yield ModelTurnStartedEvent(turn=turn)
                model_state = AgentModelState(
                    task=request.task,
                    tools=request.tools,
                    turn=turn,
                    max_model_turns=request.limits.max_model_turns,
                    system_prompt=request.system_prompt,
                    context=prepared.blocks,
                    history=prepared.history if prepared.history is not None else tuple(history),
                    initial_messages=request.initial_messages,
                )
                started = time.perf_counter()
                model_turn = await self._model.complete_turn(model_state)
                latency_ms = model_turn.latency_ms or int((time.perf_counter() - started) * 1000)
                usage += model_turn.usage
                yield ModelTurnCompletedEvent(turn, model_turn.usage, model_turn.model, latency_ms)
                action = model_turn.action

                if isinstance(action, FinalAnswer):
                    snapshot = AgentLoopSnapshot(request, turn, tuple(history), usage, tool_calls)
                    directive = await runtime.evaluate_completion(action, snapshot)
                    yield CompletionProposedEvent(turn, action, directive)
                    if directive.outcome == "accept":
                        yield LoopFinishedEvent(
                            outcome="completed",
                            summary=action.summary,
                            output=action.output,
                            usage=usage,
                            model_turns=turn,
                            tool_calls=tool_calls,
                        )
                        return
                    reason = directive.reason or "The completion policy did not accept the proposed final answer."
                    if directive.outcome == "reject":
                        yield LoopFinishedEvent(
                            outcome="failed",
                            summary=reason,
                            error_kind="policy_denied",
                            usage=usage,
                            model_turns=turn,
                            tool_calls=tool_calls,
                        )
                        return
                    history.append(_failed_observation("", _call_id(turn, 1), reason, "policy_deny"))
                    if stall.record(_signature("final_answer", {}, reason), failed=True):
                        yield _stalled(stall.limit, usage, turn, tool_calls)
                        return
                    continue

                if isinstance(action, InvalidAction):
                    message = f"Could not decode the requested action: {action.reason}"
                    history.append(_failed_observation(action.capability, _call_id(turn, 1), message, "internal"))
                    if stall.record(_signature(action.capability, {}, action.reason), failed=True):
                        yield _stalled(stall.limit, usage, turn, tool_calls)
                        return
                    continue

                call = replace(action, call_id=_normalized_call_id(action.call_id, turn, 1))
                if call.call_id in used_call_ids:
                    yield LoopFinishedEvent(
                        outcome="failed",
                        summary=f"Agent emitted duplicate capability call id {call.call_id!r}.",
                        error_kind="internal",
                        usage=usage,
                        model_turns=turn,
                        tool_calls=tool_calls,
                    )
                    return
                used_call_ids.add(call.call_id)
                tool = bound.get(call.capability)
                if tool is None:
                    yield LoopFinishedEvent(
                        outcome="failed",
                        summary=f"Agent requested disallowed capability {call.capability!r}.",
                        error_kind="policy_denied",
                        usage=usage,
                        model_turns=turn,
                        tool_calls=tool_calls,
                    )
                    return
                if request.limits.max_tool_calls is not None and tool_calls >= request.limits.max_tool_calls:
                    yield LoopFinishedEvent(
                        outcome="failed",
                        summary=f"Agent reached its capability-call budget ({request.limits.max_tool_calls}).",
                        error_kind="transient",
                        usage=usage,
                        model_turns=turn,
                        tool_calls=tool_calls,
                    )
                    return

                yield ToolCallRequestedEvent(turn, call)
                snapshot = AgentLoopSnapshot(request, turn, tuple(history), usage, tool_calls)
                tool_started = time.perf_counter()
                observation = await tool.invoke(call, snapshot)
                duration_ms = int((time.perf_counter() - tool_started) * 1000)
                tool_calls += 1
                history.append(observation)
                yield ToolCallCompletedEvent(turn, call, observation, duration_ms)
                if stall.record(_signature(call.capability, call.args, ""), failed=not observation.ok):
                    yield _stalled(stall.limit, usage, turn, tool_calls)
                    return

            yield LoopFinishedEvent(
                outcome="failed",
                summary=f"Agent reached its model-turn budget ({request.limits.max_model_turns}) without a final answer.",
                error_kind="transient",
                usage=usage,
                model_turns=request.limits.max_model_turns,
                tool_calls=tool_calls,
            )
        except asyncio.CancelledError:
            # Never translate process cancellation into a model-visible or terminal
            # outcome. Awaited model/tool calls receive the same cancellation and
            # own cleanup of resources they acquired.
            raise


class _StallDetector:
    def __init__(self, limit: int) -> None:
        self.limit = limit
        self._signature = ""
        self._count = 0

    def record(self, signature: str, *, failed: bool) -> bool:
        if not failed:
            self._signature = ""
            self._count = 0
            return False
        if signature != self._signature:
            self._signature = signature
            self._count = 1
        else:
            self._count += 1
        return self._count >= self.limit


def _call_id(turn: int, call_index: int) -> str:
    return f"turn-{turn}-call-{call_index}"


_SAFE_CALL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def _normalized_call_id(value: str, turn: int, call_index: int) -> str:
    raw = value.strip()
    if not raw:
        return _call_id(turn, call_index)
    if _SAFE_CALL_ID.fullmatch(raw):
        return raw
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:20]
    return f"provider-call-{digest}"


def _signature(capability: str, args: Mapping[str, object], reason: str) -> str:
    try:
        rendered = json.dumps(args, sort_keys=True, default=str, ensure_ascii=False)
    except (TypeError, ValueError):
        rendered = repr(args)
    return f"{capability}|{rendered}|{reason}"


def _failed_observation(capability: str, call_id: str, message: str, error_class: str) -> Observation:
    return Observation(
        capability=capability,
        ok=False,
        content=message,
        call_id=call_id,
        status="failed",
        summary=message,
        error_class=error_class,
        error_message=message,
    )


def _stalled(limit: int, usage: TokenUsage, turns: int, tool_calls: int) -> LoopFinishedEvent:
    return LoopFinishedEvent(
        outcome="failed",
        summary=f"Agent repeated the same failing action {limit} times without progress; stopping early.",
        error_kind="transient",
        usage=usage,
        model_turns=turns,
        tool_calls=tool_calls,
    )
