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

"""Characterization tests for :class:`BatchScheduler`.

The scheduler previously had two code paths (a queue-based fast path for
unbounded batches and a resource-aware path for sandbox/pod-throttled batches).
These tests pin the behaviour both paths must share — concurrency caps, join
strategies, retry handling, and per-resource limits — and lock in the agreed
*fair* (append-to-back) retry-requeue ordering, so the two paths can be merged
into a single resource-aware implementation without observable drift.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from app.biz.task_runtime.models import (
    ErrorClass,
    TaskExecutionPolicy,
    TaskResult,
    TaskRun,
    TaskSpec,
    TaskStatus,
    ToolDispatch,
)
from app.biz.task_runtime.scheduler import BatchScheduler


def _run(task_id: str, index: int) -> TaskRun:
    spec = TaskSpec(task_id=task_id, title=task_id, dispatch=ToolDispatch(tool_name="echo"))
    return TaskRun(
        run_id=f"run-{task_id}",
        batch_id="batch-1",
        parent_conversation_id=1,
        parent_turn_id=1,
        batch_item_index=index,
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        project_id=1,
        spec=spec,
        execution_policy=TaskExecutionPolicy(),
        idempotency_key=task_id,
        executor="in_process",
        queued_at=int(time.time() * 1000),
    )


def _result(run: TaskRun, status: TaskStatus, error_class: ErrorClass | None = None) -> TaskResult:
    return TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=status,
        title=run.spec.title,
        summary="",
        error_class=error_class,
    )


async def _cancel_queued(run: TaskRun, reason: str) -> TaskResult:
    return _result(run, TaskStatus.CANCELLED, ErrorClass.CANCELLED)


@pytest.mark.asyncio
async def test_partial_ok_returns_results_sorted_by_batch_index() -> None:
    runs = [_run("A", 0), _run("B", 1), _run("C", 2)]

    async def execute(run: TaskRun) -> TaskResult:
        # Finish C first to prove ordering is by batch_item_index, not completion.
        if run.spec.task_id != "C":
            await asyncio.sleep(0)
        return _result(run, TaskStatus.COMPLETED)

    results = await BatchScheduler(max_concurrency=3).run(runs, execute)

    assert [r.task_id for r in results] == ["A", "B", "C"]
    assert all(r.status == TaskStatus.COMPLETED for r in results)


@pytest.mark.asyncio
async def test_concurrency_cap_limits_in_flight() -> None:
    runs = [_run(f"t{i}", i) for i in range(6)]
    live = 0
    max_live = 0

    async def execute(run: TaskRun) -> TaskResult:
        nonlocal live, max_live
        live += 1
        max_live = max(max_live, live)
        await asyncio.sleep(0)
        live -= 1
        return _result(run, TaskStatus.COMPLETED)

    await BatchScheduler().run(runs, execute, max_concurrency=2)

    assert max_live == 2


@pytest.mark.asyncio
async def test_resource_limit_caps_in_flight_per_key() -> None:
    runs = [_run(f"t{i}", i) for i in range(4)]
    live = 0
    max_live = 0

    async def execute(run: TaskRun) -> TaskResult:
        nonlocal live, max_live
        live += 1
        max_live = max(max_live, live)
        await asyncio.sleep(0)
        live -= 1
        return _result(run, TaskStatus.COMPLETED)

    await BatchScheduler().run(
        runs,
        execute,
        max_concurrency=5,
        resource_key=lambda run: "k",
        resource_limits={"k": 1},
    )

    assert max_live == 1


@pytest.mark.asyncio
async def test_fail_fast_cancels_remaining() -> None:
    runs = [_run("A", 0), _run("B", 1), _run("C", 2)]
    executed: list[str] = []

    async def execute(run: TaskRun) -> TaskResult:
        executed.append(run.spec.task_id)
        if run.spec.task_id == "B":
            return _result(run, TaskStatus.FAILED, ErrorClass.INTERNAL)
        return _result(run, TaskStatus.COMPLETED)

    results = await BatchScheduler().run(
        runs,
        execute,
        join_strategy="fail_fast",
        cancel_queued=_cancel_queued,
        max_concurrency=1,
    )

    by_id = {r.task_id: r.status for r in results}
    assert by_id == {"A": TaskStatus.COMPLETED, "B": TaskStatus.FAILED, "C": TaskStatus.CANCELLED}
    assert "C" not in executed


@pytest.mark.asyncio
async def test_fail_fast_does_not_retry_after_stop_reason() -> None:
    # Regression: once a join strategy sets stop_reason (here fail_fast), a
    # concurrently-finishing retryable failure must NOT be reopened/requeued.
    # Reopening it would strand the run in QUEUED (nothing claims it after the
    # batch winds down) and settle it as BLOCKED at finalization. It must be
    # recorded as its real terminal result, and prepare_retry must not fire.
    runs = [_run("A", 0), _run("B", 1)]
    executed: list[str] = []
    retried: list[str] = []

    async def execute(run: TaskRun) -> TaskResult:
        executed.append(run.spec.task_id)
        if run.spec.task_id == "A":
            # A fails first (no await) and trips fail_fast before B returns.
            return _result(run, TaskStatus.FAILED, ErrorClass.INTERNAL)
        # B finishes after A with a retryable error.
        await asyncio.sleep(0.02)
        return _result(run, TaskStatus.FAILED, ErrorClass.TRANSIENT)

    def should_retry(run: TaskRun, result: TaskResult) -> bool:
        return result.error_class == ErrorClass.TRANSIENT and run.attempt < 2

    async def prepare_retry(run: TaskRun, result: TaskResult) -> TaskRun | None:
        retried.append(run.spec.task_id)
        return run.model_copy(update={"attempt": run.attempt + 1})

    results = await BatchScheduler().run(
        runs,
        execute,
        join_strategy="fail_fast",
        cancel_queued=_cancel_queued,
        max_concurrency=2,
        should_retry=should_retry,
        prepare_retry=prepare_retry,
    )

    # B's retryable failure is recorded as FAILED (its real terminal result),
    # not retried and not stranded.
    assert retried == []
    assert sorted(executed) == ["A", "B"]
    assert {r.task_id: r.status for r in results} == {
        "A": TaskStatus.FAILED,
        "B": TaskStatus.FAILED,
    }


@pytest.mark.asyncio
async def test_fail_fast_does_not_retry_same_round_stop_and_retryable() -> None:
    # Two-phase done-set: when a single asyncio.wait round yields BOTH a result
    # that trips fail_fast (A) AND a retryable failure (B), B must NOT be reopened
    # regardless of done-set iteration order (asyncio.wait returns a set). A barrier
    # forces both into the same round; prepare_retry asserts it is never called for
    # B, so the test fails deterministically if two-phase processing regresses —
    # independent of which task the set yields first.
    runs = [_run("A", 0), _run("B", 1)]
    barrier = asyncio.Barrier(2)

    async def execute(run: TaskRun) -> TaskResult:
        # Both tasks rendezvous so they land in the same done set.
        await barrier.wait()
        if run.spec.task_id == "A":
            return _result(run, TaskStatus.FAILED, ErrorClass.INTERNAL)
        return _result(run, TaskStatus.FAILED, ErrorClass.TRANSIENT)

    def should_retry(run: TaskRun, result: TaskResult) -> bool:
        return result.error_class == ErrorClass.TRANSIENT and run.attempt < 2

    async def prepare_retry(run: TaskRun, result: TaskResult) -> TaskRun | None:
        raise AssertionError(f"prepare_retry must not be called once a sibling stops the batch (got {run.spec.task_id})")

    results = await BatchScheduler().run(
        runs,
        execute,
        join_strategy="fail_fast",
        cancel_queued=_cancel_queued,
        max_concurrency=2,
        should_retry=should_retry,
        prepare_retry=prepare_retry,
    )

    # B keeps its real FAILED result (never reopened, never cancelled over it).
    assert {r.task_id: r.status for r in results} == {
        "A": TaskStatus.FAILED,
        "B": TaskStatus.FAILED,
    }


@pytest.mark.asyncio
async def test_fail_fast_stops_on_first_retryable_failure_without_retry() -> None:
    # Under fail_fast the FIRST failure stops the batch immediately — even a
    # retryable TRANSIENT one. fail_fast means "stop at the first failure", so no
    # retry is spent: A runs once, stays FAILED, and prepare_retry is never called.
    runs = [_run("A", 0)]
    executed: list[tuple[str, int]] = []

    async def execute(run: TaskRun) -> TaskResult:
        executed.append((run.spec.task_id, run.attempt))
        return _result(run, TaskStatus.FAILED, ErrorClass.TRANSIENT)

    def should_retry(run: TaskRun, result: TaskResult) -> bool:
        return result.error_class == ErrorClass.TRANSIENT and run.attempt < 2

    async def prepare_retry(run: TaskRun, result: TaskResult) -> TaskRun | None:
        raise AssertionError("fail_fast must not retry the first failure")

    results = await BatchScheduler().run(
        runs,
        execute,
        join_strategy="fail_fast",
        cancel_queued=_cancel_queued,
        should_retry=should_retry,
        prepare_retry=prepare_retry,
    )

    assert executed == [("A", 1)]
    assert {r.task_id: r.status for r in results} == {"A": TaskStatus.FAILED}


@pytest.mark.asyncio
async def test_partial_ok_retries_retryable_failure() -> None:
    # The non-fail_fast counterpart: a retryable failure is NOT a stop reason, so
    # the run is retried and succeeds on attempt 2. This guards that switching
    # fail_fast back to "first failure stops" never disables retries for the
    # strategies whose failures do not stop the batch.
    runs = [_run("A", 0)]
    executed: list[tuple[str, int]] = []

    async def execute(run: TaskRun) -> TaskResult:
        executed.append((run.spec.task_id, run.attempt))
        if run.attempt == 1:
            return _result(run, TaskStatus.FAILED, ErrorClass.TRANSIENT)
        return _result(run, TaskStatus.COMPLETED)

    def should_retry(run: TaskRun, result: TaskResult) -> bool:
        return result.error_class == ErrorClass.TRANSIENT and run.attempt < 2

    async def prepare_retry(run: TaskRun, result: TaskResult) -> TaskRun | None:
        return run.model_copy(update={"attempt": run.attempt + 1})

    results = await BatchScheduler().run(
        runs,
        execute,
        join_strategy="partial_ok",
        cancel_queued=_cancel_queued,
        should_retry=should_retry,
        prepare_retry=prepare_retry,
    )

    assert executed == [("A", 1), ("A", 2)]
    assert {r.task_id: r.status for r in results} == {"A": TaskStatus.COMPLETED}


@pytest.mark.asyncio
async def test_first_success_stops_after_first_completed() -> None:
    runs = [_run("A", 0), _run("B", 1), _run("C", 2)]
    executed: list[str] = []

    async def execute(run: TaskRun) -> TaskResult:
        executed.append(run.spec.task_id)
        if run.spec.task_id == "A":
            return _result(run, TaskStatus.FAILED, ErrorClass.INTERNAL)
        return _result(run, TaskStatus.COMPLETED)

    results = await BatchScheduler().run(
        runs,
        execute,
        join_strategy="first_success",
        cancel_queued=_cancel_queued,
        max_concurrency=1,
    )

    by_id = {r.task_id: r.status for r in results}
    assert by_id == {"A": TaskStatus.FAILED, "B": TaskStatus.COMPLETED, "C": TaskStatus.CANCELLED}
    assert "C" not in executed


def _retry_hooks():
    def should_retry(run: TaskRun, result: TaskResult) -> bool:
        return result.error_class == ErrorClass.TRANSIENT and run.attempt < 2

    async def prepare_retry(run: TaskRun, result: TaskResult) -> TaskRun:
        return run.model_copy(update={"attempt": run.attempt + 1})

    return should_retry, prepare_retry


@pytest.mark.asyncio
async def test_retry_requeues_at_back_unbounded() -> None:
    runs = [_run("A", 0), _run("B", 1), _run("C", 2)]
    executed: list[str] = []

    async def execute(run: TaskRun) -> TaskResult:
        executed.append(run.spec.task_id)
        if run.spec.task_id == "A" and run.attempt == 1:
            return _result(run, TaskStatus.FAILED, ErrorClass.TRANSIENT)
        return _result(run, TaskStatus.COMPLETED)

    should_retry, prepare_retry = _retry_hooks()
    results = await BatchScheduler().run(
        runs,
        execute,
        max_concurrency=1,
        should_retry=should_retry,
        prepare_retry=prepare_retry,
    )

    # Fair ordering: A's retry runs only after B and C, not immediately.
    assert executed == ["A", "B", "C", "A"]
    assert {r.task_id: r.status for r in results} == {
        "A": TaskStatus.COMPLETED,
        "B": TaskStatus.COMPLETED,
        "C": TaskStatus.COMPLETED,
    }


@pytest.mark.asyncio
async def test_retry_requeues_at_back_resource_aware() -> None:
    runs = [_run("A", 0), _run("B", 1), _run("C", 2)]
    executed: list[str] = []

    async def execute(run: TaskRun) -> TaskResult:
        executed.append(run.spec.task_id)
        if run.spec.task_id == "A" and run.attempt == 1:
            return _result(run, TaskStatus.FAILED, ErrorClass.TRANSIENT)
        return _result(run, TaskStatus.COMPLETED)

    should_retry, prepare_retry = _retry_hooks()
    results = await BatchScheduler().run(
        runs,
        execute,
        max_concurrency=10,
        resource_key=lambda run: "k",
        resource_limits={"k": 1},
        should_retry=should_retry,
        prepare_retry=prepare_retry,
    )

    # Same fair ordering as the unbounded path once the two paths are unified.
    assert executed == ["A", "B", "C", "A"]
    assert {r.task_id: r.status for r in results} == {
        "A": TaskStatus.COMPLETED,
        "B": TaskStatus.COMPLETED,
        "C": TaskStatus.COMPLETED,
    }


@pytest.mark.asyncio
async def test_retry_refused_records_prior_terminal_result() -> None:
    # When prepare_retry returns None (the run can no longer be reopened — a
    # concurrent/duplicate reopen, cancellation, or sweep), the scheduler must NOT
    # re-execute it: it records the prior terminal result so the case is still
    # counted exactly once (no phantom retry, no double counting).
    runs = [_run("A", 0), _run("B", 1)]
    executed: list[str] = []

    async def execute(run: TaskRun) -> TaskResult:
        executed.append(run.spec.task_id)
        if run.spec.task_id == "A":
            return _result(run, TaskStatus.FAILED, ErrorClass.TRANSIENT)
        return _result(run, TaskStatus.COMPLETED)

    def should_retry(run: TaskRun, result: TaskResult) -> bool:
        return result.error_class == ErrorClass.TRANSIENT and run.attempt < 2

    async def prepare_retry(run: TaskRun, result: TaskResult) -> TaskRun | None:
        return None  # reopen refused

    results = await BatchScheduler().run(
        runs,
        execute,
        max_concurrency=1,
        should_retry=should_retry,
        prepare_retry=prepare_retry,
    )

    # A runs exactly once (no re-execution) and its FAILED result is recorded;
    # exactly one result entry per run_id.
    assert executed == ["A", "B"]
    assert len(results) == 2
    assert {r.task_id: r.status for r in results} == {
        "A": TaskStatus.FAILED,
        "B": TaskStatus.COMPLETED,
    }
