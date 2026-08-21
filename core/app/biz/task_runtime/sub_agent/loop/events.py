"""Typed events emitted by every AgentLoopEngine implementation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, TypeAlias

if TYPE_CHECKING:
    from .contracts import AgentContent, CapabilityCall, CompletionDirective, FinalAnswer, Observation, TokenUsage


@dataclass(frozen=True, slots=True)
class ModelTurnStartedEvent:
    turn: int


@dataclass(frozen=True, slots=True)
class ModelTurnCompletedEvent:
    turn: int
    usage: TokenUsage
    model: str = ""
    latency_ms: int = 0


@dataclass(frozen=True, slots=True)
class ModelOutputDeltaEvent:
    turn: int
    content: AgentContent


@dataclass(frozen=True, slots=True)
class ToolCallRequestedEvent:
    turn: int
    call: CapabilityCall


@dataclass(frozen=True, slots=True)
class ToolCallCompletedEvent:
    turn: int
    call: CapabilityCall
    observation: Observation
    duration_ms: int


@dataclass(frozen=True, slots=True)
class CompletionProposedEvent:
    turn: int
    proposal: FinalAnswer
    directive: CompletionDirective


@dataclass(frozen=True, slots=True)
class ContextPreparedEvent:
    turn: int
    block_count: int


@dataclass(frozen=True, slots=True)
class LoopFinishedEvent:
    outcome: Literal["completed", "failed"]
    summary: str
    usage: TokenUsage
    output: str = ""
    error_kind: Literal["", "policy_denied", "transient", "internal"] = ""
    model_turns: int = 0
    tool_calls: int = 0


AgentLoopEvent: TypeAlias = (
    ModelTurnStartedEvent
    | ModelTurnCompletedEvent
    | ModelOutputDeltaEvent
    | ToolCallRequestedEvent
    | ToolCallCompletedEvent
    | CompletionProposedEvent
    | ContextPreparedEvent
    | LoopFinishedEvent
)
