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

"""Task runtime manager - orchestration facade.

:class:`TaskManager` is a thin composition root. It wires the runtime's
collaborators together in ``__init__`` and exposes a small public surface
(``submit_prepared``, ``cancel_turn``, ``get_task_detail``,
``build_tool_payload``, ``reconcile_stale_runs``).
Each public method delegates to the collaborator that owns the work:

* :class:`~.submitter.Submitter`        - batch submission + scheduling
* :class:`~.run_coordinator.RunCoordinator`   - single-run execution
* :class:`~.sandbox_coordinator.SandboxCoordinator` - sandbox leases
* :class:`~.presentation.progress_sink.ProgressSink` - plan / tool-call streaming UI
* :class:`~.stale_reconciler.StaleReconciler` - crash recovery

Each collaborator holds its own dependencies directly.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import TYPE_CHECKING

from .models import TERMINAL_BATCH_STATUSES, PlanCancellationRequested
from .context import TurnContext
from .executors.base import DispatchRouter, Executor
from .factory import (
    default_task_manager,
    set_task_manager_factory,
)
from .models import PreparedTaskBatch
from .models import (
    BatchResult,
    BatchStatus,
    TaskRun,
)
from .presentation.rendering import parent_payload
from .presentation.progress_sink import ProgressSink
from .run_coordinator import RunCoordinator
from .sandbox import SandboxLeaseManager
from .sandbox_coordinator import SandboxCoordinator
from .scheduler import DEFAULT_MAX_CONCURRENCY, BatchScheduler
from .stale_reconciler import (
    StaleReconciler,
    reconcile_stale_task_runtime_once,
    run_task_runtime_startup_reconciler,
)
from .store import FileRunStore, RunStore
from .submitter import Submitter
from .workspace import workspace_layout

if TYPE_CHECKING:
    from .skill_loader import SkillLoader

# Public entrypoints re-exported from this module for callers that import them
# from ``app.biz.task_runtime.manager``. Module-private helpers (``_merge_run_snapshots``,
# ``_plan_context_for_batch``, ...) are intentionally NOT re-exported: import them
# from their owning module if ever needed.
__all__ = [
    "PlanCancellationRequested",
    "TaskManager",
    "cancel_turn_task_runtime_once",
    "default_task_manager",
    "reconcile_stale_task_runtime_once",
    "run_task_runtime_startup_reconciler",
    "set_task_manager_factory",
]


_LOGGER = logging.getLogger(__name__)


class TaskManager:
    """Compose the runtime collaborators and expose the public entrypoints."""

    def __init__(
        self,
        store: RunStore,
        executor: Executor,
        *,
        max_concurrency: int = DEFAULT_MAX_CONCURRENCY,
        sidechain_root: Path | None = None,
        sandbox_lease_manager: SandboxLeaseManager | None = None,
        skill_loader: "SkillLoader | None" = None,
    ) -> None:
        self.store = store
        self.sidechain_root = sidechain_root
        self.scheduler = BatchScheduler(max_concurrency=max_concurrency)

        # Route dispatch through a DispatchRouter so the run coordinator never
        # branches on dispatch kind. A bare backend is wrapped so tool/skill
        # runs still execute; sub-agent runs then deterministically reject
        # until a sub-agent executor is supplied via a pre-built router.
        router = executor if isinstance(executor, DispatchRouter) else DispatchRouter(tool=executor)

        self.progress = ProgressSink(store)
        self.sandbox = SandboxCoordinator(store, self.progress, lease_manager=sandbox_lease_manager)
        self.runs = RunCoordinator(store, router, self.progress, self.sandbox)
        self.submitter = Submitter(
            store=store,
            scheduler=self.scheduler,
            progress=self.progress,
            sandbox=self.sandbox,
            runs=self.runs,
            batch_dir=self._batch_dir,
            run_dir=self._run_dir,
            merge_run_snapshots=_merge_run_snapshots,
            skill_loader=skill_loader,
        )
        self.reconciler = StaleReconciler(
            store=store,
            sandbox=self.sandbox,
            progress=self.progress,
            batch_dir=self._batch_dir,
        )

    # -- public entrypoints -------------------------------------------------

    async def submit_prepared(self, ctx: TurnContext, prepared: PreparedTaskBatch) -> BatchResult:
        """Sole batch-submission entrypoint.

        ``prepared`` is a trusted handoff produced by the upstream preparation
        pipeline; its ``batch.tasks`` already carry the post-normalization
        ``dispatch`` / ``display`` shape and ``batch_metadata`` lands verbatim
        on :attr:`BatchRecord.metadata` (the runtime never writes bare keys into
        it; its own observability is namespaced under the reserved
        ``_task_runtime`` key). ``ctx`` is the per-turn envelope (identity,
        ``plan_editor`` for streaming UI, and the append-only
        ``task_runtime_batch_ids`` list post-turn refreshers iterate)."""
        return await self.submitter.submit(ctx, prepared, batch_metadata=dict(prepared.batch_metadata))

    async def get_task_detail(self, run_id: str, view: str):
        return await self.store.get_task_detail(run_id, view)  # type: ignore[arg-type]

    async def build_tool_payload(self, result: BatchResult, *, keep_full_structure: bool = False) -> dict:
        return await parent_payload.build_tool_payload(self.store, result, keep_full_structure=keep_full_structure)

    async def reconcile_stale_runs(self, ctx: TurnContext | None = None) -> None:
        await self.reconciler.reconcile(ctx)

    async def cancel_turn(self, ctx: TurnContext, reason: str = "Task cancelled by user.") -> int:
        from .results import safe_list_batch_runs

        batches = await self.store.list_batches_by_turn(ctx.conversation_id, ctx.turn_id, active_only=True)
        cancelled_count = 0
        for batch in batches:
            runs_before_cancel = await safe_list_batch_runs(self.store, batch.batch_id)
            try:
                await self.store.cancel_batch(batch.batch_id, reason)
                cancelled_count += 1
            except Exception:
                _LOGGER.warning("failed to cancel task runtime batch batch_id=%s", batch.batch_id, exc_info=True)
                continue

            runs_after_cancel = await safe_list_batch_runs(self.store, batch.batch_id)
            cancelled_run_snapshots = _merge_run_snapshots(runs_before_cancel, runs_after_cancel)
            await self.sandbox.release_many(cancelled_run_snapshots)
            try:
                await self.progress.mark_cancelled_runs(ctx, cancelled_run_snapshots, reason)
                refreshed_batch = await self.store.get_batch(batch.batch_id)
                refreshed_runs = await self.store.list_batch_runs(batch.batch_id)
                await self.progress.publish_parent_batch_progress(ctx, refreshed_batch, refreshed_runs)
                terminal_status = (
                    refreshed_batch.status if refreshed_batch.status in TERMINAL_BATCH_STATUSES else BatchStatus.CANCELLED
                )
                await self.progress.mark_parent_step_terminal_if_settled(
                    ctx,
                    refreshed_batch.parent_tool_call_id or 0,
                    terminal_status,
                )
            except Exception:
                _LOGGER.warning("failed to refresh cancellation progress batch_id=%s", batch.batch_id, exc_info=True)
        return cancelled_count

    # -- run / batch directory resolution ----------------------------------

    def _batch_dir(self, batch_id: str) -> Path:
        batch_dir = getattr(self.store, "batch_dir", None)
        if callable(batch_dir):
            return batch_dir(batch_id)
        if self.sidechain_root is None:
            raise ValueError("sidechain_root is required for stores without batch_dir")
        return self.sidechain_root / batch_id

    def _run_dir(self, batch_id: str, run_id: str) -> Path:
        run_dir = getattr(self.store, "run_dir", None)
        if callable(run_dir):
            return run_dir(batch_id, run_id)
        return self._batch_dir(batch_id) / run_id


def _merge_run_snapshots(*snapshots: list[TaskRun]) -> list[TaskRun]:
    merged: dict[str, TaskRun] = {}
    for runs in snapshots:
        for run in runs:
            existing = merged.get(run.run_id)
            if existing is None:
                merged[run.run_id] = run
                continue
            updates: dict[str, object] = {}
            if run.sandbox is None and existing.sandbox is not None:
                updates["sandbox"] = existing.sandbox
            if not run.sandbox_released and existing.sandbox_released:
                updates["sandbox_released"] = existing.sandbox_released
            if not run.lease_outcome and existing.lease_outcome:
                updates["lease_outcome"] = existing.lease_outcome
            merged[run.run_id] = run.model_copy(update=updates) if updates else run
    return list(merged.values())


async def cancel_turn_task_runtime_once(
    ctx: TurnContext,
    *,
    reason: str = "Task cancelled by user.",
    store: RunStore | None = None,
    sandbox_lease_manager: SandboxLeaseManager | None = None,
) -> int:
    from .stale_reconciler import _ReconcileOnlyExecutor

    if store is None:
        if os.getenv("TASK_RUNTIME_RUN_STORE", "backend").strip().lower() in {"backend", "db", "mysql"}:
            from .db_store import DBRunStore

            store = DBRunStore()
        else:
            workspace_root = workspace_layout().workspace_path(ctx.agent_instance_id, ctx.username)
            store = FileRunStore(workspace_root / "results")
    manager = TaskManager(store, _ReconcileOnlyExecutor(), sandbox_lease_manager=sandbox_lease_manager)
    return await manager.cancel_turn(ctx, reason)
