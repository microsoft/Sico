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

"""Result construction, aggregation, parsing, and finalization helpers.

This module gathers the pure / IO-light helpers that translate runtime state
into :class:`TaskResult` / :class:`BatchResult` values:

- **Constructors** (``blocked_result`` / ``failed_result`` / ``cancelled_result``,
  ``build_policy_denied_result`` / ``build_user_input_result``) build terminal
  results for failure and cancellation states.
- **Aggregation** (``count_results`` / ``batch_status`` / ``aggregate``) folds a
  list of per-run results into a :class:`BatchResult`.
- **Finalization** (``ensure_result_persisted`` / ``finalize_nonterminal_runs`` /
  ``batch_results`` + helpers) reconciles stored results with what the scheduler
  observed, so the submit path (:class:`Submitter`) and the recovery path
  (:class:`StaleReconciler`) can share them.

Collaborator types (``RunStore`` / ``RuntimeProgressPort`` / ``TurnContext``) are
imported under ``TYPE_CHECKING`` only — used purely for annotations — which
keeps this module free of import cycles with the progress port.
"""

from __future__ import annotations

import contextlib
import logging
from typing import TYPE_CHECKING

from .models import (
    TERMINAL_STATUSES,
    BatchRecord,
    BatchResult,
    BatchStatus,
    ErrorClass,
    FencingToken,
    TaskDetail,
    TaskResult,
    TaskRun,
    TaskStatus,
)
from .store import StaleWorkerError
from .time_utils import now_ms as _now_ms

if TYPE_CHECKING:
    from .context import TurnContext
    from .progress_port import RuntimeProgressPort
    from .store import RunStore

_LOGGER = logging.getLogger(__name__)


# --------------------------------------------------------------------------- #
# Terminal result constructors.
# --------------------------------------------------------------------------- #


def blocked_result(run: TaskRun, message: str, error_class: ErrorClass) -> TaskResult:
    now_ms = _now_ms()
    return TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.BLOCKED,
        title=run.spec.title,
        summary=message,
        error_class=error_class,
        error_message=message,
        started_at=now_ms,
        ended_at=now_ms,
        duration_ms=0,
    )


def failed_result(run: TaskRun, message: str, error_class: ErrorClass) -> TaskResult:
    now_ms = _now_ms()
    started_at = run.started_at or run.queued_at or now_ms
    return TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.FAILED,
        title=run.spec.title,
        summary=message,
        error_class=error_class,
        error_message=message,
        started_at=started_at,
        ended_at=now_ms,
        duration_ms=max(0, now_ms - started_at),
    )


def cancelled_result(run: TaskRun, message: str) -> TaskResult:
    now_ms = _now_ms()
    return TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.CANCELLED,
        title=run.spec.title,
        summary=message,
        error_class=ErrorClass.CANCELLED,
        error_message=message,
        started_at=now_ms,
        ended_at=now_ms,
        duration_ms=0,
    )


def build_policy_denied_result(run: TaskRun, message: str) -> TaskResult:
    now_ms = _now_ms()
    return TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.FAILED,
        title=run.spec.title,
        summary=message,
        error_class=ErrorClass.POLICY_DENY,
        error_message=message,
        started_at=now_ms,
        ended_at=now_ms,
        duration_ms=0,
    )


def build_user_input_result(run: TaskRun, message: str) -> TaskResult:
    now_ms = _now_ms()
    return TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.FAILED,
        title=run.spec.title,
        summary=message,
        error_class=ErrorClass.USER_INPUT,
        error_message=message,
        started_at=now_ms,
        ended_at=now_ms,
        duration_ms=0,
    )


# --------------------------------------------------------------------------- #
# Batch aggregation.
# --------------------------------------------------------------------------- #


def count_results(results: list[TaskResult]) -> dict[TaskStatus, int]:
    return {status: sum(1 for result in results if result.status == status) for status in TERMINAL_STATUSES}


def batch_status(results: list[TaskResult], join_strategy: str = "partial_ok") -> BatchStatus:  # noqa: PLR0911
    if join_strategy == "first_success" and any(result.status == TaskStatus.COMPLETED for result in results):
        return BatchStatus.COMPLETED
    statuses = [result.status for result in results]
    if all(status == TaskStatus.COMPLETED for status in statuses):
        return BatchStatus.COMPLETED
    if any(status == TaskStatus.COMPLETED for status in statuses):
        return BatchStatus.PARTIAL
    if any(status == TaskStatus.BLOCKED for status in statuses):
        return BatchStatus.BLOCKED
    if any(status == TaskStatus.TIMED_OUT for status in statuses):
        return BatchStatus.TIMED_OUT
    if all(status == TaskStatus.CANCELLED for status in statuses):
        return BatchStatus.CANCELLED
    return BatchStatus.FAILED


def aggregate(batch: BatchRecord, results: list[TaskResult], *, artifacts_root: str) -> BatchResult:
    counts = count_results(results)
    return BatchResult(
        batch_id=batch.batch_id,
        status=batch_status(results, batch.join_strategy),
        total_count=len(results),
        completed_count=counts[TaskStatus.COMPLETED],
        failed_count=counts[TaskStatus.FAILED],
        cancelled_count=counts[TaskStatus.CANCELLED],
        timed_out_count=counts[TaskStatus.TIMED_OUT],
        blocked_count=counts[TaskStatus.BLOCKED],
        results=results,
        artifacts_root=artifacts_root,
    )


# --------------------------------------------------------------------------- #
# Run-result persistence + non-terminal finalization.
# --------------------------------------------------------------------------- #


def _settled_result_from_detail(detail: TaskDetail, fallback: TaskResult) -> TaskResult | None:
    if detail.result is not None:
        return detail.result
    if detail.run.status in TERMINAL_STATUSES:
        return terminal_result_from_run(detail.run, fallback=fallback)
    return None


def terminal_result_from_run(run: TaskRun, *, fallback: TaskResult | None = None) -> TaskResult:
    now_ms = _now_ms()
    status_matches_fallback = fallback is not None and fallback.status == run.status
    started_at = run.started_at or (fallback.started_at if fallback else None) or run.queued_at or now_ms
    ended_at = run.ended_at or (fallback.ended_at if fallback else None) or now_ms
    summary = ""
    if status_matches_fallback:
        summary = fallback.summary
    summary = summary or run.last_error or _default_terminal_result_summary(run.status)
    error_class = None
    error_message = ""
    if run.status != TaskStatus.COMPLETED:
        error_class = run.last_error_class or (fallback.error_class if status_matches_fallback and fallback else None)
        if run.status == TaskStatus.CANCELLED:
            error_class = ErrorClass.CANCELLED
        error_class = error_class or ErrorClass.INTERNAL
        error_message = run.last_error or (fallback.error_message if status_matches_fallback and fallback else "") or summary
    duration_ms = None
    if started_at is not None and ended_at is not None:
        duration_ms = max(0, ended_at - started_at)
    return TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=run.status,
        title=run.spec.title,
        summary=summary,
        output=fallback.output if status_matches_fallback and fallback else "",
        primary_artifact=fallback.primary_artifact if status_matches_fallback and fallback else None,
        error_class=error_class,
        error_message=error_message,
        trajectory=fallback.trajectory if status_matches_fallback and fallback else None,
        artifacts=fallback.artifacts if status_matches_fallback and fallback else [],
        logs=fallback.logs if status_matches_fallback and fallback else [],
        sandbox=run.sandbox or (fallback.sandbox if status_matches_fallback and fallback else None),
        started_at=started_at,
        ended_at=ended_at,
        duration_ms=duration_ms,
    )


def _default_terminal_result_summary(status: TaskStatus) -> str:
    if status == TaskStatus.COMPLETED:
        return "Task completed."
    if status == TaskStatus.CANCELLED:
        return "Task cancelled by user."
    return f"Task ended with status {status.value}."


def _ensure_terminal_result(run: TaskRun, result: TaskResult) -> TaskResult:
    if result.status in TERMINAL_STATUSES:
        return result
    now_ms = _now_ms()
    started_at = result.started_at or run.started_at or run.queued_at or now_ms
    return result.model_copy(
        update={
            "status": TaskStatus.BLOCKED,
            "summary": result.summary or "Task runtime did not receive a terminal result for this run.",
            "error_class": result.error_class or ErrorClass.INTERNAL,
            "error_message": result.error_message or "Task runtime result was non-terminal at batch finalization.",
            "started_at": started_at,
            "ended_at": result.ended_at or now_ms,
            "duration_ms": result.duration_ms if result.duration_ms is not None else max(0, now_ms - started_at),
        }
    )


def stranded_result(run: TaskRun) -> TaskResult:
    now_ms = _now_ms()
    started_at = run.started_at or run.queued_at or now_ms
    return TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.BLOCKED,
        title=run.spec.title,
        summary="Task runtime stopped tracking this run before it reached a terminal result.",
        error_class=ErrorClass.INTERNAL,
        error_message="Task runtime scheduler returned while the run was still queued or running.",
        started_at=started_at,
        ended_at=now_ms,
        duration_ms=max(0, now_ms - started_at),
    )


async def force_update_stranded_run(store: RunStore, run: TaskRun, result: TaskResult) -> None:
    updated = run.model_copy(
        update={
            "status": result.status,
            "ended_at": result.ended_at,
            "last_error_class": result.error_class,
            "last_error": result.error_message,
        }
    )
    await store.update_run(updated)


async def persist_stranded_result(store: RunStore, run: TaskRun, result: TaskResult) -> TaskRun:
    if run.status == TaskStatus.QUEUED:
        try:
            token = await store.claim_run(run.run_id, "task-manager-finalizer")
            await store.write_result(run.run_id, result, token)
        except Exception:
            _LOGGER.warning("failed to persist stranded queued run run_id=%s", run.run_id, exc_info=True)
            return run.model_copy(update={"status": result.status, "ended_at": result.ended_at})
    elif run.status == TaskStatus.RUNNING and run.fencing_token:
        token = FencingToken(run_id=run.run_id, token=run.fencing_token, issued_at=run.started_at or run.queued_at)
        try:
            await store.write_result(run.run_id, result, token)
        except StaleWorkerError:
            await force_update_stranded_run(store, run, result)
    elif run.status == TaskStatus.RUNNING:
        fail_stale_run = getattr(store, "fail_stale_run", None)
        if callable(fail_stale_run):
            await fail_stale_run(run.run_id, result, "task-manager-finalizer")
        else:
            await force_update_stranded_run(store, run, result)
    with contextlib.suppress(Exception):
        return await store.get_run(run.run_id)
    return run.model_copy(update={"status": result.status, "ended_at": result.ended_at})


async def ensure_result_persisted(store: RunStore, run: TaskRun, result: TaskResult) -> TaskResult:
    detail = await store.get_task_detail(run.run_id, "summary")
    settled_result = _settled_result_from_detail(detail, result)
    if settled_result is not None:
        return settled_result
    try:
        token = await store.claim_run(run.run_id, "task-manager")
        await store.write_result(run.run_id, result, token)
    except StaleWorkerError:
        detail = await store.get_task_detail(run.run_id, "summary")
        settled_result = _settled_result_from_detail(detail, result)
        if settled_result is not None:
            return settled_result
        raise
    return result


async def ensure_cancelled_state(store: RunStore, run: TaskRun, result: TaskResult) -> None:
    try:
        detail = await store.get_task_detail(run.run_id, "summary")
    except Exception:
        detail = None
    if detail is not None and detail.result is not None:
        return
    with contextlib.suppress(Exception):
        await store.cancel_run(run.run_id, result.summary or "Task cancelled by user.")


async def batch_results(store: RunStore, runs: list[TaskRun]) -> list[TaskResult]:
    results: list[TaskResult] = []
    for run in runs:
        try:
            detail = await store.get_task_detail(run.run_id, "summary")
        except Exception:
            continue
        if detail.result is not None:
            results.append(detail.result)
    return results


async def safe_list_batch_runs(store: RunStore, batch_id: str) -> list[TaskRun]:
    try:
        return await store.list_batch_runs(batch_id)
    except Exception:
        return []


async def finalize_nonterminal_runs(
    store: RunStore,
    progress: RuntimeProgressPort,
    ctx: TurnContext,
    batch: BatchRecord,
    results: list[TaskResult],
) -> list[TaskResult]:
    result_by_run_id = {result.run_id: result for result in results}
    try:
        runs = await store.list_batch_runs(batch.batch_id)
    except Exception:
        return results
    for run in runs:
        if run.run_id not in result_by_run_id:
            with contextlib.suppress(Exception):
                detail = await store.get_task_detail(run.run_id, "summary")
                if detail.result is not None:
                    result_by_run_id[run.run_id] = detail.result
        if run.status in TERMINAL_STATUSES:
            continue
        result = result_by_run_id.get(run.run_id) or stranded_result(run)
        result = _ensure_terminal_result(run, result)
        persisted = await persist_stranded_result(store, run, result)
        await progress.mark_run_terminal(
            ctx,
            persisted,
            result,
            sandbox_released=persisted.sandbox_released,
            lease_outcome=persisted.lease_outcome,
        )
        result_by_run_id[run.run_id] = result
    ordered_runs = sorted(runs, key=lambda item: item.batch_item_index)
    reconciled = [result_by_run_id[run.run_id] for run in ordered_runs if run.run_id in result_by_run_id]
    current_run_ids = {run.run_id for run in runs}
    reconciled.extend(result for result in results if result.run_id not in current_run_ids)
    return reconciled
