from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, field_validator, model_validator

from ..capabilities.ids import (
    builtin_tool_of,
    normalize_capability_id,
    skill_action_of,
)
from ..sandbox.types import SandboxOS


class TaskStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMED_OUT = "timed_out"
    BLOCKED = "blocked"


class BatchStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    PARTIAL = "partial"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMED_OUT = "timed_out"
    BLOCKED = "blocked"


class ErrorClass(str, Enum):
    TRANSIENT = "transient"
    SANDBOX_UNHEALTHY = "sandbox_unhealthy"
    SANDBOX_NO_CAPACITY = "sandbox_no_capacity"
    TIMEOUT = "timeout"
    USER_INPUT = "user_input"
    SKILL_RUNTIME = "skill_runtime"
    POLICY_DENY = "policy_deny"
    INTERNAL = "internal"
    CANCELLED = "cancelled"


JoinStrategy = Literal["all_success", "partial_ok", "first_success", "fail_fast"]
"""How the orchestrator interprets per-task outcomes when joining a batch.

- ``all_success``: every task must succeed; any failure → batch FAILED
- ``partial_ok``: best-effort; failures recorded but batch reports PARTIAL
- ``first_success``: stop as soon as one task succeeds; cancel siblings
- ``fail_fast``: stop as soon as one task fails; cancel siblings, batch FAILED
"""


class RetryPolicy(BaseModel):
    max_attempts: int = 1
    retry_on: list[ErrorClass] = Field(default_factory=lambda: [ErrorClass.TRANSIENT, ErrorClass.SANDBOX_UNHEALTHY])
    backoff_seconds: int = 5


class TaskExecutionPolicy(BaseModel):
    timeout_seconds: int = 600
    retry: RetryPolicy = Field(default_factory=RetryPolicy)
    # Execution semantics only: ``in_process`` = pure-Python builtin tool (echo /
    # file_convert) run inside the worker; ``command_backend`` = work lowered to a
    # CommandSpec and executed wherever ``command_backend.select_backend`` resolves
    # (local subprocess / docker / k8s, chosen via the TASK_RUNTIME_BACKEND env).
    # This field never selects the backend host itself.
    executor: Literal["in_process", "command_backend"] = "command_backend"
    trust_level: Literal["platform_signed", "tenant_uploaded", "agent_generated"] = "platform_signed"
    requires_strong_isolation: bool = False
    network_policy: str = "default-deny"
    max_log_bytes: int = 50 * 1024 * 1024


class SandboxRequirement(BaseModel):
    # An OS capability the task needs (e.g. ``windows``); the backend resolves it
    # to whichever concrete sandbox type has a free machine.
    type: SandboxOS
    count: int = 1
    reset_before_run: bool = True
    release_after_run: bool = True
    affinity_key: str | None = None


class ReservationToken(BaseModel):
    reservation_id: str
    run_id: str
    # The OS selector the reservation was made against (mirrors SandboxRequirement).
    type: SandboxOS
    expires_at: int


class SandboxLeaseRef(BaseModel):
    sandbox_id: str
    # Opaque concrete provider type returned by the backend.
    type: str
    os: str = ""
    endpoint: str
    provider_base_url: str = ""
    device_id: str = ""
    vnc_url: str = ""
    acquired_at: int
    expires_at: int | None = None


class CapabilityDispatch(BaseModel):
    """Dispatch to one capability resolved from the capability catalogue.

    ``capability_id`` is namespaced by the provider that owns it
    (``builtin:echo``, ``skill:android-tester.run``) so ids stay unambiguous as
    sources multiply. Normalising on the way in makes that an *invariant* rather
    than a convention, which is what lets policy, bucketing and presentation
    compare ``provider_of(capability_id)`` without each re-normalising — a bare
    name reaching them would silently read as "no provider".
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["capability"] = "capability"
    capability_id: str = ""

    @field_validator("capability_id")
    @classmethod
    def _namespaced(cls, value: str) -> str:
        return normalize_capability_id(value)


class SubAgentDispatch(BaseModel):
    """Dispatch to a sub-agent reasoning loop resolved by profile.

    - ``profile_id`` selects the behaviour configuration (system prompt,
      capability ceiling, policies). Unknown ids are rejected deterministically.
    - ``max_model_turns`` caps the loop. ``None`` defers to the executor default.
    - ``capability_grants`` is the allow-list of namespaced capability ids the
      planner explicitly grants. It is intersected with the profile's ceiling at
      execution time; the executor never widens it.
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["sub_agent"] = "sub_agent"
    profile_id: str = "default"
    max_model_turns: int | None = Field(default=None, ge=1)
    capability_grants: list[str] = Field(default_factory=list)

    @field_validator("profile_id")
    @classmethod
    def _profile_id_not_blank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("profile_id must not be empty")
        return normalized

    @model_validator(mode="before")
    @classmethod
    def _compat_shim(cls, data: Any) -> Any:
        """Map old persisted field names from run_json."""
        if isinstance(data, dict):
            data = dict(data)
            if "persona" in data:
                data.pop("persona")
                data.setdefault("profile_id", "default")
            if "max_steps" in data:
                max_steps = data.pop("max_steps")
                data.setdefault("max_model_turns", max_steps)
            if data.get("max_model_turns") == 0:
                data["max_model_turns"] = None
            if "capabilities" in data:
                capabilities = data.pop("capabilities")
                data.setdefault("capability_grants", capabilities)
        return data

    @field_validator("capability_grants")
    @classmethod
    def _namespaced(cls, value: list[str]) -> list[str]:
        normalized = (normalize_capability_id(name) for name in value if name.strip())
        return list(dict.fromkeys(normalized))


Dispatch = Annotated[CapabilityDispatch | SubAgentDispatch, Field(discriminator="type")]


class TaskDisplay(BaseModel):
    """Frontend presentation hints attached to a task.

    Produced by the pipeline (merged from CapabilityCard defaults, planner
    overrides, and heuristic fallbacks) and passed through by the manager
    without inspection. The view layer (see
    :mod:`~app.biz.task_runtime.presentation.rendering.renderers`) reads these
    fields and falls back to per-provider defaults when empty.
    """

    model_config = ConfigDict(extra="forbid")

    plan_title: str = ""
    """Sub-step title shown under the parent plan step (≤ ~40 chars)."""

    batch_step_title: str = ""
    """Title for the batch's umbrella plan step (≤ ~40 chars)."""

    single_step_title: str = ""
    """Title for a single-task batch shown as one plan step."""


class TaskSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str
    title: str
    instructions: str = ""
    dispatch: Dispatch
    display: TaskDisplay = Field(default_factory=TaskDisplay)
    args: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    # The OS capabilities this task may run on, derived from the skill's
    # ``infra_requirements``. Empty for tasks that need no sandbox.
    required_sandbox: list[SandboxOS] = Field(default_factory=list)
    # Execution order within a batch. Tasks sharing a ``stage`` run in parallel;
    # lower stages run to completion before higher stages start. ``0`` (the
    # default) means the whole batch runs in parallel. Only raise it when a task
    # consumes another task's output (the shared run workspace carries the
    # hand-off). Gaps are allowed: distinct values are ordered ascending into
    # execution waves.
    stage: int = 0
    # Optional caller-supplied task identity within one logical submission.
    # The runtime scopes it with the submission id and batch position, so a new
    # user-requested submission still executes while transport replay reuses.
    idempotency_key: str = ""

    @field_validator("task_id", "title")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("value must not be empty")
        return normalized

    @field_validator("stage")
    @classmethod
    def _non_negative_stage(cls, value: int) -> int:
        return max(0, value)

    @field_validator("required_sandbox", mode="before")
    @classmethod
    def _coerce_required_sandbox(cls, value: Any) -> list[Any]:
        if value in (None, ""):
            return []
        if isinstance(value, str):
            return [value]
        if isinstance(value, SandboxOS):
            return [value.value]
        if isinstance(value, (list, tuple, set)):
            cleaned: list[Any] = []
            seen: set[str] = set()
            for item in value:
                if item in (None, ""):
                    continue
                key = str(item).strip()
                if key and key not in seen:
                    cleaned.append(item)
                    seen.add(key)
            return cleaned
        return value

    @property
    def sandbox_options(self) -> tuple[str, ...]:
        return tuple(str(item) for item in self.required_sandbox)

    # ------------------------------------------------------------------
    # Read-side dispatch convenience accessors.
    # ------------------------------------------------------------------
    # Let downstream renderers / policy / playbook retrievers read the dispatch
    # payload without repeating ``isinstance`` chains every time. The skill and
    # tool accessors are *derived* from the capability id, so there is exactly
    # one place the id is decomposed; anything needing both halves of a skill id
    # calls ``skill_action_of`` directly.

    @property
    def kind(self) -> Literal["capability", "sub_agent"]:
        return self.dispatch.type

    @property
    def capability_id(self) -> str:
        return self.dispatch.capability_id if isinstance(self.dispatch, CapabilityDispatch) else ""

    @property
    def skill_name(self) -> str | None:
        return skill_action_of(self.capability_id)[0] or None

    @property
    def tool_name(self) -> str | None:
        return builtin_tool_of(self.capability_id) or None

    @property
    def selected_sandbox(self) -> str | None:
        runtime_metadata = self.metadata.get("_task_runtime")
        selected = ""
        if isinstance(runtime_metadata, dict):
            selected = str(runtime_metadata.get("selected_sandbox") or "").strip()
        if selected and selected in self.sandbox_options:
            return selected
        if len(self.required_sandbox) == 1:
            return str(self.required_sandbox[0])
        return None

    def set_selected_sandbox(self, sandbox: str | None) -> None:
        if not sandbox:
            runtime_metadata = self.metadata.get("_task_runtime")
            if isinstance(runtime_metadata, dict):
                runtime_metadata.pop("selected_sandbox", None)
            return
        normalized = str(sandbox).strip()
        if normalized not in self.sandbox_options:
            raise ValueError(f"selected sandbox {normalized!r} is not in required_sandbox")
        runtime_metadata = self.metadata.get("_task_runtime")
        if not isinstance(runtime_metadata, dict):
            runtime_metadata = {}
            self.metadata["_task_runtime"] = runtime_metadata
        runtime_metadata["selected_sandbox"] = normalized


class BatchRecord(BaseModel):
    batch_id: str
    parent_conversation_id: int
    parent_turn_id: int
    parent_tool_call_id: int | None = None
    status: BatchStatus = BatchStatus.QUEUED
    reason: str = ""
    join_strategy: JoinStrategy = "partial_ok"
    max_concurrency: int | None = None
    # The OS capability shared by the batch's sandbox tasks (used for sizing and
    # display); ``None`` for batches that need no sandbox.
    sandbox_type: SandboxOS | None = None
    sandbox_task_count: int = 0
    sandbox_concurrency: int | None = None
    available_sandbox_count: int | None = None
    planned_batch_sizes: list[int] = Field(default_factory=list)
    total_count: int
    counts: dict[str, int] = Field(default_factory=dict)
    created_at: int
    updated_at: int
    ended_at: int | None = None
    cancellation_reason: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class FencingToken(BaseModel):
    run_id: str
    token: str
    issued_at: int
    expires_at: int | None = None


class StaleRun(BaseModel):
    run_id: str
    batch_id: str
    status: TaskStatus | BatchStatus
    worker_id: str | None = None
    heartbeat_at: int | None = None


class TaskRun(BaseModel):
    # WIRE/DB CONTRACT: keep this model flat. ``model_dump_json()`` is sent over
    # reverse-RPC to the Go backend, which promotes top-level keys into indexed DB
    # columns and writes them back in ``canonicalRunJSON`` (backend taskruntime
    # ``payloads.go`` / ``rows.go``). Nesting or renaming a promoted key breaks the
    # column projection and its indexes and needs a coordinated migration — e.g.
    # ``executor`` is a backend-indexed column mirroring ``execution_policy.executor``,
    # so it stays despite the weak name.
    _runtime_reuse: bool = PrivateAttr(default=False)
    # Argument values the capability descriptor marked ``sensitive``. They are
    # deliberately a private attribute: ``spec.args`` is serialized verbatim into
    # the run snapshot the backend persists, so a password typed into a GUI (or
    # any other secret) must ride outside the model's field set and never reach
    # ``model_dump``.
    _secret_args: dict[str, Any] = PrivateAttr(default_factory=dict)
    # Set on a nested capability call, which lives in its own batch so it is not
    # counted as a batch item. See :attr:`scheduled_batch_id`.
    _scheduled_batch_id: str = PrivateAttr(default="")

    run_id: str
    batch_id: str
    parent_conversation_id: int
    parent_turn_id: int
    parent_tool_call_id: int | None = None
    plan_batch_call_id: int | None = None
    batch_item_index: int
    username: str
    agent_id: str
    agent_instance_id: int
    project_id: int
    spec: TaskSpec
    execution_policy: TaskExecutionPolicy
    status: TaskStatus = TaskStatus.QUEUED
    attempt: int = 1
    idempotency_key: str
    executor: str
    worker_id: str | None = None
    fencing_token: str = ""
    sandbox: SandboxLeaseRef | None = None
    sandbox_released: bool = False
    lease_outcome: str = ""
    runtime_stage: str = ""
    queued_at: int
    started_at: int | None = None
    heartbeat_at: int | None = None
    ended_at: int | None = None
    latest_progress_message: str = ""
    latest_progress_at: int = 0
    last_error_class: ErrorClass | None = None
    last_error: str = ""

    @property
    def secret_arguments(self) -> dict[str, Any]:
        """Sensitive argument values, merged back in only at execution time."""
        return dict(self._secret_args)

    def bind_secret_arguments(self, values: Mapping[str, Any]) -> None:
        """Attach argument values that must never be serialized with the spec."""
        self._secret_args = dict(values)

    @property
    def scheduled_batch_id(self) -> str:
        """The batch whose terminal transition covers this run.

        Equal to ``batch_id`` for a scheduled run. A nested capability call lives
        in its own batch — so it is never mistaken for a batch item — but it
        still settles with the batch that scheduled its parent. Anything keyed
        per batch must use this, or it will wait for a transition that never
        comes.
        """
        return self._scheduled_batch_id or self.batch_id

    def bind_scheduled_batch(self, batch_id: str) -> None:
        """Record the scheduling batch for a run that is not itself a batch item."""
        self._scheduled_batch_id = batch_id


class ArtifactRef(BaseModel):
    name: str
    type: Literal["log", "report", "screenshot", "video", "file", "patch", "json", "trajectory"]
    role: Literal["primary", "evidence", "debug", "raw"] = "raw"
    uri: str
    filepath: str = ""
    size_bytes: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class TaskResult(BaseModel):
    run_id: str
    task_id: str
    status: TaskStatus
    title: str
    summary: str
    output: str = ""
    primary_artifact: ArtifactRef | None = None
    error_class: ErrorClass | None = None
    error_message: str = ""
    trajectory: ArtifactRef | None = None
    artifacts: list[ArtifactRef] = Field(default_factory=list)
    logs: list[ArtifactRef] = Field(default_factory=list)
    sandbox: SandboxLeaseRef | None = None
    started_at: int | None = None
    ended_at: int | None = None
    duration_ms: int | None = None
    # Per-stage wall-clock attribution in milliseconds (e.g. ``execute_ms``,
    # ``sandbox_acquire_ms``), populated from :class:`RunClock`.
    metrics: dict[str, int] = Field(default_factory=dict)


class TaskResultDigest(BaseModel):
    task_id: str
    run_id: str
    title: str
    status: TaskStatus
    summary: str
    primary_artifact: ArtifactRef | None = None
    trajectory_ref: ArtifactRef | None = None
    error_class: ErrorClass | None = None
    error_message: str = ""
    duration_ms: int | None = None

    @classmethod
    def from_result(cls, result: TaskResult) -> "TaskResultDigest":
        return cls(
            task_id=result.task_id,
            run_id=result.run_id,
            title=result.title,
            status=result.status,
            summary=_truncate_summary(result.summary),
            primary_artifact=result.primary_artifact,
            trajectory_ref=result.trajectory,
            error_class=result.error_class,
            error_message=result.error_message,
            duration_ms=result.duration_ms,
        )


class TaskDetail(BaseModel):
    run: TaskRun
    result: TaskResult | None = None
    view: Literal["summary", "artifacts"]
    content: str = ""
    artifacts: list[ArtifactRef] = Field(default_factory=list)


class BatchResult(BaseModel):
    batch_id: str
    status: BatchStatus
    total_count: int
    completed_count: int
    failed_count: int
    cancelled_count: int
    timed_out_count: int
    blocked_count: int
    results: list[TaskResult]
    artifacts_root: str


class BatchResultDigest(BaseModel):
    batch_id: str
    status: BatchStatus
    counts: dict[str, int]
    results: list[TaskResultDigest]
    artifacts_root: str

    @classmethod
    def from_result(
        cls,
        result: BatchResult,
        *,
        max_success_items: int = 3,
        max_result_items: int | None = None,
    ) -> "BatchResultDigest":
        non_success_indexes = [
            index
            for index, task_result in enumerate(result.results)
            if task_result.status != TaskStatus.COMPLETED
        ]
        success_indexes = [
            index
            for index, task_result in enumerate(result.results)
            if task_result.status == TaskStatus.COMPLETED
        ][:max_success_items]
        if max_result_items is None:
            selected_indexes = set((*non_success_indexes, *success_indexes))
        else:
            selected_indexes = set(non_success_indexes[:max_result_items])
            remaining = max(0, max_result_items - len(selected_indexes))
            selected_indexes.update(success_indexes[:remaining])
        digests = [
            TaskResultDigest.from_result(task_result)
            for index, task_result in enumerate(result.results)
            if index in selected_indexes
        ]
        return cls(
            batch_id=result.batch_id,
            status=result.status,
            counts={
                "completed": result.completed_count,
                "failed": result.failed_count,
                "cancelled": result.cancelled_count,
                "timed_out": result.timed_out_count,
                "blocked": result.blocked_count,
            },
            results=digests,
            artifacts_root=result.artifacts_root,
        )


def compute_idempotency_key(submission_id: str, batch_item_index: int, task: TaskSpec) -> str:
    """Derive a stable task key within one logical submission.

    Transport retries preserve ``submission_id`` and therefore reuse existing
    work. An intentional rerun receives a new submission id and executes again,
    even when the task contents are unchanged.
    """
    submission_id = submission_id.strip()
    if not submission_id:
        raise ValueError("submission_id is required")

    explicit = task.idempotency_key.strip()
    payload = {
        "schema_version": 2,
        "submission_id": submission_id,
        "batch_item_index": batch_item_index,
        "task": {"explicit_idempotency_key": explicit}
        if explicit
        else task.model_dump(
            mode="json",
            exclude={"task_id", "idempotency_key", "metadata"},
            exclude_none=True,
        ),
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _truncate_summary(value: str, max_chars: int = 1200) -> str:
    if len(value) <= max_chars:
        return value
    return value[: max_chars - 14].rstrip() + "\n...TRUNCATED"


# --------------------------------------------------------------------------- #
# Derived runtime-state sets and the plan-cancellation signal.
#
# Kept alongside the enums they derive from so collaborators and the rendering
# layer share one source of truth without a separate ``_runtime_states`` module.
# --------------------------------------------------------------------------- #

TERMINAL_STATUSES = {
    TaskStatus.COMPLETED,
    TaskStatus.FAILED,
    TaskStatus.CANCELLED,
    TaskStatus.TIMED_OUT,
    TaskStatus.BLOCKED,
}
TERMINAL_BATCH_STATUSES = {
    BatchStatus.COMPLETED,
    BatchStatus.PARTIAL,
    BatchStatus.FAILED,
    BatchStatus.CANCELLED,
    BatchStatus.TIMED_OUT,
    BatchStatus.BLOCKED,
}

SANDBOX_STAGE_CAPACITY_WAIT = "capacity_wait"
SANDBOX_STAGE_ACQUIRE = "acquire"
SANDBOX_STAGE_RESET = "reset"
SANDBOX_STAGE_READY = "sandbox_ready"
SANDBOX_PRE_EXECUTION_STAGES = {
    "workspace",
    "runner",
    SANDBOX_STAGE_CAPACITY_WAIT,
    SANDBOX_STAGE_ACQUIRE,
    SANDBOX_STAGE_RESET,
    SANDBOX_STAGE_READY,
}


class PlanCancellationRequested(Exception):
    """Raised when an in-progress task acquires evidence that the parent plan was cancelled.

    Lives beside the domain models so any collaborator can raise / catch it
    without importing ``manager``."""

    pass


# --------------------------------------------------------------------------- #
# Trusted handoff inputs for ``TaskManager.submit_prepared``.
#
# ``TaskBatchInput`` is the planner's product; ``PreparedTaskBatch`` is the
# pipeline's product. Both are frozen — the manager treats their fields as
# authoritative and does not re-validate.
# --------------------------------------------------------------------------- #


@dataclass(frozen=True, slots=True)
class TaskBatchInput:
    """A batch produced by chat preparation or another trusted planner.

    ``tasks`` is a tuple so the dataclass remains hashable / immutable; callers
    materialise from a list with ``tuple(specs)``. ``join_strategy`` and
    ``max_concurrency`` are passed directly into execution planning;
    the latter may narrow but never widen the deployment limit."""

    tasks: tuple[TaskSpec, ...]
    join_strategy: JoinStrategy = "partial_ok"
    description: str = ""
    max_concurrency: int | None = None

    def __post_init__(self) -> None:
        if not self.tasks:
            raise ValueError("TaskBatchInput.tasks must not be empty")
        if self.max_concurrency is not None and self.max_concurrency <= 0:
            raise ValueError("TaskBatchInput.max_concurrency must be positive")


@dataclass(frozen=True, slots=True)
class PreparedTaskBatch:
    """A ``TaskBatchInput`` post-pipeline: capability-matched, display-filled,
    dispatch-decided, ready for ``TaskManager.submit_prepared``.

    ``batch_metadata`` carries pipeline-side telemetry (for example source
    counts and source paths) that the manager passes
    through to ``BatchInstance.metadata`` without inspection. The runtime adds
    its own diagnostics only under the reserved ``_task_runtime`` namespace key,
    never as bare top-level keys, so caller fields can never collide."""

    batch: TaskBatchInput
    batch_metadata: dict[str, Any] = field(default_factory=dict)
    adapter_state: dict[str, Any] = field(default_factory=dict)
