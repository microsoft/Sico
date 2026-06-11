# Copyright (c) 2026 Sico Authors
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, field_validator

from .sandbox_types import SandboxOS, SandboxType


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
    # The concrete type actually acquired (e.g. ``wincua`` or ``physical``).
    type: SandboxType
    endpoint: str
    provider_base_url: str = ""
    device_id: str = ""
    vnc_url: str = ""
    acquired_at: int
    expires_at: int | None = None


class ToolDispatch(BaseModel):
    """Dispatch to a built-in local tool registered with the runtime
    (``echo`` / ``file_convert`` today). ``tool_name`` may be empty in
    test fixtures; production pipelines always populate it during
    :func:`normalize.builtin_tools` rewriting."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["tool"] = "tool"
    tool_name: str = ""


class SkillDispatch(BaseModel):
    """Dispatch to an executable skill capability resolved from the
    project skill registry. The pipeline writes both ``skill_name`` and
    ``action_name`` after matching the task against a CapabilityCard."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["skill"] = "skill"
    skill_name: str = ""
    action_name: str = ""


class SubAgentDispatch(BaseModel):
    """Dispatch to a generalist sub-agent loop owned by the task runtime
    (a single :class:`SubAgentExecutor` per manager instance).

    - ``persona`` lets the planner select a behaviour preset (system prompt
      template, tool palette default). Implementation may treat the default
      ``"default"`` as the only supported persona until additional ones are
      registered.
    - ``max_steps`` caps the sub-agent's reasoning loop. ``None`` defers to
      the executor-level default budget.
    - ``capabilities`` is an allow-list of capability names (tool or
      ``skill.action``) the planner explicitly grants the sub-agent's loop.
      Empty list = inherit the executor default palette (which may include
      ``visibility="internal"`` capabilities).
    """

    model_config = ConfigDict(extra="forbid")

    type: Literal["sub_agent"] = "sub_agent"
    persona: str = "default"
    max_steps: int | None = None
    capabilities: list[str] = Field(default_factory=list)


Dispatch = Annotated[ToolDispatch | SkillDispatch | SubAgentDispatch, Field(discriminator="type")]


class TaskDisplay(BaseModel):
    """Frontend presentation hints attached to a task.

    Produced by the pipeline (merged from CapabilityCard defaults, planner
    overrides, and heuristic fallbacks) and passed through by the manager
    without inspection. The view layer (see :mod:`views.renderers`) reads
    these fields and falls back to dispatch-kind defaults when empty.
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
    # The OS capability this task needs, derived from the skill's
    # ``infra_requirements``. ``None`` for tasks that need no sandbox.
    required_sandbox: SandboxOS | None = None
    # Execution order within a batch. Tasks sharing a ``stage`` run in parallel;
    # lower stages run to completion before higher stages start. ``0`` (the
    # default) means the whole batch runs in parallel. Only raise it when a task
    # consumes another task's output (the shared run workspace carries the
    # hand-off). Gaps are allowed: distinct values are ordered ascending into
    # execution waves.
    stage: int = 0
    # Optional caller-supplied idempotency key. When set, retrying with the
    # exact same key (within the same turn) returns the prior run instead of
    # creating a new one. When empty, the runtime derives a stable key from
    # the task contents.
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

    # ------------------------------------------------------------------
    # Read-side dispatch convenience accessors.
    # ------------------------------------------------------------------
    # Let downstream renderers / executors / playbook retrievers read the
    # dispatch payload without repeating ``isinstance`` chains every time.

    @property
    def kind(self) -> Literal["skill", "tool", "sub_agent"]:
        return self.dispatch.type

    @property
    def skill_name(self) -> str | None:
        if isinstance(self.dispatch, SkillDispatch):
            return self.dispatch.skill_name or None
        return None

    @property
    def tool_name(self) -> str | None:
        if isinstance(self.dispatch, ToolDispatch):
            return self.dispatch.tool_name or None
        return None

    @property
    def action_name(self) -> str:
        if isinstance(self.dispatch, SkillDispatch):
            return self.dispatch.action_name
        return ""


class BatchRecord(BaseModel):
    batch_id: str
    parent_conversation_id: int
    parent_turn_id: int
    parent_tool_call_id: int | None = None
    status: BatchStatus = BatchStatus.QUEUED
    reason: str = ""
    join_strategy: Literal["all_success", "partial_ok", "first_success", "fail_fast"] = "partial_ok"
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
    def from_result(cls, result: BatchResult, *, max_success_items: int = 3) -> "BatchResultDigest":
        digests: list[TaskResultDigest] = []
        success_count = 0
        for task_result in result.results:
            if task_result.status == TaskStatus.COMPLETED:
                if success_count >= max_success_items:
                    continue
                success_count += 1
            digests.append(TaskResultDigest.from_result(task_result))
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


def compute_idempotency_key(conversation_id: int, turn_id: int, batch_item_index: int, task: TaskSpec) -> str:
    """Derive a stable idempotency key for a task within a conversation turn.

    The key intentionally excludes fields that change between retries (run/tool-call IDs,
    timestamps, attempt counts). If the caller supplied an explicit ``task.idempotency_key``,
    we trust it verbatim so callers can dedupe across turns. Otherwise we hash the
    canonical contents of the task plus its position within the batch.
    """
    explicit = task.idempotency_key.strip()
    if explicit:
        return explicit
    payload = {
        "conversation_id": conversation_id,
        "turn_id": turn_id,
        "batch_item_index": batch_item_index,
        "task": task.model_dump(
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

JoinStrategy = Literal["all_success", "partial_ok", "first_success", "fail_fast"]
"""How the orchestrator interprets per-task outcomes when joining a batch.

- ``all_success``: every task must succeed; any failure → batch FAILED
- ``partial_ok``: best-effort; failures recorded but batch reports PARTIAL
- ``first_success``: stop as soon as one task succeeds; cancel siblings
- ``fail_fast``: stop as soon as one task fails; cancel siblings, batch FAILED
"""


@dataclass(frozen=True, slots=True)
class TaskBatchInput:
    """A batch as produced by the Lead Planner LLM.

    ``tasks`` is a tuple so the dataclass remains hashable / immutable; callers
    materialise from a list with ``tuple(specs)``."""

    tasks: tuple[TaskSpec, ...]
    join_strategy: JoinStrategy = "partial_ok"
    description: str = ""

    def __post_init__(self) -> None:
        if not self.tasks:
            raise ValueError("TaskBatchInput.tasks must not be empty")


@dataclass(frozen=True, slots=True)
class PreparedTaskBatch:
    """A ``TaskBatchInput`` post-pipeline: capability-matched, display-filled,
    dispatch-decided, ready for ``TaskManager.submit_prepared``.

    ``batch_metadata`` carries pipeline-side telemetry (capability candidates,
    workbook source paths, normaliser audit trail) that the manager passes
    through to ``BatchInstance.metadata`` without inspection. The runtime adds
    its own diagnostics only under the reserved ``_task_runtime`` namespace key,
    never as bare top-level keys, so caller fields can never collide."""

    batch: TaskBatchInput
    batch_metadata: dict[str, Any] = field(default_factory=dict)
    adapter_state: dict[str, Any] = field(default_factory=dict)
