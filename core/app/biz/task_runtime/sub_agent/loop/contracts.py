"""Framework-neutral inputs and extension ports for an agent loop engine."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Literal, Protocol, TypeAlias

from .events import AgentLoopEvent


@dataclass(frozen=True, slots=True)
class AgentContent:
    type: Literal["text", "json", "image", "artifact"]
    text: str = ""
    uri: str = ""
    mime_type: str = ""
    metadata: Mapping[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class AgentMessage:
    role: Literal["system", "user", "assistant", "tool"]
    contents: tuple[AgentContent, ...]
    name: str = ""
    call_id: str = ""


@dataclass(frozen=True, slots=True)
class AgentTask:
    title: str
    instructions: str = ""
    arguments: Mapping[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class AgentContextBlock:
    source: str
    content: str
    title: str = ""
    contents: tuple[AgentContent, ...] = ()
    metadata: Mapping[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class AgentToolDescriptor:
    tool_id: str
    description: str = ""
    parameter_schema: Mapping[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class AgentLoopLimits:
    max_model_turns: int
    max_tool_calls: int | None = None
    allow_parallel_tool_calls: bool = False
    stall_limit: int = 3


@dataclass(frozen=True, slots=True)
class AgentLoopRequest:
    engine_run_id: str
    task: AgentTask
    system_prompt: str
    tools: tuple[AgentToolDescriptor, ...]
    limits: AgentLoopLimits
    context: tuple[AgentContextBlock, ...] = ()
    initial_messages: tuple[AgentMessage, ...] = ()


@dataclass(frozen=True, slots=True)
class TokenUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    cached_input_tokens: int = 0
    reasoning_tokens: int = 0

    def __add__(self, other: TokenUsage) -> TokenUsage:
        return TokenUsage(
            input_tokens=self.input_tokens + other.input_tokens,
            output_tokens=self.output_tokens + other.output_tokens,
            total_tokens=self.total_tokens + other.total_tokens,
            cached_input_tokens=self.cached_input_tokens + other.cached_input_tokens,
            reasoning_tokens=self.reasoning_tokens + other.reasoning_tokens,
        )


@dataclass(frozen=True, slots=True)
class CapabilityCall:
    capability: str
    args: dict[str, object] = field(default_factory=dict)
    call_id: str = ""


@dataclass(frozen=True, slots=True)
class FinalAnswer:
    summary: str
    output: str = ""


@dataclass(frozen=True, slots=True)
class InvalidAction:
    reason: str
    capability: str = ""


AgentAction: TypeAlias = CapabilityCall | FinalAnswer | InvalidAction


@dataclass(frozen=True, slots=True)
class Observation:
    capability: str
    ok: bool
    content: str = ""
    call_id: str = ""
    run_id: str = ""
    status: str = ""
    summary: str = ""
    error_class: str = ""
    error_message: str = ""
    artifacts: tuple[str, ...] = ()
    contents: tuple[AgentContent, ...] = ()


@dataclass(frozen=True, slots=True)
class PreparedModelContext:
    blocks: tuple[AgentContextBlock, ...]
    history: tuple[Observation, ...] | None = None


@dataclass(frozen=True, slots=True)
class AgentLoopSnapshot:
    request: AgentLoopRequest
    turn: int
    history: tuple[Observation, ...]
    usage: TokenUsage = TokenUsage()
    tool_call_count: int = 0


@dataclass(frozen=True, slots=True)
class AgentModelState:
    task: AgentTask
    tools: tuple[AgentToolDescriptor, ...]
    turn: int
    max_model_turns: int
    system_prompt: str
    context: tuple[AgentContextBlock, ...] = ()
    history: tuple[Observation, ...] = ()
    initial_messages: tuple[AgentMessage, ...] = ()

    @property
    def capabilities(self) -> tuple[str, ...]:
        return tuple(tool.tool_id for tool in self.tools)

    @property
    def step(self) -> int:
        return self.turn


@dataclass(frozen=True, slots=True)
class AgentModelTurn:
    action: AgentAction
    usage: TokenUsage = TokenUsage()
    model: str = ""
    latency_ms: int = 0


class AgentModel(Protocol):
    async def complete_turn(self, state: AgentModelState) -> AgentModelTurn: ...


ToolCallback: TypeAlias = Callable[[CapabilityCall, AgentLoopSnapshot], Awaitable[Observation]]


@dataclass(frozen=True, slots=True)
class BoundAgentTool:
    descriptor: AgentToolDescriptor
    invoke: ToolCallback


class AgentContextController(Protocol):
    async def before_model(self, snapshot: AgentLoopSnapshot) -> PreparedModelContext: ...


@dataclass(frozen=True, slots=True)
class StaticContextController:
    async def before_model(self, snapshot: AgentLoopSnapshot) -> PreparedModelContext:
        return PreparedModelContext(blocks=snapshot.request.context)


@dataclass(frozen=True, slots=True)
class CompletionDirective:
    outcome: Literal["accept", "continue", "reject"]
    reason: str = ""


CompletionEvaluator: TypeAlias = Callable[[FinalAnswer, AgentLoopSnapshot], Awaitable[CompletionDirective]]


@dataclass(frozen=True, slots=True)
class AgentLoopRuntime:
    context_controller: AgentContextController
    evaluate_completion: CompletionEvaluator


class AgentLoopEngine(Protocol):
    def run(
        self,
        request: AgentLoopRequest,
        *,
        tools: tuple[BoundAgentTool, ...],
        runtime: AgentLoopRuntime,
    ) -> AsyncIterator[AgentLoopEvent]: ...
