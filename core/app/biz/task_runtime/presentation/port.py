"""Seam between the runtime core and the plan / front-end progress mirror.

The scheduler, coordinators and result finalizer drive run / batch lifecycle
against the abstract :class:`RuntimeProgressPort` rather than a concrete UI
collaborator. The default implementation
(:class:`~app.biz.task_runtime.presentation.progress_sink.ProgressSink`) mirrors
lifecycle into ``ctx.plan_editor`` and the store. This module is a pure leaf:
every collaborator type is referenced only under ``TYPE_CHECKING`` so importing
it pulls in nothing from the core runtime, the rendering layer, or ``app.schemas``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    import asyncio
    from collections.abc import Callable

    from ..context import TurnContext
    from ..domain.models import BatchRecord, BatchStatus, PreparedTaskBatch, TaskResult, TaskRun, TaskSpec
    from .events import DeliverableSpec


@dataclass(frozen=True, slots=True)
class BatchProjectionOptions:
    publish_only: bool = False
    repair: bool = False
    settle_batch: bool = False
    allow_unmarked: bool = False
    finish_unstarted_tail: bool = False
    recovering: bool = False

    def __post_init__(self) -> None:
        if self.publish_only and any(
            (self.repair, self.settle_batch, self.allow_unmarked, self.finish_unstarted_tail, self.recovering)
        ):
            raise ValueError("publish-only projection sync cannot mutate or settle the projection")
        if not self.settle_batch and (self.finish_unstarted_tail or self.recovering):
            raise ValueError("recovery projection options require settle_batch=True")

    @classmethod
    def publish_current(cls) -> "BatchProjectionOptions":
        return cls(publish_only=True)

    @classmethod
    def owner_finalization(cls) -> "BatchProjectionOptions":
        return cls(repair=True, settle_batch=True)

    @classmethod
    def observer(cls, *, repair: bool, settle_batch: bool) -> "BatchProjectionOptions":
        return cls(repair=repair, settle_batch=settle_batch, allow_unmarked=True)

    @classmethod
    def cancellation(cls) -> "BatchProjectionOptions":
        return cls(settle_batch=True, allow_unmarked=True)

    @classmethod
    def recovery(cls) -> "BatchProjectionOptions":
        return cls(settle_batch=True, allow_unmarked=True, finish_unstarted_tail=True, recovering=True)


class ProjectionIntegrityError(RuntimeError):
    pass


class RuntimeProgressPort(Protocol):
    """Abstract surface the runtime uses to mirror run / batch progress."""

    async def ensure_delegate_tasks_plan(self, ctx: TurnContext, prepared: PreparedTaskBatch) -> None: ...

    async def create_delegate_tasks_call(
        self,
        ctx: TurnContext,
        prepared: PreparedTaskBatch,
        *,
        batch_id: str,
    ) -> int: ...

    async def remove_delegate_tasks_call(
        self,
        ctx: TurnContext,
        parent_tool_call_id: int,
        *,
        batch_id: str,
    ) -> bool: ...

    async def sync_batch_projection(
        self,
        ctx: TurnContext,
        batch: BatchRecord,
        runs: list[TaskRun],
        results: list[TaskResult],
        *,
        options: BatchProjectionOptions | None = None,
    ) -> bool: ...

    async def add_task_sub_call(
        self,
        ctx: TurnContext,
        *,
        parent_tool_call_id: int,
        task: TaskSpec,
        sub_call_index: int,
    ) -> int: ...

    async def mark_delegate_tasks_failed(
        self,
        ctx: TurnContext,
        parent_tool_call_id: int,
        *,
        batch_id: str,
    ) -> None: ...

    async def mark_delegate_tasks_terminal(
        self,
        ctx: TurnContext,
        parent_tool_call_id: int,
        batch_status: BatchStatus,
        *,
        batch_id: str,
    ) -> None: ...

    async def mark_run_queued(self, ctx: TurnContext, run: TaskRun) -> None: ...

    async def mark_retry_pending(self, ctx: TurnContext, run: TaskRun) -> None: ...

    async def run_stage(self, ctx: TurnContext, run: TaskRun, *, stage: str) -> None: ...

    async def mark_run_terminal(
        self,
        ctx: TurnContext,
        run: TaskRun,
        result: TaskResult,
        *,
        sandbox_released: bool = False,
        lease_outcome: str = "",
    ) -> None: ...

    async def publish_deliverable(
        self,
        ctx: TurnContext,
        tool_call_id: int,
        deliverable: DeliverableSpec,
        *,
        replace_key: Callable[[DeliverableSpec], str | None] | None = None,
    ) -> None: ...

    async def publish_parent_batch_progress(
        self,
        ctx: TurnContext,
        batch: BatchRecord,
        runs: list[TaskRun],
    ) -> None: ...

    async def mark_cancelled_runs(self, ctx: TurnContext, runs: list[TaskRun], reason: str) -> None: ...

    async def mark_parent_step_terminal_if_settled(
        self,
        ctx: TurnContext,
        parent_tool_call_id: int,
        batch_status: BatchStatus,
        *,
        batch_id: str,
        finish_unstarted_tail: bool = False,
        recovering: bool = False,
    ) -> None: ...

    async def mirror_run_progress(self, ctx: TurnContext, run: TaskRun, stop: asyncio.Event) -> None: ...
