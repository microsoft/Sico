"""Seam between the runtime core and the plan / front-end progress mirror.

The scheduler, coordinators and result finalizer drive run / batch lifecycle
against the abstract :class:`RuntimeProgressPort` rather than a concrete UI
collaborator. The default implementation
(:class:`~app.biz.task_runtime.presentation.progress_sink.ProgressSink`) mirrors
lifecycle into ``ctx.plan_editor`` and the store; a no-op implementation lets the
scheduler run headless. This module is a pure leaf: every collaborator type is referenced
only under ``TYPE_CHECKING`` so importing it pulls in nothing from the core
runtime, the rendering layer, or ``app.schemas``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    import asyncio
    from collections.abc import Callable

    from ..context import TurnContext
    from ..domain.models import BatchRecord, BatchStatus, TaskResult, TaskRun, TaskStatus
    from .events import DeliverableSpec


class RuntimeProgressPort(Protocol):
    """Abstract surface the runtime uses to mirror run / batch progress."""

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

    async def refresh_parent_batch_progress(
        self,
        ctx: TurnContext,
        run: TaskRun,
        *,
        terminal_result: TaskResult | None = None,
        current_status: TaskStatus | None = None,
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
        finish_unstarted_tail: bool = False,
        recovering: bool = False,
    ) -> None: ...

    async def refresh_batch_run_cards(self, ctx: TurnContext, runs: list[TaskRun]) -> None: ...

    async def mirror_run_progress(self, ctx: TurnContext, run: TaskRun, stop: asyncio.Event) -> None: ...
