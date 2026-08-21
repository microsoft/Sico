from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

from ..context import TurnContext
from ..domain.models import BatchRecord, ErrorClass, JoinStrategy, TaskResult, TaskRun, TaskStatus
from ..presentation.port import RuntimeProgressPort
from ..presentation.rendering.batch_view import _with_result_snapshots
from ..storage.run_store import RunStore
from .execution_plan import BatchExecutionPlan, _execution_resource_limits

if TYPE_CHECKING:
    from .run_coordinator import RunCoordinator

_LOGGER = logging.getLogger(__name__)


# Default in-batch concurrency. ``TaskManager`` callers and
# :func:`default_task_manager` can override this via the
# ``TASK_RUNTIME_MAX_CONCURRENCY`` environment variable so production
# deployments can tune throughput without code changes.
DEFAULT_MAX_CONCURRENCY = 20


class BatchScheduler:
    def __init__(self, max_concurrency: int = DEFAULT_MAX_CONCURRENCY) -> None:
        self.max_concurrency = max(1, max_concurrency)

    async def run(  # noqa: PLR0913, C901 - scheduler hooks keep orchestration outside TaskManager attempts
        self,
        runs: list[TaskRun],
        execute: Callable[[TaskRun], Awaitable[TaskResult]],
        *,
        join_strategy: JoinStrategy = "partial_ok",
        cancel_queued: Callable[[TaskRun, str], Awaitable[TaskResult]] | None = None,
        max_concurrency: int | None = None,
        resource_key: Callable[[TaskRun], str | None] | None = None,
        resource_limits: dict[str, int] | None = None,
        should_retry: Callable[[TaskRun, TaskResult], bool] | None = None,
        prepare_retry: Callable[[TaskRun, TaskResult], Awaitable[TaskRun | None]] | None = None,
    ) -> list[TaskResult]:
        if not runs:
            return []

        # A single resource-aware loop serves every batch. When no resource
        # limits apply the resource bookkeeping degenerates to a no-op and the
        # loop behaves like a plain FIFO worker pool bounded by ``concurrency``.
        resource_limits = {key: int(limit) for key, limit in (resource_limits or {}).items() if key and int(limit) > 0}
        resolve_key = resource_key or (lambda _run: None)

        pending = list(runs)
        results: dict[str, TaskResult] = {}
        running: dict[asyncio.Task[TaskResult], tuple[TaskRun, str | None]] = {}
        resource_in_use = {key: 0 for key in resource_limits}
        stop_reason: str | None = None
        concurrency = max(1, int(max_concurrency or self.max_concurrency))

        def run_resource(run: TaskRun) -> str | None:
            key = resolve_key(run)
            return key if key in resource_limits else None

        def can_start(run: TaskRun) -> bool:
            key = run_resource(run)
            return key is None or resource_in_use[key] < resource_limits[key]

        def eligible_for_retry(run: TaskRun, result: TaskResult) -> bool:
            return should_retry is not None and prepare_retry is not None and should_retry(run, result)

        while pending or running:
            while stop_reason is None and pending and len(running) < concurrency:
                next_index = next((index for index, run in enumerate(pending) if can_start(run)), None)
                if next_index is None:
                    break
                run = pending.pop(next_index)
                key = run_resource(run)
                if key is not None:
                    resource_in_use[key] += 1
                task = asyncio.create_task(_execute_safely(execute, run))
                running[task] = (run, key)

            if not running:
                break

            done, _ = await asyncio.wait(running.keys(), return_when=asyncio.FIRST_COMPLETED)
            # Two-phase processing of the done set. ``asyncio.wait`` can return
            # several finished tasks at once; collect their results first and
            # decide whether THIS round produces a stop reason before deciding any
            # retries. Otherwise iteration order could reopen a retryable failure
            # moments before a sibling result trips fail_fast / first_success,
            # leaving the reopened run to be cancelled instead of recording its
            # real terminal result.
            completed: list[tuple[TaskRun, TaskResult]] = []
            for task in done:
                run, key = running.pop(task)
                if key is not None:
                    resource_in_use[key] = max(0, resource_in_use[key] - 1)
                completed.append((run, task.result()))

            # Does the batch stop because of THIS round? Under fail_fast any
            # non-completed result stops the batch immediately, even a retryable
            # one: fail_fast means "stop at the first failure" and must not spend
            # a retry first. (first_success stops on a COMPLETED result.) Computed
            # over the whole done set up front so a sibling stop is visible before
            # any retry decision below.
            round_stops = stop_reason is not None or any(
                _stop_reason(join_strategy, result) is not None for _, result in completed
            )

            for run, result in completed:
                # Retry only while the batch keeps progressing. If THIS round (or an
                # earlier one) settled the batch into a stop, skip the reopen and
                # record the prior terminal result, so a winding-down run is never
                # stranded in QUEUED nor cancelled over its real result.
                if not round_stops and eligible_for_retry(run, result):
                    retry_run = await prepare_retry(run, result)
                    if retry_run is not None:
                        # Fair retry: requeue at the back so a flaky run never
                        # starves its siblings.
                        pending.append(retry_run)
                        continue
                    # Reopen was refused (run no longer reopenable) — fall through
                    # and record the prior terminal result so the case is counted.
                results[run.run_id] = result
                _LOGGER.info(
                    "batch %s progress: %d/%d cases finished — %s [%s]",
                    run.batch_id,
                    len(results),
                    len(runs),
                    run.spec.title,
                    result.status.value,
                )
                stop_reason = stop_reason or _stop_reason(join_strategy, result)

        if stop_reason is not None:
            await self._cancel_remaining(pending, results, cancel_queued, stop_reason)

        return sorted(results.values(), key=lambda result: _batch_item_index(runs, result.run_id))

    async def _cancel_remaining(
        self,
        remaining: list[TaskRun],
        results: dict[str, TaskResult],
        cancel_queued: Callable[[TaskRun, str], Awaitable[TaskResult]] | None,
        reason: str,
    ) -> None:
        for run in remaining:
            if cancel_queued is None:
                continue
            results[run.run_id] = await cancel_queued(run, reason)


class StagedBatchExecutor:
    """Drive one batch through ordered stages using ``BatchScheduler``."""

    def __init__(
        self,
        scheduler: BatchScheduler,
        runs: "RunCoordinator",
        progress: RuntimeProgressPort,
        store: RunStore,
        merge_run_snapshots: Callable[..., list[TaskRun]],
    ) -> None:
        self._scheduler = scheduler
        self._runs = runs
        self._progress = progress
        self._store = store
        self._merge_run_snapshots = merge_run_snapshots

    async def run(
        self,
        ctx: TurnContext,
        runs: list[TaskRun],
        *,
        batch: BatchRecord,
        join_strategy: JoinStrategy,
        execution_plan: BatchExecutionPlan,
    ) -> list[TaskResult]:
        stages = _group_runs_by_stage(runs)
        resource_limits = _execution_resource_limits(execution_plan)
        if len(stages) == 1:
            return await self._schedule_runs(
                ctx,
                stages[0][1],
                join_strategy=join_strategy,
                concurrency=execution_plan.concurrency,
                resource_limits=resource_limits,
            )

        results: list[TaskResult] = []
        blocked_by: int | None = None
        last_stage = stages[-1][0]
        for stage_no, stage_runs in stages:
            if blocked_by is not None:
                results.extend(await self._cancel_stage(ctx, stage_runs, blocked_by))
                continue
            stage_results = await self._schedule_runs(
                ctx,
                stage_runs,
                join_strategy=join_strategy,
                concurrency=execution_plan.concurrency,
                resource_limits=resource_limits,
            )
            results.extend(stage_results)
            if _stage_gate_blocks(stage_results, join_strategy):
                blocked_by = stage_no
            if stage_no != last_stage:
                await self._publish_stage_progress(ctx, batch, runs, results)

        order = {run.run_id: run.batch_item_index for run in runs}
        return sorted(results, key=lambda result: order.get(result.run_id, 0))

    async def _publish_stage_progress(
        self,
        ctx: TurnContext,
        batch: BatchRecord,
        runs: list[TaskRun],
        results: list[TaskResult],
    ) -> None:
        with contextlib.suppress(Exception):
            snapshots = _with_result_snapshots(
                self._merge_run_snapshots(runs, await self._store.list_batch_runs(batch.batch_id)),
                results,
            )
            await self._progress.publish_parent_batch_progress(ctx, batch, snapshots)

    async def _schedule_runs(
        self,
        ctx: TurnContext,
        runs: list[TaskRun],
        *,
        join_strategy: JoinStrategy,
        concurrency: int,
        resource_limits: dict[str, int],
    ) -> list[TaskResult]:
        from ..execution.resources import run_resource_key

        return await self._scheduler.run(
            runs,
            lambda run: self._runs.execute(ctx, run),
            join_strategy=join_strategy,
            cancel_queued=lambda run, reason: self._runs.cancel_queued(ctx, run, reason),
            max_concurrency=concurrency,
            resource_key=run_resource_key,
            resource_limits=resource_limits,
            should_retry=_should_retry,
            prepare_retry=lambda run, result: self._runs.prepare_retry(ctx, run, result),
        )

    async def _cancel_stage(
        self,
        ctx: TurnContext,
        runs: list[TaskRun],
        upstream_stage: int,
    ) -> list[TaskResult]:
        reason = f"Skipped: upstream stage {upstream_stage} did not satisfy the batch join strategy."
        return [await self._runs.cancel_queued(ctx, run, reason) for run in runs]


def _group_runs_by_stage(runs: list[TaskRun]) -> list[tuple[int, list[TaskRun]]]:
    grouped: dict[int, list[TaskRun]] = {}
    for run in runs:
        grouped.setdefault(run.spec.stage, []).append(run)
    return [(stage, grouped[stage]) for stage in sorted(grouped)]


def _stage_gate_blocks(results: list[TaskResult], join_strategy: JoinStrategy) -> bool:
    if join_strategy not in ("all_success", "fail_fast"):
        return False
    return any(result.status != TaskStatus.COMPLETED for result in results)


def _should_retry(run: TaskRun, result: TaskResult) -> bool:
    policy = run.execution_policy.retry
    if result.status == TaskStatus.COMPLETED or result.error_class is None:
        return False
    return run.attempt < max(1, policy.max_attempts) and result.error_class in policy.retry_on


async def _execute_safely(
    execute: Callable[[TaskRun], Awaitable[TaskResult]],
    run: TaskRun,
) -> TaskResult:
    """Run ``execute`` for one run, converting any exception into a FAILED result.

    Shared by both scheduler paths so a single bad run can never wedge the
    batch; the failure is logged and surfaced as an INTERNAL-class result.
    """
    try:
        return await execute(run)
    except Exception as exc:
        _LOGGER.exception("batch_scheduler_worker_failed run_id=%s", run.run_id)
        return _internal_failure_result(run, exc)


def _stop_reason(join_strategy: JoinStrategy, result: TaskResult) -> str | None:
    if join_strategy == "fail_fast" and result.status != TaskStatus.COMPLETED:
        return f"Batch stopped after task {result.task_id} ended with {result.status.value}."
    if join_strategy == "first_success" and result.status == TaskStatus.COMPLETED:
        return f"Batch stopped after task {result.task_id} succeeded."
    return None


def _internal_failure_result(run: TaskRun, exc: BaseException) -> TaskResult:
    now_ms = int(time.time() * 1000)
    message = f"Internal task runtime error: {exc.__class__.__name__}: {exc}"
    return TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.FAILED,
        title=run.spec.title,
        summary=message,
        error_class=ErrorClass.INTERNAL,
        error_message=message,
        started_at=run.started_at or now_ms,
        ended_at=now_ms,
        duration_ms=0,
    )


def _batch_item_index(runs: list[TaskRun], run_id: str) -> int:
    return next(run.batch_item_index for run in runs if run.run_id == run_id)
