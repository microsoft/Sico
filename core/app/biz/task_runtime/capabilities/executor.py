"""The single executor for ``capability`` dispatch.

Everything that is the *same* for every capability lives here — claim the run,
resolve the binding, enforce the descriptor's environment requirements, rebuild
the workspace paths, invoke the handler, persist the result. Everything that
differs stays behind :class:`CapabilityHandler` in the owning provider.

Two consequences worth stating explicitly:

* **Where a capability came from stops mattering above this line.** The router
  no longer branches on tool-vs-skill, and neither does anything downstream.
* **The descriptor is the authority on the environment.** Whether the workspace
  mount is writable, and whether a sandbox is required, are read from the
  descriptor rather than inferred from which executor happened to run the work.
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any, Protocol

from app.biz.source.persistence.repository import WorkspaceSourceRepository

from .descriptors import (
    REDACTED_PLACEHOLDER,
    CapabilityBinding,
    CapabilityContext,
    CapabilityDescriptor,
    ResolveContext,
)
from .resolver import CapabilityResolver
from ..domain.models import ErrorClass, TaskResult, TaskRun
from ..domain.results import build_user_input_result, failed_result
from ..domain.state_machine import TERMINAL_RUN_STATUSES
from ..storage.run_store import RunStore
from ..events.subscribers.experience_learning import on_run_terminal
from ..domain.time import now_ms as _now_ms
from ..workspace.layout import workspace_layout

_RESULT_DIR_NAME = "result"

#: Result fields carrying handler-authored text that a secret could reach.
_SCRUBBED_RESULT_FIELDS = ("title", "summary", "output", "error_message")

# A value shorter than this cannot be replaced in place without rewriting
# unrelated text — a secret of "1" would hit every digit. Such a value is still
# a credential (a PIN, a short OTP), so a field containing one is redacted whole
# rather than left alone.
_MIN_TARGETED_SCRUB_LEN = 6


class CapabilityExecutionPolicy(Protocol):
    """Optional call-specific gate evaluated against the binding being executed.

    Direct capability dispatch has no agent profile and leaves this unset. A
    nested agent call supplies an adapter over its profile policies so the gate
    runs inside the standard claim/write lifecycle, against the same descriptor
    the handler will receive.
    """

    async def denial_reason(
        self,
        run: TaskRun,
        descriptor: CapabilityDescriptor,
    ) -> str | None: ...


class CapabilityExecutor:
    """Runs one ``capability`` dispatch end to end."""

    def __init__(self, resolver: CapabilityResolver, *, worker_id: str = "capability-executor") -> None:
        self._resolver = resolver
        self.worker_id = worker_id

    async def run(self, run: TaskRun, store: RunStore) -> TaskResult:
        return await self._run(run, store, binding=None)

    async def run_resolved(
        self,
        run: TaskRun,
        store: RunStore,
        binding: CapabilityBinding,
        policy: CapabilityExecutionPolicy | None = None,
    ) -> TaskResult:
        """Run using the exact binding already resolved for a nested call."""
        return await self._run(run, store, binding=binding, policy=policy)

    async def _run(
        self,
        run: TaskRun,
        store: RunStore,
        *,
        binding: CapabilityBinding | None,
        policy: CapabilityExecutionPolicy | None = None,
    ) -> TaskResult:
        token = await store.claim_run(run.run_id, self.worker_id)
        try:
            result = await self.execute(run) if binding is None else await self.execute_resolved(run, binding, policy=policy)
        except Exception as exc:  # noqa: BLE001 - whoever claims a run owns settling it.
            # A scheduled run has a RunCoordinator above it that converts a
            # crash into a terminal row. A nested capability call has none, and
            # it sits in a batch no finalizer sweeps, so an unhandled fault here
            # would leave it RUNNING until the next startup reconciler.
            result = failed_result(run, f"Capability execution crashed: {exc}", ErrorClass.INTERNAL)
        result = _scrubbed(result, run.secret_arguments)
        try:
            await store.write_result(run.run_id, result, token)
        finally:
            # Fired inline (fire-and-forget) so it happens per run regardless of
            # the active RunStore — the run-completion event bus is not published
            # in-process by the backend-backed store. In ``finally`` because
            # learning reads the run's trajectory from disk, not from the store:
            # it belongs to "the work finished", and a lost write response would
            # otherwise drop the run from learning without a trace.
            on_run_terminal(run, result)
        return result

    async def execute(self, run: TaskRun) -> TaskResult:
        """Resolve and invoke the capability without touching the store."""
        capability_id = run.spec.capability_id
        if not capability_id:
            return build_user_input_result(run, "This task's dispatch does not name a capability.")
        binding = await self._resolver.resolve(capability_id, ResolveContext.from_run(run))
        if binding is None:
            # The catalogue can legitimately shrink between planning and
            # execution, so an unknown id is a normal task failure, not a crash.
            return build_user_input_result(run, f"No capability is registered for: {capability_id}")
        return await self.execute_resolved(run, binding)

    async def execute_resolved(
        self,
        run: TaskRun,
        binding: CapabilityBinding,
        *,
        policy: CapabilityExecutionPolicy | None = None,
    ) -> TaskResult:
        """Invoke a vetted binding without resolving it a second time."""
        started_at = _now_ms()
        descriptor = binding.descriptor
        if descriptor.capability_id != run.spec.capability_id:
            return build_user_input_result(
                run,
                f"Resolved capability {descriptor.capability_id!r} does not match dispatch {run.spec.capability_id!r}.",
            )
        if policy is not None and (reason := await policy.denial_reason(run, descriptor)):
            return failed_result(run, reason, ErrorClass.POLICY_DENY)
        denial = _environment_denial(run, descriptor)
        if denial:
            return build_user_input_result(run, denial)
        result = await binding.handler.execute(self._context(run, descriptor, started_at))
        return _vetted_result(run, descriptor, result)

    def _context(self, run: TaskRun, descriptor: CapabilityDescriptor, started_at: int) -> CapabilityContext:
        workspace = _workspace_dir(run)
        run_dir = workspace / "results" / run.batch_id / run.run_id
        result_dir = run_dir / _RESULT_DIR_NAME
        # Every capability gets its private output directory: where durable
        # output goes is not the same question as whether the *shared* workspace
        # is exposed, which is the only thing ``workspace_access`` governs.
        result_dir.mkdir(parents=True, exist_ok=True)
        source_objects = _authorized_source_objects(run, workspace)
        return CapabilityContext(
            run=run,
            descriptor=descriptor,
            # Secret argument values live only on the run object, never in the
            # persisted spec, and are merged back in only here.
            arguments=_resolve_authorized_refs({**run.spec.args, **run.secret_arguments}, source_objects),
            workspace=workspace,
            run_dir=run_dir,
            result_dir=result_dir,
            started_at=started_at,
            input_paths=tuple(source_objects.values()),
        )


def _authorized_source_objects(run: TaskRun, workspace: Path) -> dict[str, Path]:
    tabular = run.spec.metadata.get("tabular")
    if not isinstance(tabular, Mapping):
        return {}
    source_ref = str(tabular.get("source_ref") or "")
    object_ref = str(tabular.get("source_object_ref") or "")
    if not source_ref or not object_ref or not _contains_exact_value(run.spec.args, object_ref):
        return {}
    repository = WorkspaceSourceRepository(workspace)
    path = repository.resolve_object_ref(object_ref)
    if path is None:
        raise ValueError("task references an unavailable or corrupt source object")
    return {object_ref: path}


def _contains_exact_value(value: Any, expected: str) -> bool:
    if isinstance(value, str):
        return value == expected
    if isinstance(value, Mapping):
        return any(_contains_exact_value(item, expected) for item in value.values())
    if isinstance(value, (list, tuple)):
        return any(_contains_exact_value(item, expected) for item in value)
    return False


def _resolve_authorized_refs(value: Any, source_objects: Mapping[str, Path]) -> Any:
    if isinstance(value, str):
        path = source_objects.get(value)
        return str(path) if path is not None else value
    if isinstance(value, Mapping):
        return {key: _resolve_authorized_refs(item, source_objects) for key, item in value.items()}
    if isinstance(value, list):
        return [_resolve_authorized_refs(item, source_objects) for item in value]
    if isinstance(value, tuple):
        return tuple(_resolve_authorized_refs(item, source_objects) for item in value)
    return value


def _environment_denial(run: TaskRun, descriptor: CapabilityDescriptor) -> str:
    """Re-check the descriptor's sandbox requirement at execution time.

    The descriptor declares which environments are *allowed*; the submitter has
    already picked one inside that set against live capacity. This verifies the
    pick is still allowed — it never re-picks. Re-picking here would strand the
    run on a lease it no longer matches, since the sandbox was reserved before
    the run started.
    """
    allowed = descriptor.required_sandbox
    if not allowed:
        return ""
    selected = run.spec.selected_sandbox
    if selected is None:
        return f"{descriptor.capability_id} needs one of {list(allowed)}, but this task selected no sandbox."
    if selected not in allowed:
        return f"{descriptor.capability_id} allows {list(allowed)}, but this task was prepared for {selected}."
    return ""


def _vetted_result(run: TaskRun, descriptor: CapabilityDescriptor, result: TaskResult) -> TaskResult:
    """Reject a handler result that does not describe *this* run's outcome.

    The result is written verbatim and drives the batch aggregate, so a
    mismatched identity would attribute someone else's outcome to this run, and
    a non-terminal status would leave the row unsettled. A handler is provider
    code, so this is checked rather than assumed.
    """
    if result.run_id != run.run_id or result.task_id != run.spec.task_id:
        return failed_result(
            run,
            f"{descriptor.capability_id} returned a result for run {result.run_id!r} / task {result.task_id!r}.",
            ErrorClass.INTERNAL,
        )
    if result.status not in TERMINAL_RUN_STATUSES:
        return failed_result(
            run,
            f"{descriptor.capability_id} returned the non-terminal status {result.status.value!r}.",
            ErrorClass.INTERNAL,
        )
    return result


def _scrubbed(result: TaskResult, secrets: Mapping[str, Any]) -> TaskResult:
    """Remove literal secret values from the text about to be persisted.

    A value long enough to match unambiguously is replaced in place; a shorter
    one — still a credential, but one that would rewrite unrelated text — causes
    the whole field to be redacted instead. Either way this is exact-match only:
    a handler that transforms or encodes a secret before reporting it remains
    responsible for its own redaction.
    """
    values = [text for text in (str(value) for value in secrets.values()) if text]
    if not values:
        return result
    updates: dict[str, str] = {}
    for field in _SCRUBBED_RESULT_FIELDS:
        original = getattr(result, field) or ""
        if not original:
            continue
        scrubbed = original
        for value in values:
            if len(value) >= _MIN_TARGETED_SCRUB_LEN:
                scrubbed = scrubbed.replace(value, REDACTED_PLACEHOLDER)
            elif value in scrubbed:
                scrubbed = REDACTED_PLACEHOLDER
                break
        if scrubbed != original:
            updates[field] = scrubbed
    return result.model_copy(update=updates) if updates else result


def _workspace_dir(run: TaskRun) -> Path:
    return workspace_layout().workspace_path(
        run.agent_instance_id,
        run.username,
        conversation_id=run.parent_conversation_id,
    )
