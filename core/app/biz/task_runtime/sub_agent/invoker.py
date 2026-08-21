"""Bridge sub-agent capability calls into persisted child ``TaskRun`` records."""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass
from typing import Protocol

from ..capabilities.descriptors import (
    CapabilityBinding,
    CapabilityDescriptor,
    ResolveContext,
    split_sensitive_arguments,
)
from ..capabilities.ids import normalize_capability_id
from ..capabilities.resolver import CapabilityResolver
from ..capabilities.executor import CapabilityExecutionPolicy
from ..domain.models import CapabilityDispatch, ErrorClass, TaskDetail, TaskResult, TaskRun, TaskSpec, TaskStatus
from ..domain.state_machine import TERMINAL_RUN_STATUSES
from ..storage.run_store import IdempotencyCollisionError, RunStore
from ..domain.time import now_ms as _now_ms
from .loop import CapabilityCall, Observation
from .profile import InvocationPolicy, InvocationPolicyContext


@dataclass(frozen=True, slots=True)
class AgentInvocationContext:
    """Profile policy state attached to one model-proposed capability call."""

    profile_id: str
    step: int
    policies: tuple[InvocationPolicy, ...]
    history: tuple[Observation, ...]


class CapabilityInvoker(Protocol):
    """Resolve and execute allow-listed capabilities for the sub-agent loop."""

    async def available_descriptors(
        self,
        run: TaskRun,
        capability_ids: tuple[str, ...],
    ) -> tuple[CapabilityDescriptor, ...]: ...

    async def invoke(
        self,
        run: TaskRun,
        call: CapabilityCall,
        context: AgentInvocationContext,
    ) -> Observation: ...


class ResolvedCapabilityExecutor(Protocol):
    """Capability lifecycle accepting a binding resolved by the nested caller."""

    async def run_resolved(
        self,
        run: TaskRun,
        store: RunStore,
        binding: CapabilityBinding,
        policy: CapabilityExecutionPolicy | None = None,
    ) -> TaskResult: ...


@dataclass(frozen=True, slots=True)
class _ProfileCapabilityPolicy:
    context: AgentInvocationContext
    call: CapabilityCall

    async def denial_reason(
        self,
        run: TaskRun,
        descriptor: CapabilityDescriptor,
    ) -> str | None:
        policy_context = InvocationPolicyContext(
            run=run,
            profile_id=self.context.profile_id,
            step=self.context.step,
            descriptor=descriptor,
            history=self.context.history,
        )
        for policy in self.context.policies:
            decision = await policy.evaluate(policy_context, self.call)
            if not decision.allowed:
                return decision.reason or f"Invocation policy denied {self.call.capability!r}."
        return None


class RunCapabilityInvoker:
    """Derive and persist one child run for each sub-agent capability call.

    The binding is resolved once, before persistence, so sensitive arguments can
    be separated and policy evaluates the same descriptor the handler executes.
    A deterministic child id makes a replay reuse the recorded result instead of
    repeating a side effect.
    """

    def __init__(
        self,
        executor: ResolvedCapabilityExecutor,
        resolver: CapabilityResolver,
        store: RunStore,
    ) -> None:
        self._executor = executor
        self._resolver = resolver
        self._store = store

    async def available_descriptors(
        self,
        run: TaskRun,
        capability_ids: tuple[str, ...],
    ) -> tuple[CapabilityDescriptor, ...]:
        context = ResolveContext.from_run(run)
        available: list[CapabilityDescriptor] = []
        for capability_id in capability_ids:
            binding = await self._resolver.resolve(capability_id, context)
            if binding is not None:
                available.append(binding.descriptor)
        return tuple(available)

    async def invoke(
        self,
        run: TaskRun,
        call: CapabilityCall,
        context: AgentInvocationContext | None = None,
    ) -> Observation:
        context = context or AgentInvocationContext(profile_id="", step=0, policies=(), history=())
        capability_id = normalize_capability_id(call.capability)
        binding = await self._resolver.resolve(capability_id, ResolveContext.from_run(run))
        if binding is None:
            return _failed_observation(call, f"Capability {call.capability!r} could not be resolved.")
        public_args, secret_args = split_sensitive_arguments(call.args, binding.descriptor.parameter_schema)
        child = _child_run(run, call, capability_id, public_args, secret_args)
        try:
            prior = await self._reuse_or_create_child(child)
        except Exception as exc:  # noqa: BLE001 - a store fault is a failed call, not a crashed loop.
            return _failed_observation(call, f"Capability {call.capability!r} could not be dispatched: {exc}")
        if prior is not None:
            return _observation_from_result(call, prior)
        try:
            policy = _ProfileCapabilityPolicy(context, call) if context.policies else None
            result = await self._executor.run_resolved(child, self._store, binding, policy)
        except asyncio.CancelledError:
            with contextlib.suppress(Exception, asyncio.CancelledError):
                await self._store.cancel_run(child.run_id, "Parent sub-agent run was cancelled.")
            raise
        except Exception as exc:  # noqa: BLE001 - report any capability fault as a failed observation.
            return await self._reconciled_failure(call, child, exc)
        return _observation_from_result(call, result)

    async def _reconciled_failure(self, call: CapabilityCall, child: TaskRun, exc: Exception) -> Observation:
        """Prefer a recorded result when an executor response is lost."""
        detail: TaskDetail | None = None
        with contextlib.suppress(Exception):
            detail = await self._existing_child(child.run_id)
        if detail is not None and detail.result is not None:
            return _observation_from_result(call, detail.result)
        with contextlib.suppress(Exception, asyncio.CancelledError):
            await self._store.cancel_run(child.run_id, f"Nested capability call did not complete: {exc}")
        return _failed_observation(call, f"Capability {call.capability!r} crashed: {exc}")

    async def _reuse_or_create_child(self, child: TaskRun) -> TaskResult | None:
        existing = await self._existing_child(child.run_id)
        if existing is None:
            await self._create_child(child)
            return None
        if not _same_call(existing.run.spec, child.spec):
            raise RuntimeError(f"child run {child.run_id} already records a different call ({existing.run.spec.capability_id!r})")
        if child.secret_arguments:
            raise RuntimeError(f"child run {child.run_id} already exists and carries sensitive arguments; not reusable")
        if existing.result is not None:
            return existing.result
        if existing.run.status in TERMINAL_RUN_STATUSES:
            raise RuntimeError(f"child run {child.run_id} settled as {existing.run.status.value} without a recorded result")
        raise RuntimeError(f"child run {child.run_id} already exists and is still in flight")

    async def _create_child(self, child: TaskRun) -> None:
        """Persist the child and settle it if cancellation abandons the call."""
        write = asyncio.create_task(self._store.create_run(child))
        try:
            await asyncio.shield(write)
        except IdempotencyCollisionError:
            raise
        except (Exception, asyncio.CancelledError):
            await _settled(write)
            with contextlib.suppress(Exception, asyncio.CancelledError):
                await self._store.cancel_run(child.run_id, "Nested capability call was never started.")
            raise

    async def _existing_child(self, run_id: str) -> TaskDetail | None:
        try:
            return await self._store.get_task_detail(run_id, "summary")
        except FileNotFoundError:
            return None


async def _settled(write: "asyncio.Task[None]") -> None:
    """Observe a shielded store write even while cancellation is delivered."""
    while not write.done():
        with contextlib.suppress(Exception, asyncio.CancelledError):
            await asyncio.shield(write)


def _child_run(
    parent: TaskRun,
    call: CapabilityCall,
    capability_id: str,
    args: dict[str, object],
    secret_args: dict[str, object],
) -> TaskRun:
    run_id = _child_run_id(parent, call)
    child = parent.model_copy(
        update={
            "run_id": run_id,
            "batch_id": _child_batch_id(parent),
            "batch_item_index": 0,
            "spec": _capability_spec(parent, capability_id, args),
            "idempotency_key": run_id,
            "status": TaskStatus.QUEUED,
            "attempt": 1,
            "worker_id": None,
            "fencing_token": "",
            "runtime_stage": "",
            "queued_at": _now_ms(),
            "started_at": None,
            "heartbeat_at": None,
            "ended_at": None,
            "latest_progress_message": "",
            "latest_progress_at": 0,
            "last_error_class": None,
            "last_error": "",
        }
    )
    child.bind_secret_arguments(secret_args)
    child.bind_scheduled_batch(parent.scheduled_batch_id)
    return child


def _same_call(existing: TaskSpec, current: TaskSpec) -> bool:
    return existing.capability_id == current.capability_id and existing.args == current.args


def _child_batch_id(parent: TaskRun) -> str:
    return f"{parent.run_id}-calls"


def _capability_spec(parent: TaskRun, capability_id: str, args: dict[str, object]) -> TaskSpec:
    spec = TaskSpec(
        task_id=f"{parent.spec.task_id}:{capability_id}",
        title=f"{parent.spec.title} · {capability_id}",
        dispatch=CapabilityDispatch(capability_id=capability_id),
        args=dict(args),
        required_sandbox=parent.spec.required_sandbox,
    )
    spec.set_selected_sandbox(parent.spec.selected_sandbox)
    return spec


def _child_run_id(parent: TaskRun, call: CapabilityCall) -> str:
    """Derive a stable filesystem- and pod-safe id from the parent and call."""
    return f"{parent.run_id}-{call.call_id or call.capability}"


def _observation_from_result(call: CapabilityCall, result: TaskResult) -> Observation:
    return Observation(
        capability=call.capability,
        ok=result.status == TaskStatus.COMPLETED,
        content=result.output or result.summary or result.error_message or "",
        call_id=call.call_id,
        run_id=result.run_id,
        status=result.status.value,
        summary=result.summary,
        error_class=result.error_class.value if result.error_class else "",
        error_message=result.error_message,
        artifacts=tuple(artifact.filepath or artifact.uri for artifact in result.artifacts),
    )


def _failed_observation(call: CapabilityCall, message: str) -> Observation:
    return Observation(
        capability=call.capability,
        ok=False,
        content=message,
        call_id=call.call_id,
        status=TaskStatus.FAILED.value,
        summary=message,
        error_class=ErrorClass.INTERNAL.value,
        error_message=message,
    )
