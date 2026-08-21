"""Batch submission pipeline.

:class:`Submitter` owns the submission half of the runtime: it turns a trusted
:class:`PreparedTaskBatch` into a :class:`BatchRecord`, materializes the
:class:`TaskRun` rows, drives the scheduler (delegating per-run execution to a
:class:`RunCoordinator`), and aggregates the per-run results back into a
:class:`BatchResult`. It holds its collaborators (store, scheduler, progress,
sandbox, run coordinator) as instance state.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..config import (
    _reuse_wait_timeout_seconds,
    _stale_run_after_ms,
    _task_runtime_heartbeat_interval_seconds,
)
from ..context import TurnContext
from .execution_plan import ExecutionPlanner
from .materialization import (
    SubmissionMaterializer,
    _batch_id_for_submission,
    _prepared_submission_fingerprint,
    _validate_submission_fingerprint_value,
)
from ..domain.models import (
    TERMINAL_STATUSES,
    BatchRecord,
    BatchResult,
    BatchResultDigest,
    BatchStatus,
    ErrorClass,
    TaskResult,
    TaskRun,
    TaskStatus,
    PreparedTaskBatch,
)
from ..presentation.port import RuntimeProgressPort
from ..presentation.rendering.batch_view import _with_result_snapshots
from ..domain.results import aggregate, finalize_nonterminal_runs, safe_list_batch_runs, terminal_result_from_run
from .run_coordinator import RunCoordinator
from ..sandbox.coordinator import SandboxCoordinator
from .scheduler import BatchScheduler, StagedBatchExecutor
from ..domain.state_machine import transition_batch
from ..storage.run_store import RunStore, _write_json_atomic
from ..domain.time import now_ms as _now_ms

if TYPE_CHECKING:
    from ..capabilities.loader import SkillLoader

_LOGGER = logging.getLogger(__name__)

# Consecutive batch-heartbeat failures before escalating from debug to a single
# warning. One miss is self-healing (the next beat recovers); a sustained run
# means queued siblings will eventually be swept, so surface the cause once.
_HEARTBEAT_FAILURE_WARN_THRESHOLD = 3
_REPLAY_RESULT_POLL_SECONDS = 1.0


class _HeartbeatDeathError(Exception):
    """Raised when the heartbeat beater aborts the batch due to sustained failure.

    This is an internal signal — the submitter catches it to mark the batch
    cancelled with a distinct reason, then re-raises so the caller sees a failure.
    """


class Submitter:
    """Drive a prepared batch through planning, scheduling, and aggregation."""

    def __init__(  # noqa: PLR0913 - collaborators are injected explicitly for testability
        self,
        *,
        store: RunStore,
        scheduler: BatchScheduler,
        progress: RuntimeProgressPort,
        sandbox: SandboxCoordinator,
        runs: RunCoordinator,
        batch_dir: Callable[[str], Path],
        merge_run_snapshots: Callable[..., list[TaskRun]],
        skill_loader: "SkillLoader | None" = None,
    ) -> None:
        self._store = store
        self._progress = progress
        self._sandbox = sandbox
        self._batch_dir = batch_dir
        self._merge_run_snapshots = merge_run_snapshots
        self._execution_planner = ExecutionPlanner(sandbox, scheduler.max_concurrency, skill_loader)
        self._staged_executor = StagedBatchExecutor(scheduler, runs, progress, store, merge_run_snapshots)
        self._materializer = SubmissionMaterializer(store, progress, batch_dir)

    # -- public entrypoint --------------------------------------------------

    async def submit(
        self,
        ctx: TurnContext,
        prepared: PreparedTaskBatch,
        *,
        batch_metadata: dict[str, Any],
    ) -> BatchResult:
        if not ctx.submission_id.strip():
            raise ValueError("task runtime submission_id is required")
        self._execution_planner.normalize(prepared)
        # Fingerprint the normalized batch before any capacity planning, so fleet
        # availability changes cannot invalidate an otherwise identical replay.
        submission_fingerprint = _prepared_submission_fingerprint(prepared, ctx.submission_source)
        # chat and runtime are peers: chat prepares the batch, the runtime owns its
        # own execution subtree in the plan (parent umbrella node + child run nodes).
        await self._progress.ensure_delegate_tasks_plan(ctx, prepared)
        parent_tool_call_id = await self._progress.create_delegate_tasks_call(ctx, prepared)
        # The lookup itself is inside the guard: a failing store read (backend
        # down, RPC timeout) must not leave the parent step stuck in "running".
        try:
            existing_batch = await self._materializer.get_existing_batch(_batch_id_for_submission(ctx.submission_id))
            if existing_batch is not None:
                _validate_submission_fingerprint_value(existing_batch, submission_fingerprint)
                batch = existing_batch.model_copy(update={"parent_tool_call_id": parent_tool_call_id})
                _record_context_batch_id(ctx, batch.batch_id)
                return await self._observe_replayed_batch(ctx, batch, parent_tool_call_id)
        except Exception:
            with contextlib.suppress(Exception):
                await self._progress.mark_delegate_tasks_failed(ctx, parent_tool_call_id)
            raise

        execution_plan = await self._execution_planner.plan(ctx, prepared)
        batch = self._materializer.build_batch(
            ctx,
            prepared,
            parent_tool_call_id,
            execution_plan,
            submission_fingerprint=submission_fingerprint,
            metadata=batch_metadata,
        )
        try:
            batch, is_replay = await self._materializer.materialize_batch(ctx, prepared, batch)
            _record_context_batch_id(ctx, batch.batch_id)
            if is_replay:
                return await self._observe_replayed_batch(ctx, batch, parent_tool_call_id)
        except Exception:
            with contextlib.suppress(Exception):
                await self._progress.mark_delegate_tasks_failed(ctx, parent_tool_call_id)
            raise
        runs: list[TaskRun] = []
        try:
            runs = await self._materializer.create_runs(ctx, prepared, batch, parent_tool_call_id)
            await self._progress.publish_parent_batch_progress(ctx, batch, runs)
            async with self._heartbeat_batch_liveness(batch.batch_id):
                results = await self._staged_executor.run(
                    ctx,
                    runs,
                    batch=batch,
                    join_strategy=batch.join_strategy,
                    execution_plan=execution_plan,
                )
            await self._sandbox.cleanup_batch(ctx, batch)
            results = await finalize_nonterminal_runs(self._store, self._progress, ctx, batch, results)
            batch_result = aggregate(
                batch,
                results,
                artifacts_root=str(self._batch_dir(batch.batch_id)),
            )
            transition_batch(batch, batch_result.status)
            batch.counts = BatchResultDigest.from_result(batch_result).counts
            if batch.ended_at is None:
                batch.ended_at = _now_ms()
            final_runs = _with_result_snapshots(
                self._merge_run_snapshots(runs, await self._store.list_batch_runs(batch.batch_id)),
                results,
            )
            await self._store.update_batch(batch)
            await self._progress.publish_parent_batch_progress(ctx, batch, final_runs)
            await self._progress.mark_parent_step_terminal_if_settled(ctx, batch.parent_tool_call_id or 0, batch.status)
            self._save_batch_result(batch.batch_id, batch_result)
            return batch_result
        except _HeartbeatDeathError:
            await self._mark_batch_cancelled(
                ctx,
                batch,
                parent_tool_call_id,
                "Batch aborted: heartbeat to backend lost, batch considered stale.",
            )
            raise
        except asyncio.CancelledError:
            await self._mark_batch_cancelled(
                ctx,
                batch,
                parent_tool_call_id,
                "Task runtime interrupted before completion.",
            )
            raise
        except Exception:
            await self._mark_batch_failed(ctx, batch, parent_tool_call_id)
            raise

    async def _observe_replayed_batch(
        self,
        ctx: TurnContext,
        batch: BatchRecord,
        parent_tool_call_id: int,
    ) -> BatchResult:
        """Observe the original owner without taking liveness or persistence ownership.

        A replay never heartbeats, claims, finalizes, cleans up, or updates the
        shared batch. If the original process died, the normal stale reconciler
        settles queued/running runs and this observer reports those terminal
        FAILED/BLOCKED results rather than risking duplicate side effects.
        """
        runs = await self._materializer.reuse_existing_batch_runs(ctx, batch, parent_tool_call_id)
        await self._progress.publish_parent_batch_progress(ctx, batch, runs)
        results = await self._wait_for_replayed_batch_results(ctx, batch, runs)
        batch_result = aggregate(
            batch,
            results,
            artifacts_root=str(self._batch_dir(batch.batch_id)),
        )
        observed_batch = batch.model_copy(
            update={
                "status": batch_result.status,
                "counts": BatchResultDigest.from_result(batch_result).counts,
                "ended_at": batch.ended_at or _now_ms(),
            }
        )
        final_runs = _with_result_snapshots(
            self._merge_run_snapshots(runs, await self._store.list_batch_runs(batch.batch_id)),
            results,
        )
        await self._progress.publish_parent_batch_progress(ctx, observed_batch, final_runs)
        await self._progress.mark_parent_step_terminal_if_settled(
            ctx,
            parent_tool_call_id,
            observed_batch.status,
        )
        return batch_result

    async def _wait_for_replayed_batch_results(
        self,
        ctx: TurnContext,
        batch: BatchRecord,
        runs: list[TaskRun],
    ) -> list[TaskResult]:
        """Poll batch state once per interval and fetch each terminal result once.

        This avoids one polling loop per run (hundreds of reverse RPCs per
        second for large workbooks). Transient list/detail failures leave the
        affected runs pending until the next batch poll.
        """
        if not runs:
            raise RuntimeError(f"replayed batch {batch.batch_id} has no materialized runs")
        loop = asyncio.get_running_loop()
        observed_at = _now_ms()
        wait_timeout = max(_reuse_wait_timeout_seconds(run) for run in runs)
        deadline = loop.time() + wait_timeout
        templates = {run.run_id: run for run in runs}
        current_runs = dict(templates)
        pending = set(templates)
        results: dict[str, TaskResult] = {}

        while pending and loop.time() < deadline:
            try:
                stored_runs = await self._store.list_batch_runs(batch.batch_id)
            except Exception:
                _LOGGER.debug("replayed batch state read failed batch_id=%s", batch.batch_id, exc_info=True)
            else:
                for stored in stored_runs:
                    template = templates.get(stored.run_id)
                    if template is None or stored.run_id not in pending:
                        continue
                    current = stored.model_copy(
                        update={
                            "parent_tool_call_id": template.parent_tool_call_id,
                            "plan_batch_call_id": template.plan_batch_call_id,
                        }
                    )
                    current_runs[stored.run_id] = current
                    if stored.status not in TERMINAL_STATUSES:
                        continue
                    try:
                        detail = await self._store.get_task_detail(stored.run_id, "summary")
                    except Exception:
                        _LOGGER.debug(
                            "replayed run result read failed run_id=%s",
                            stored.run_id,
                            exc_info=True,
                        )
                        continue
                    result = detail.result or terminal_result_from_run(detail.run)
                    results[stored.run_id] = result
                    pending.remove(stored.run_id)
                    with contextlib.suppress(Exception):
                        await self._progress.mark_run_terminal(ctx, current, result)
            if pending:
                await asyncio.sleep(_REPLAY_RESULT_POLL_SECONDS)

        ended_at = _now_ms()
        for run_id in pending:
            run = current_runs[run_id]
            result = TaskResult(
                run_id=run.run_id,
                task_id=run.spec.task_id,
                status=TaskStatus.BLOCKED,
                title=run.spec.title,
                summary=f"Timed out waiting for prior run {run.run_id} to finish.",
                error_class=ErrorClass.TRANSIENT,
                error_message=f"Timed out waiting for prior run after {wait_timeout}s.",
                started_at=observed_at,
                ended_at=ended_at,
                duration_ms=ended_at - observed_at,
            )
            results[run_id] = result
            with contextlib.suppress(Exception):
                await self._progress.mark_run_terminal(ctx, run, result)

        return [results[run.run_id] for run in runs]

    # -- batch-level liveness ----------------------------------------------

    @contextlib.asynccontextmanager
    async def _heartbeat_batch_liveness(self, batch_id: str) -> AsyncIterator[None]:
        """Keep the batch's still-active runs alive while this process runs.

        Queued runs sit in the scheduler's pending list and are never claimed until
        a sandbox frees up; running runs no longer carry a per-run heartbeat either.
        With a scarce pool a large batch can queue for many minutes; without a
        liveness signal the backend sweeper would reclaim those still-legitimate
        runs and fail the batch. One batch-level heartbeat refreshes a single
        owner-liveness signal for the whole batch (``liveness_at`` on the store
        side); the sweeper gates every run in the batch — queued or running — on
        it, so the cost is O(1) per interval regardless of batch size. When this
        process dies the heartbeat stops and the runs are correctly reclaimed after
        the stale threshold.

        If the heartbeat fails for long enough that the backend would consider the
        batch stale (``TASK_RUNTIME_STALE_RUN_AFTER_MS``), the beater aborts the
        owning task by raising :class:`_HeartbeatDeathError` into it, so the
        submitter cleans up before a stale-reconciler on another pod (or at next
        restart) emits a duplicate recovery message.
        """
        stop = asyncio.Event()
        owner_task = asyncio.current_task()

        async def _beat() -> None:
            interval = _task_runtime_heartbeat_interval_seconds()
            stale_after_ms = _stale_run_after_ms()
            # Derive the abort threshold from the stale window. A value <= 0
            # disables stale sweeping entirely, so disable self-abort too.
            abort_after_failures = max(stale_after_ms // (interval * 1000), 1) if stale_after_ms > 0 else 0
            consecutive_failures = 0
            while not stop.is_set():
                try:
                    await asyncio.wait_for(stop.wait(), timeout=interval)
                    return
                except TimeoutError:
                    pass
                try:
                    await self._store.heartbeat_batch(batch_id)
                    consecutive_failures = 0
                except Exception:
                    consecutive_failures += 1
                    # Warn exactly once when failures stop looking transient, so a
                    # persistent outage (e.g. reverse gRPC down) is visible without
                    # spamming a line every interval.
                    if consecutive_failures == _HEARTBEAT_FAILURE_WARN_THRESHOLD:
                        _LOGGER.warning(
                            "batch heartbeat failing repeatedly batch_id=%s consecutive=%d",
                            batch_id,
                            consecutive_failures,
                            exc_info=True,
                        )
                    else:
                        _LOGGER.debug("batch heartbeat failed batch_id=%s", batch_id, exc_info=True)

                    if abort_after_failures and consecutive_failures >= abort_after_failures:
                        _LOGGER.error(
                            "batch heartbeat lost — aborting batch batch_id=%s consecutive_failures=%d abort_threshold=%d",
                            batch_id,
                            consecutive_failures,
                            abort_after_failures,
                        )
                        if owner_task is not None and not owner_task.done():
                            owner_task.cancel(msg=f"heartbeat lost after {consecutive_failures} consecutive failures")
                        return

        task = asyncio.create_task(_beat())
        # Consume the detached beater's outcome so a post-stop cancel/error never
        # surfaces as an "exception was never retrieved" warning.
        task.add_done_callback(lambda done: done.cancelled() or done.exception())
        try:
            yield
        except asyncio.CancelledError:
            # Distinguish beater-initiated cancellation from external cancellation
            # (e.g. plan cancel, gRPC stream abort). If the beater already stopped
            # (it returns after issuing cancel), this was a heartbeat-death abort.
            if task.done() and not stop.is_set():
                raise _HeartbeatDeathError(f"Batch {batch_id} aborted: heartbeat to backend lost") from None
            raise
        finally:
            # Signal and cancel, but never *await* the beater: a heartbeat parked
            # in a hung ``heartbeat_batch`` RPC is a blocking ``to_thread`` call
            # that cancellation cannot interrupt, and awaiting it would stall batch
            # finalization. A late heartbeat on an already-settled batch is harmless.
            stop.set()
            task.cancel()

    def _save_batch_result(self, batch_id: str, result: BatchResult) -> None:
        """Persist the BatchResult as JSON for tracing."""
        try:
            _write_json_atomic(self._batch_dir(batch_id) / "batch_result.json", result.model_dump(mode="json"))
        except Exception:
            _LOGGER.debug("failed to save batch_result.json for %s", batch_id, exc_info=True)

    # -- abort / termination writers ---------------------------------------

    async def _mark_batch_failed(self, ctx: TurnContext, batch: BatchRecord, parent_tool_call_id: int) -> None:
        transition_batch(batch, BatchStatus.FAILED)
        batch.ended_at = batch.ended_at or _now_ms()
        with contextlib.suppress(Exception):
            await self._store.update_batch(batch)
        with contextlib.suppress(Exception):
            await self._progress.mark_delegate_tasks_failed(ctx, parent_tool_call_id or 0)

    async def _mark_batch_cancelled(
        self,
        ctx: TurnContext,
        batch: BatchRecord,
        parent_tool_call_id: int,
        reason: str,
    ) -> None:
        transition_batch(batch, BatchStatus.CANCELLED)
        batch.cancellation_reason = reason
        batch.ended_at = batch.ended_at or _now_ms()
        with contextlib.suppress(Exception):
            await self._store.cancel_batch(batch.batch_id, reason)
        with contextlib.suppress(Exception):
            await self._store.update_batch(batch)
        with contextlib.suppress(Exception):
            await self._sandbox.cleanup_batch(ctx, batch)
        with contextlib.suppress(Exception):
            cancelled_runs = await safe_list_batch_runs(self._store, batch.batch_id)
            await self._progress.mark_cancelled_runs(ctx, cancelled_runs, reason)
        with contextlib.suppress(Exception):
            await self._progress.mark_delegate_tasks_terminal(ctx, parent_tool_call_id or 0, batch.status)
        with contextlib.suppress(Exception):
            await self._progress.mark_parent_step_terminal_if_settled(ctx, parent_tool_call_id or 0, batch.status)


# ---------------------------------------------------------------------------
# Module-level helpers (pure / IO-light)
# ---------------------------------------------------------------------------


def _record_context_batch_id(ctx: TurnContext, batch_id: str) -> None:
    if not batch_id:
        return
    batch_ids = getattr(ctx, "task_runtime_batch_ids", None)
    if not isinstance(batch_ids, list):
        return
    if batch_id not in batch_ids:
        batch_ids.append(batch_id)
