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

"""Stale-run reconciliation for the task runtime.

:class:`StaleReconciler` owns the recovery side of the runtime: detecting stale
queued / running task records, finalizing their results, releasing leaked
sandbox leases, and re-publishing parent-batch progress so the chat plan
reflects the recovered terminal state. It composes the same collaborators the
live path uses (store, sandbox coordinator, progress sink) so recovery and the
happy path produce identical terminal state.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from collections.abc import Callable
from pathlib import Path

from .results import aggregate, batch_results, persist_stranded_result, stranded_result
from .models import TERMINAL_BATCH_STATUSES, TERMINAL_STATUSES
from .config import _stale_run_after_ms
from .context import TurnContext
from .models import (
    BatchRecord,
    BatchResult,
    BatchResultDigest,
    TaskResult,
    TaskRun,
    TaskStatus,
)
from .presentation.rendering.batch_view import tool_call_status_for_batch
from .progress_port import RuntimeProgressPort
from .sandbox import SandboxLeaseManager
from .sandbox_coordinator import SandboxCoordinator
from .state_machine import transition_batch
from .store import RunStore
from .time_utils import now_ms as _now_ms
from .workspace import workspace_layout

_LOGGER = logging.getLogger(__name__)

RECONCILER_RECOVERY_MESSAGE_ENABLED = False


def _is_stale_nonterminal_run(run: TaskRun, stale_before_ms: int) -> bool:
    """Second-pass staleness check used only when finalizing a stale batch.

    The production backend store is authoritative: its batch-liveness sweep
    (``RpcSweepStaleRuns``) already marks every stale run terminal — RUNNING →
    FAILED, QUEUED → BLOCKED — inside the sweep transaction, so by the time the
    reconciler re-reads a swept batch no non-terminal run remains and this
    predicate is never consulted. It exists for the single-writer file store,
    whose ``sweep_stale`` is a pure read that returns RUNNING runs (stranded by
    :meth:`reconcile`) but not their QUEUED siblings; those siblings are recovered
    here by enqueue age. A RUNNING run is deliberately never re-derived as stale
    from a per-run heartbeat: per-run heartbeats no longer exist, a live owner
    keeps the whole batch's liveness fresh (so the batch is never swept), and a
    genuinely hung worker is bounded by its execution timeout — not by this sweep.
    """
    if run.status == TaskStatus.QUEUED:
        return run.queued_at < stale_before_ms
    return False


def _plan_context_for_batch(ctx: TurnContext | None, batch: BatchRecord, runs: list[TaskRun]) -> TurnContext | None:
    if not batch.parent_tool_call_id:
        return None
    run = next((item for item in runs if item.username and item.agent_instance_id), None)
    if run is None:
        return None
    conversation_id = _plan_conversation_id_for_batch(run, batch)
    if ctx is not None and (
        ctx.username == run.username
        and ctx.agent_instance_id == run.agent_instance_id
        and ctx.conversation_id == conversation_id
        and ctx.turn_id == batch.parent_turn_id
    ):
        return ctx
    from app.tools.plan import PlanEditor

    task_runtime_batch_ids = list(ctx.task_runtime_batch_ids) if ctx is not None else [batch.batch_id]

    return TurnContext(
        username=run.username,
        agent_id=run.agent_id,
        agent_instance_id=run.agent_instance_id,
        turn_id=batch.parent_turn_id,
        project_id=run.project_id,
        conversation_id=conversation_id,
        plan_editor=PlanEditor(
            agent_instance_id=run.agent_instance_id,
            username=run.username,
            turn_id=batch.parent_turn_id,
            conversation_id=conversation_id,
        ),
        task_runtime_batch_ids=task_runtime_batch_ids,
    )


def _plan_conversation_id_for_batch(run: TaskRun, batch: BatchRecord) -> int:
    return batch.parent_conversation_id or 0


class StaleReconciler:
    """Recover stale queued / running task records into terminal state."""

    def __init__(
        self,
        *,
        store: RunStore,
        sandbox: SandboxCoordinator,
        progress: RuntimeProgressPort,
        batch_dir: Callable[[str], Path],
    ) -> None:
        self._store = store
        self._sandbox = sandbox
        self._progress = progress
        self._batch_dir = batch_dir

    # -- gating -------------------------------------------------------------

    def should_reconcile(self) -> bool:
        configured = os.getenv("TASK_RUNTIME_RECONCILE_STALE_RUNS", "").strip().lower()
        if configured:
            return configured not in {"0", "false", "no", "off"}
        return self._store.__class__.__name__ == "DBRunStore"

    # -- helpers ------------------------------------------------------------

    def _aggregate(self, batch: BatchRecord, results: list[TaskResult], runs: list[TaskRun]) -> BatchResult:
        return aggregate(batch, results, artifacts_root=self._artifacts_root(batch, runs))

    def _artifacts_root(self, batch: BatchRecord, runs: list[TaskRun]) -> str:
        try:
            return str(self._batch_dir(batch.batch_id))
        except ValueError:
            # The background reconciler builds its TaskManager without a
            # ``sidechain_root``, so the DB-backed store cannot resolve a
            # filesystem batch directory. Derive the same per-owner artifacts
            # root the live submit path uses (``workspace/results/<batch_id>``)
            # so aggregation can complete and the stale batch can be finalized.
            owner = next((run for run in runs if run.username and run.agent_instance_id), None)
            if owner is None:
                return batch.batch_id
            workspace_root = workspace_layout().workspace_path(
                owner.agent_instance_id,
                owner.username,
                conversation_id=getattr(batch, "parent_conversation_id", 0),
            )
            return str(workspace_root / "results" / batch.batch_id)

    async def _update_parent_tool_call(self, ctx: TurnContext, batch: BatchRecord) -> None:
        await ctx.plan_editor.update_tool_call_status(
            batch.parent_tool_call_id or 0,
            tool_call_status_for_batch(batch.status),
        )

    async def _persist_recovered_parent_message(
        self,
        batch: BatchRecord,
        result: BatchResult,
        runs: list[TaskRun],
    ) -> None:
        if not RECONCILER_RECOVERY_MESSAGE_ENABLED:
            return

        owner = next((run for run in runs if run.username and run.agent_instance_id), None)
        if owner is None or not batch.parent_conversation_id or not batch.parent_turn_id:
            return

        from app.biz.reverse_grpc.conversation import ReverseConversationService
        from app.pb.conversation.chat import ChatContentType, FunctionContext
        from app.schemas.conversation import Message

        from .presentation.rendering.text_fragments import (
            _recovered_parent_message_content,
            _recovered_parent_message_result,
        )

        timestamp = batch.ended_at or _now_ms()
        message = Message(
            turn_id=batch.parent_turn_id,
            conversation_id=batch.parent_conversation_id,
            username=owner.username,
            agent_instance_id=owner.agent_instance_id,
            role="assistant",
            content_type=ChatContentType.TEXT,
            content=_recovered_parent_message_content(batch, result),
            function_context=FunctionContext(result=_recovered_parent_message_result(batch.batch_id)),
            created_at=timestamp,
            updated_at=timestamp,
        )
        try:
            service = ReverseConversationService.get_instance()
            await asyncio.to_thread(service.create_message, message)
        except Exception:
            _LOGGER.warning(
                "task_runtime_recovered_message_persist_failed batch_id=%s conversation_id=%s turn_id=%s",
                batch.batch_id,
                batch.parent_conversation_id,
                batch.parent_turn_id,
                exc_info=True,
            )

    async def _publish_recovered_terminal_batch(self, ctx: TurnContext | None, batch: BatchRecord) -> None:
        runs = await self._store.list_batch_runs(batch.batch_id)
        if not runs or any(run.status not in TERMINAL_STATUSES for run in runs):
            return
        results = await batch_results(self._store, runs)
        if len(results) < len(runs):
            return
        plan_ctx = _plan_context_for_batch(ctx, batch, runs)
        batch_result = self._aggregate(batch, results, runs)
        if plan_ctx is not None and batch.parent_tool_call_id:
            await self._progress.refresh_batch_run_cards(plan_ctx, runs)
            await self._progress.publish_parent_batch_progress(plan_ctx, batch, runs)
            await self._update_parent_tool_call(plan_ctx, batch)
            await self._progress.mark_parent_step_terminal_if_settled(
                plan_ctx,
                batch.parent_tool_call_id,
                batch.status,
                finish_unstarted_tail=True,
                recovering=True,
            )
        await self._persist_recovered_parent_message(batch, batch_result, runs)

    async def _finalize_stale_batch(self, ctx: TurnContext | None, batch_id: str, stale_before_ms: int) -> None:
        batch = await self._store.get_batch(batch_id)
        if batch.status in TERMINAL_BATCH_STATUSES:
            await self._publish_recovered_terminal_batch(ctx, batch)
            return
        runs = await self._store.list_batch_runs(batch_id)
        if not runs:
            return
        plan_ctx = _plan_context_for_batch(ctx, batch, runs)
        for run in runs:
            if run.status in TERMINAL_STATUSES or not _is_stale_nonterminal_run(run, stale_before_ms):
                continue
            if run.sandbox is not None:
                await self._sandbox.release_stale(run)
                with contextlib.suppress(Exception):
                    run = await self._store.get_run(run.run_id)
            result = stranded_result(run)
            persisted = await persist_stranded_result(self._store, run, result)
            if plan_ctx is not None:
                await self._progress.mark_run_terminal(
                    plan_ctx,
                    persisted,
                    result,
                    sandbox_released=persisted.sandbox_released,
                    lease_outcome=persisted.lease_outcome,
                )

        final_runs = await self._store.list_batch_runs(batch_id)
        if not final_runs or any(run.status not in TERMINAL_STATUSES for run in final_runs):
            if plan_ctx is not None and batch.parent_tool_call_id:
                await self._progress.publish_parent_batch_progress(plan_ctx, batch, final_runs)
            return
        results = await batch_results(self._store, final_runs)
        if len(results) < len(final_runs):
            return
        if plan_ctx is not None:
            await self._progress.refresh_batch_run_cards(plan_ctx, final_runs)
        batch_result = self._aggregate(batch, results, final_runs)
        transition_batch(batch, batch_result.status)
        batch.counts = BatchResultDigest.from_result(batch_result).counts
        batch.ended_at = batch.ended_at or _now_ms()
        await self._store.update_batch(batch)
        if plan_ctx is not None and batch.parent_tool_call_id:
            await self._progress.publish_parent_batch_progress(plan_ctx, batch, final_runs)
            await self._update_parent_tool_call(plan_ctx, batch)
            await self._progress.mark_parent_step_terminal_if_settled(
                plan_ctx,
                batch.parent_tool_call_id,
                batch.status,
                finish_unstarted_tail=True,
                recovering=True,
            )
        await self._persist_recovered_parent_message(batch, batch_result, final_runs)

    # -- entrypoint ---------------------------------------------------------

    async def reconcile(self, ctx: TurnContext | None = None) -> None:
        if not self.should_reconcile():
            return
        stale_after_ms = _stale_run_after_ms()
        if stale_after_ms <= 0:
            return
        stale_before_ms = _now_ms() - stale_after_ms
        try:
            stale_runs = await self._store.sweep_stale(stale_before_ms)
        except Exception:
            _LOGGER.debug("failed to sweep stale task runtime runs", exc_info=True)
            return
        affected_batch_ids: list[str] = []
        for stale_run in stale_runs:
            if stale_run.batch_id and stale_run.batch_id not in affected_batch_ids:
                affected_batch_ids.append(stale_run.batch_id)
            if not stale_run.run_id:
                continue
            try:
                run = await self._store.get_run(stale_run.run_id)
            except Exception:
                _LOGGER.debug("failed to load stale task runtime run run_id=%s", stale_run.run_id, exc_info=True)
                continue
            await self._sandbox.release_stale(run)
            if run.status == TaskStatus.RUNNING:
                result = stranded_result(run)
                with contextlib.suppress(Exception):
                    await persist_stranded_result(self._store, run, result)
        for batch_id in affected_batch_ids:
            with contextlib.suppress(Exception):
                await self._finalize_stale_batch(ctx, batch_id, stale_before_ms)


# ---------------------------------------------------------------------------
# Module-level entrypoints (invoked from ``app.main``)
# ---------------------------------------------------------------------------


class _ReconcileOnlyExecutor:
    async def run(self, run: TaskRun, store: RunStore) -> TaskResult:
        raise RuntimeError("task runtime stale reconciliation does not execute runs")


async def reconcile_stale_task_runtime_once(
    *,
    store: RunStore | None = None,
    sandbox_lease_manager: SandboxLeaseManager | None = None,
) -> None:
    from .manager import TaskManager

    if store is None:
        if os.getenv("TASK_RUNTIME_RUN_STORE", "backend").strip().lower() not in {"backend", "db", "mysql"}:
            return
        from .db_store import DBRunStore

        store = DBRunStore()
    manager = TaskManager(store, _ReconcileOnlyExecutor(), sandbox_lease_manager=sandbox_lease_manager)
    await manager.reconcile_stale_runs()


async def run_task_runtime_startup_reconciler() -> None:
    """One-shot reconciliation invoked at core startup.

    Recovers batches orphaned by a previous crash or unclean shutdown. Unlike the
    previous continuous loop, this runs exactly once — live-process orphans (e.g.
    heartbeat loss while the submitter is still running) are now handled by the
    submitter's heartbeat self-abort mechanism, eliminating the race where the
    reconciler and a live submitter both finalize the same batch.
    """
    try:
        await reconcile_stale_task_runtime_once()
    except Exception:
        _LOGGER.warning("task runtime startup reconciliation failed", exc_info=True)


# Keep the old name as a deprecated alias so any external callers don't break.
async def run_task_runtime_reconciler(stop_event: asyncio.Event) -> None:
    """Deprecated: use :func:`run_task_runtime_startup_reconciler` instead."""
    await run_task_runtime_startup_reconciler()
