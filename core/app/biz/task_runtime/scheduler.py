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

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Literal

from .models import ErrorClass, TaskResult, TaskRun, TaskStatus

_LOGGER = logging.getLogger(__name__)


JoinStrategy = Literal["all_success", "partial_ok", "first_success", "fail_fast"]


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
