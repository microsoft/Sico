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

"""Unit tests for :meth:`RunCoordinator.prepare_retry`.

These pin the same-row reopen contract: a retry rewinds the *same* run row
(terminal -> queued, attempt + 1) under a compare-and-set guard rather than
creating a sibling row, so every ``batch_item_index`` keeps exactly one run row
and the batch counts stay correct by construction. When the row can no longer be
reopened (a concurrent/duplicate reopen, cancellation, or sweep) ``prepare_retry``
returns ``None`` so the scheduler records the prior terminal result instead of
re-executing a phantom retry.
"""

from __future__ import annotations

import time

import pytest

from app.biz.task_runtime.event_bus import RunStateTransition, RuntimeEventBus, get_default_bus, set_default_bus
from app.biz.task_runtime.models import (
    ErrorClass,
    RetryPolicy,
    TaskExecutionPolicy,
    TaskResult,
    TaskRun,
    TaskSpec,
    TaskStatus,
    ToolDispatch,
)
from app.biz.task_runtime.run_coordinator import RunCoordinator
from app.biz.task_runtime.store import StaleWorkerError


@pytest.fixture
def captured_transitions():
    """Capture RunStateTransition events on an isolated default bus."""
    previous = get_default_bus()
    bus = RuntimeEventBus()
    set_default_bus(bus)
    events: list[RunStateTransition] = []
    unsubscribe = bus.subscribe(lambda event: events.append(event) if isinstance(event, RunStateTransition) else None)
    try:
        yield events
    finally:
        unsubscribe()
        set_default_bus(previous)


def _failed_run(attempt: int = 1) -> TaskRun:
    spec = TaskSpec(task_id="A", title="A", dispatch=ToolDispatch(tool_name="echo"))
    return TaskRun(
        run_id="run-A",
        batch_id="batch-1",
        parent_conversation_id=1,
        parent_turn_id=1,
        batch_item_index=0,
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        project_id=1,
        spec=spec,
        # backoff_seconds=0 keeps the test from sleeping the default 5s.
        execution_policy=TaskExecutionPolicy(retry=RetryPolicy(backoff_seconds=0)),
        idempotency_key="A",
        executor="in_process",
        queued_at=int(time.time() * 1000),
        attempt=attempt,
        status=TaskStatus.FAILED,
        # Stale progress from the failed attempt; the reopen must clear it.
        latest_progress_message="step 5 in progress",
        latest_progress_at=123,
    )


def _failed_result(run: TaskRun) -> TaskResult:
    return TaskResult(
        run_id=run.run_id,
        task_id=run.spec.task_id,
        status=TaskStatus.FAILED,
        title=run.spec.title,
        summary="boom",
        error_class=ErrorClass.TRANSIENT,
        error_message="boom",
    )


class _FakeStore:
    def __init__(self, stored: TaskRun, *, reopen_error: Exception | None = None) -> None:
        self._stored = stored
        self.reopen_error = reopen_error
        self.reopen_call: tuple[TaskRun, int] | None = None

    async def get_run(self, run_id: str) -> TaskRun:
        return self._stored.model_copy(deep=True)

    async def reopen_run_for_retry(self, run: TaskRun, *, expected_attempt: int) -> None:
        if self.reopen_error is not None:
            raise self.reopen_error
        self.reopen_call = (run, expected_attempt)


class _FakeProgress:
    def __init__(self) -> None:
        self.retry_pending: list[TaskRun] = []

    async def mark_retry_pending(self, ctx: object, run: TaskRun) -> None:
        self.retry_pending.append(run)


def _coordinator(store: object, progress: object) -> RunCoordinator:
    # executor / sandbox are unused by prepare_retry.
    return RunCoordinator(store, executor=None, progress=progress, sandbox=None)  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_prepare_retry_reopens_same_row_and_increments_attempt(captured_transitions, monkeypatch) -> None:
    import app.biz.task_runtime.run_coordinator as rc_module

    failed = _failed_run(attempt=1)
    store = _FakeStore(failed)
    progress = _FakeProgress()
    coordinator = _coordinator(store, progress)
    # Pin the clock so the re-enqueue timestamp is deterministic.
    monkeypatch.setattr(rc_module, "_now_ms", lambda: 7_777_777)

    next_run = await coordinator.prepare_retry(None, failed, _failed_result(failed))  # type: ignore[arg-type]

    assert next_run is not None
    # Same row (not a sibling) so batch_item_index -> run_id stays 1:1 and counts hold.
    assert next_run.run_id == failed.run_id
    assert next_run.batch_item_index == failed.batch_item_index
    assert next_run.attempt == 2
    assert next_run.status == TaskStatus.QUEUED
    assert next_run.fencing_token == ""
    assert next_run.sandbox is None
    assert next_run.started_at is None and next_run.ended_at is None
    # Re-queueing stamps a fresh enqueue time (not the run's first queued_at).
    assert next_run.queued_at == 7_777_777
    assert next_run.queued_at != failed.queued_at
    # Stale progress from the failed attempt is cleared for the requeued run.
    assert next_run.latest_progress_message == ""
    assert next_run.latest_progress_at == 0
    # CAS baseline is the stored attempt (1), not the incremented one.
    assert store.reopen_call is not None
    sent_run, expected_attempt = store.reopen_call
    assert expected_attempt == 1
    assert sent_run.attempt == 2
    assert progress.retry_pending == [next_run]
    # The FAILED -> QUEUED transition is announced exactly once, after the reopen.
    assert [(e.from_status, e.to_status) for e in captured_transitions] == [
        (TaskStatus.FAILED, TaskStatus.QUEUED)
    ]


@pytest.mark.asyncio
async def test_prepare_retry_returns_none_when_reopen_refused(captured_transitions) -> None:
    failed = _failed_run(attempt=1)
    store = _FakeStore(failed, reopen_error=StaleWorkerError("not reopenable"))
    progress = _FakeProgress()
    coordinator = _coordinator(store, progress)

    next_run = await coordinator.prepare_retry(None, failed, _failed_result(failed))  # type: ignore[arg-type]

    # Reopen refused -> no requeue; scheduler records the prior terminal result.
    assert next_run is None
    # And no phantom "queued for retry" UI update is published.
    assert progress.retry_pending == []
    # Crucially, NO phantom FAILED -> QUEUED transition event is emitted when the
    # reopen is rejected (the event is deferred until the reopen commits).
    assert captured_transitions == []


@pytest.mark.asyncio
async def test_prepare_retry_returns_none_on_unexpected_reopen_error(captured_transitions) -> None:
    # A non-stale backend/network failure during reopen must degrade to "no retry"
    # (return None) instead of bubbling up and aborting the whole batch.
    failed = _failed_run(attempt=1)
    store = _FakeStore(failed, reopen_error=RuntimeError("backend exploded"))
    progress = _FakeProgress()
    coordinator = _coordinator(store, progress)

    next_run = await coordinator.prepare_retry(None, failed, _failed_result(failed))  # type: ignore[arg-type]

    assert next_run is None
    assert progress.retry_pending == []
    # The deferred transition event never fires when the reopen does not commit.
    assert captured_transitions == []


@pytest.mark.asyncio
async def test_prepare_retry_returns_none_when_already_reopened(captured_transitions) -> None:
    # A stale/duplicate retry decision whose re-read run was already reopened to
    # QUEUED by another path must degrade to "no retry" cleanly via the explicit
    # retryable-terminal pre-check — never attempt an illegal QUEUED -> QUEUED
    # transition or a reopen.
    requeued = _failed_run(attempt=2).model_copy(update={"status": TaskStatus.QUEUED})
    store = _FakeStore(requeued)
    progress = _FakeProgress()
    coordinator = _coordinator(store, progress)

    next_run = await coordinator.prepare_retry(None, requeued, _failed_result(requeued))  # type: ignore[arg-type]

    assert next_run is None
    assert store.reopen_call is None
    assert progress.retry_pending == []
    assert captured_transitions == []


@pytest.mark.asyncio
async def test_prepare_retry_returns_none_on_non_terminal_fresh_row(captured_transitions) -> None:
    # If a racing state change left the re-read run RUNNING, it is not reopenable;
    # the pre-check returns None rather than raising InvalidTransitionError. The
    # reopen is never attempted.
    running = _failed_run(attempt=1).model_copy(update={"status": TaskStatus.RUNNING})
    store = _FakeStore(running)
    progress = _FakeProgress()
    coordinator = _coordinator(store, progress)

    next_run = await coordinator.prepare_retry(None, running, _failed_result(running))  # type: ignore[arg-type]

    assert next_run is None
    assert store.reopen_call is None
    assert progress.retry_pending == []
    assert captured_transitions == []


@pytest.mark.asyncio
async def test_prepare_retry_returns_none_on_stale_higher_attempt(captured_transitions) -> None:
    # A stale retry decision (made on attempt 1) whose re-read row is already a
    # HIGHER terminal attempt (another path retried it to attempt 2 and it failed
    # again) must NOT reopen — that would push the run past max_attempts. The CAS
    # baseline is bound to the decision's attempt, so it returns None and the
    # scheduler records the prior result.
    decided = _failed_run(attempt=1)
    fresh = _failed_run(attempt=2)  # store already advanced past the decision's attempt
    store = _FakeStore(fresh)
    progress = _FakeProgress()
    coordinator = _coordinator(store, progress)

    next_run = await coordinator.prepare_retry(None, decided, _failed_result(decided))  # type: ignore[arg-type]

    assert next_run is None
    assert store.reopen_call is None
    assert progress.retry_pending == []
    assert captured_transitions == []
