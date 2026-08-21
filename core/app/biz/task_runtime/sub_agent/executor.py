"""Host a bounded sub-agent loop inside the durable ``TaskRun`` lifecycle."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from ..capabilities.descriptors import CapabilityDescriptor
from ..capabilities.ids import normalize_capability_id
from ..domain.models import ErrorClass, TaskResult, TaskRun, TaskStatus
from ..storage.run_store import RunStore
from ..domain.time import now_ms as _now_ms
from .invoker import AgentInvocationContext, CapabilityInvoker
from .loop import (
    AgentContextController,
    AgentLoopEngine,
    AgentLoopLimits,
    AgentLoopRequest,
    AgentLoopRuntime,
    AgentLoopSnapshot,
    AgentTask,
    AgentToolDescriptor,
    BoundAgentTool,
    CapabilityCall,
    CompletionDirective,
    FinalAnswer,
    LoopFinishedEvent,
    Observation,
    StaticContextController,
    ToolCallRequestedEvent,
)
from .profile import AgentProfile, AgentProfileResolver, CompletionPolicyContext, ceiling_allows

DEFAULT_MAX_MODEL_TURNS = 12
DEFAULT_STALL_LIMIT = 3


@dataclass(frozen=True, slots=True)
class AgentExecutorOptions:
    default_max_model_turns: int = DEFAULT_MAX_MODEL_TURNS
    default_max_tool_calls: int | None = None
    stall_limit: int = DEFAULT_STALL_LIMIT
    worker_id: str = "sub-agent-executor"


class SubAgentExecutor:
    """Hosts one framework-neutral agent engine inside the TaskRun lifecycle."""

    def __init__(
        self,
        engine: AgentLoopEngine,
        invoker: CapabilityInvoker,
        *,
        profile_resolver: AgentProfileResolver,
        context_controller: AgentContextController | None = None,
        options: AgentExecutorOptions | None = None,
    ) -> None:
        options = options or AgentExecutorOptions()
        self._engine = engine
        self._invoker = invoker
        self._profile_resolver = profile_resolver
        self._context_controller = context_controller or StaticContextController()
        self._default_max_model_turns = options.default_max_model_turns
        self._default_max_tool_calls = options.default_max_tool_calls
        self._stall_limit = max(1, options.stall_limit)
        self._worker_id = options.worker_id

    async def run(self, run: TaskRun, store: RunStore) -> TaskResult:
        token = await store.claim_run(run.run_id, self._worker_id)
        started_at = _now_ms()
        dispatch = run.spec.dispatch

        profile_id = getattr(dispatch, "profile_id", "")
        profile = self._profile_resolver.resolve(profile_id)
        if profile is None:
            result = _failed(run, started_at, ErrorClass.POLICY_DENY, f"Unknown agent profile {profile_id!r}.")
            await store.write_result(run.run_id, result, token)
            return result

        capability_descriptors = await self._effective_capability_descriptors(dispatch, profile, run)
        max_model_turns = getattr(dispatch, "max_model_turns", None) or self._default_max_model_turns
        descriptors = tuple(
            AgentToolDescriptor(
                tool_id=descriptor.capability_id,
                description=descriptor.description,
                parameter_schema=descriptor.parameter_schema,
            )
            for descriptor in capability_descriptors
        )
        tools = tuple(self._bind_tool(run, profile, descriptor) for descriptor in descriptors)
        request = AgentLoopRequest(
            engine_run_id=run.run_id,
            task=AgentTask(
                title=run.spec.title,
                instructions=run.spec.instructions,
                arguments=run.spec.args,
            ),
            system_prompt=profile.system_prompt,
            tools=descriptors,
            limits=AgentLoopLimits(
                max_model_turns=max_model_turns,
                max_tool_calls=self._default_max_tool_calls,
                allow_parallel_tool_calls=False,
                stall_limit=self._stall_limit,
            ),
        )
        try:
            result = await self._consume_engine(run, store, request, tools, profile, started_at)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - surface any loop fault as a failed run.
            result = _failed(run, started_at, ErrorClass.INTERNAL, f"Sub-agent loop crashed: {exc}")
        await store.write_result(run.run_id, result, token)
        return result

    async def _effective_capability_descriptors(
        self,
        dispatch: object,
        profile: AgentProfile,
        run: TaskRun,
    ) -> tuple[CapabilityDescriptor, ...]:
        """Intersect request/profile grants, then ask the invoker for live availability."""
        effective: list[str] = []
        seen: set[str] = set()
        ceiling = profile.capability_ceiling
        for requested in getattr(dispatch, "capability_grants", ()) or ():
            capability_id = normalize_capability_id(requested)
            if capability_id in seen:
                continue
            seen.add(capability_id)
            if not ceiling_allows(ceiling, capability_id):
                continue
            effective.append(capability_id)
        return await self._invoker.available_descriptors(run, tuple(effective))

    def _bind_tool(
        self,
        run: TaskRun,
        profile: AgentProfile,
        descriptor: AgentToolDescriptor,
    ) -> BoundAgentTool:
        async def invoke(call: CapabilityCall, snapshot: AgentLoopSnapshot) -> Observation:
            return await self._invoker.invoke(
                run,
                call,
                AgentInvocationContext(
                    profile_id=profile.profile_id,
                    step=snapshot.turn,
                    policies=profile.invocation_policies,
                    history=snapshot.history,
                ),
            )

        return BoundAgentTool(descriptor=descriptor, invoke=invoke)

    async def _consume_engine(
        self,
        run: TaskRun,
        store: RunStore,
        request: AgentLoopRequest,
        tools: tuple[BoundAgentTool, ...],
        profile: AgentProfile,
        started_at: int,
    ) -> TaskResult:
        async def evaluate_completion(
            proposal: FinalAnswer,
            snapshot: AgentLoopSnapshot,
        ) -> CompletionDirective:
            decision = await profile.completion_policy.evaluate(
                CompletionPolicyContext(
                    run=run,
                    profile_id=profile.profile_id,
                    step=snapshot.turn,
                    history=snapshot.history,
                ),
                proposal,
            )
            return CompletionDirective(outcome=decision.outcome, reason=decision.reason)

        runtime = AgentLoopRuntime(
            context_controller=self._context_controller,
            evaluate_completion=evaluate_completion,
        )
        finished: LoopFinishedEvent | None = None
        async for event in self._engine.run(
            request,
            tools=tools,
            runtime=runtime,
        ):
            if isinstance(event, ToolCallRequestedEvent):
                await store.set_progress(run.run_id, f"step {event.turn}: {event.call.capability}", ts=_now_ms())
            elif isinstance(event, LoopFinishedEvent):
                finished = event
        if finished is None:
            return _failed(run, started_at, ErrorClass.INTERNAL, "Agent loop ended without a terminal event.")
        return _result_from_loop(run, started_at, finished)


def _result_from_loop(run: TaskRun, started_at: int, finished: LoopFinishedEvent) -> TaskResult:
    metrics = {
        "model_turns": finished.model_turns,
        "tool_calls": finished.tool_calls,
        "input_tokens": finished.usage.input_tokens,
        "output_tokens": finished.usage.output_tokens,
        "total_tokens": finished.usage.total_tokens,
        "cached_input_tokens": finished.usage.cached_input_tokens,
        "reasoning_tokens": finished.usage.reasoning_tokens,
    }
    if finished.outcome == "completed":
        return _completed(run, started_at, finished.summary, finished.output, metrics)
    error_class = {
        "policy_denied": ErrorClass.POLICY_DENY,
        "transient": ErrorClass.TRANSIENT,
    }.get(finished.error_kind, ErrorClass.INTERNAL)
    return _failed(run, started_at, error_class, finished.summary, metrics)


def _completed(
    run: TaskRun,
    started_at: int,
    summary: str,
    output: str,
    metrics: dict[str, int] | None = None,
) -> TaskResult:
    ended_at = _now_ms()
    return TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.COMPLETED,
        title=run.spec.title,
        summary=summary or "Sub-agent completed.",
        output=output or summary,
        sandbox=run.sandbox,
        started_at=started_at,
        ended_at=ended_at,
        duration_ms=max(0, ended_at - started_at),
        metrics=metrics or {},
    )


def _failed(
    run: TaskRun,
    started_at: int,
    error_class: ErrorClass,
    message: str,
    metrics: dict[str, int] | None = None,
) -> TaskResult:
    ended_at = _now_ms()
    return TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.FAILED,
        title=run.spec.title,
        summary=message,
        error_class=error_class,
        error_message=message,
        sandbox=run.sandbox,
        started_at=started_at,
        ended_at=ended_at,
        duration_ms=max(0, ended_at - started_at),
        metrics=metrics or {},
    )
