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

"""Unit tests for the task-runtime state machine transition tables."""

from __future__ import annotations

import pytest

from app.biz.task_runtime.models import (
    BatchRecord,
    BatchStatus,
    SkillDispatch,
    TaskExecutionPolicy,
    TaskRun,
    TaskSpec,
    TaskStatus,
)
from app.biz.task_runtime.state_machine import (
    BATCH_TRANSITIONS,
    RUN_TRANSITIONS,
    TERMINAL_BATCH_STATUSES,
    TERMINAL_RUN_STATUSES,
    InvalidTransitionError,
    assert_valid_batch_transition,
    assert_valid_run_transition,
    is_terminal_batch_status,
    is_terminal_run_status,
    is_valid_batch_transition,
    is_valid_run_transition,
    transition_batch,
    transition_run,
)


# ---------------------------------------------------------------------------
# Coverage: tables include every enum member
# ---------------------------------------------------------------------------


def test_run_transitions_cover_every_task_status() -> None:
    assert set(RUN_TRANSITIONS.keys()) == set(TaskStatus)


def test_batch_transitions_cover_every_batch_status() -> None:
    assert set(BATCH_TRANSITIONS.keys()) == set(BatchStatus)


# ---------------------------------------------------------------------------
# Run transitions: positive cases reflecting the live runtime flow
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "old, new",
    [
        # Pre-execution lifecycle
        (TaskStatus.QUEUED, TaskStatus.RUNNING),  # claim
        (TaskStatus.QUEUED, TaskStatus.CANCELLED),  # cancel-before-start
        (TaskStatus.QUEUED, TaskStatus.FAILED),  # internal failure before exec
        (TaskStatus.QUEUED, TaskStatus.BLOCKED),  # policy denied
        (TaskStatus.QUEUED, TaskStatus.TIMED_OUT),  # reconciler stranded
        # Mid-execution settlement
        (TaskStatus.RUNNING, TaskStatus.COMPLETED),
        (TaskStatus.RUNNING, TaskStatus.FAILED),
        (TaskStatus.RUNNING, TaskStatus.CANCELLED),
        (TaskStatus.RUNNING, TaskStatus.TIMED_OUT),
        (TaskStatus.RUNNING, TaskStatus.BLOCKED),
        # Retry path: ``_prepare_retry`` rewinds the row from a retryable
        # terminal status back to QUEUED for the next attempt.
        (TaskStatus.FAILED, TaskStatus.QUEUED),
        (TaskStatus.TIMED_OUT, TaskStatus.QUEUED),
        (TaskStatus.BLOCKED, TaskStatus.QUEUED),
    ],
)
def test_run_transition_allowed(old: TaskStatus, new: TaskStatus) -> None:
    assert is_valid_run_transition(old, new) is True
    assert_valid_run_transition(old, new)  # does not raise


@pytest.mark.parametrize("status", sorted(TERMINAL_RUN_STATUSES, key=lambda s: s.value))
def test_run_terminal_status_self_transition_allowed(status: TaskStatus) -> None:
    # Self-transition is always allowed (idempotent re-mark from reconciler).
    assert is_valid_run_transition(status, status) is True


@pytest.mark.parametrize("status", [TaskStatus.COMPLETED, TaskStatus.CANCELLED])
def test_absorbing_terminal_rejects_anything_else(status: TaskStatus) -> None:
    # COMPLETED and CANCELLED are absorbing — cannot transition to any other
    # status, including the retry path or other terminal states.
    for other in TaskStatus:
        if other is status:
            continue
        assert is_valid_run_transition(status, other) is False


@pytest.mark.parametrize(
    "status",
    [TaskStatus.FAILED, TaskStatus.TIMED_OUT, TaskStatus.BLOCKED],
)
def test_retryable_terminal_only_rewinds_to_queued(status: TaskStatus) -> None:
    # Retryable terminal states allow self-transition and rewind to QUEUED,
    # but not jumps to any other status.
    for other in TaskStatus:
        if other in {status, TaskStatus.QUEUED}:
            assert is_valid_run_transition(status, other) is True
        else:
            assert is_valid_run_transition(status, other) is False


# ---------------------------------------------------------------------------
# Run transitions: explicit illegal cases that should raise
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "old, new",
    [
        (TaskStatus.COMPLETED, TaskStatus.FAILED),  # cannot re-finalize a success
        (TaskStatus.COMPLETED, TaskStatus.QUEUED),  # absorbing terminal
        (TaskStatus.CANCELLED, TaskStatus.RUNNING),  # cannot un-cancel
        (TaskStatus.CANCELLED, TaskStatus.QUEUED),  # absorbing terminal
        (TaskStatus.FAILED, TaskStatus.RUNNING),  # retry rewinds to QUEUED, not RUNNING
        (TaskStatus.FAILED, TaskStatus.COMPLETED),  # cannot promote a failure
        (TaskStatus.RUNNING, TaskStatus.QUEUED),  # rewind only via terminal status
        (TaskStatus.TIMED_OUT, TaskStatus.COMPLETED),  # cannot promote timed-out
        (TaskStatus.BLOCKED, TaskStatus.RUNNING),  # retry rewinds to QUEUED, not RUNNING
    ],
)
def test_run_transition_rejected(old: TaskStatus, new: TaskStatus) -> None:
    assert is_valid_run_transition(old, new) is False
    with pytest.raises(InvalidTransitionError) as excinfo:
        assert_valid_run_transition(old, new)
    err = excinfo.value
    assert err.kind == "task"
    assert err.old is old
    assert err.new is new


# ---------------------------------------------------------------------------
# Batch transitions
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "old, new",
    [
        (BatchStatus.QUEUED, BatchStatus.RUNNING),
        (BatchStatus.QUEUED, BatchStatus.CANCELLED),
        (BatchStatus.RUNNING, BatchStatus.COMPLETED),
        (BatchStatus.RUNNING, BatchStatus.PARTIAL),
        (BatchStatus.RUNNING, BatchStatus.FAILED),
        (BatchStatus.RUNNING, BatchStatus.CANCELLED),
        (BatchStatus.RUNNING, BatchStatus.TIMED_OUT),
        (BatchStatus.RUNNING, BatchStatus.BLOCKED),
    ],
)
def test_batch_transition_allowed(old: BatchStatus, new: BatchStatus) -> None:
    assert is_valid_batch_transition(old, new) is True
    assert_valid_batch_transition(old, new)


@pytest.mark.parametrize("status", sorted(TERMINAL_BATCH_STATUSES, key=lambda s: s.value))
def test_batch_terminal_status_allows_only_self_transition(status: BatchStatus) -> None:
    assert is_valid_batch_transition(status, status) is True
    for other in BatchStatus:
        if other is status:
            continue
        assert is_valid_batch_transition(status, other) is False


@pytest.mark.parametrize(
    "old, new",
    [
        (BatchStatus.COMPLETED, BatchStatus.FAILED),
        (BatchStatus.CANCELLED, BatchStatus.RUNNING),
        (BatchStatus.PARTIAL, BatchStatus.COMPLETED),
        (BatchStatus.RUNNING, BatchStatus.QUEUED),
    ],
)
def test_batch_transition_rejected(old: BatchStatus, new: BatchStatus) -> None:
    assert is_valid_batch_transition(old, new) is False
    with pytest.raises(InvalidTransitionError) as excinfo:
        assert_valid_batch_transition(old, new)
    err = excinfo.value
    assert err.kind == "batch"
    assert err.old is old
    assert err.new is new


# ---------------------------------------------------------------------------
# Terminal-status predicates
# ---------------------------------------------------------------------------


def test_is_terminal_run_status_matches_table() -> None:
    for status in TaskStatus:
        expected = status in TERMINAL_RUN_STATUSES
        assert is_terminal_run_status(status) is expected


def test_is_terminal_batch_status_matches_table() -> None:
    for status in BatchStatus:
        expected = status in TERMINAL_BATCH_STATUSES
        assert is_terminal_batch_status(status) is expected


def test_invalid_transition_error_message_uses_enum_values() -> None:
    with pytest.raises(InvalidTransitionError) as excinfo:
        assert_valid_run_transition(TaskStatus.COMPLETED, TaskStatus.FAILED)
    assert "completed -> failed" in str(excinfo.value)


# ---------------------------------------------------------------------------
# In-place transition helpers
# ---------------------------------------------------------------------------


def _make_run(status: TaskStatus = TaskStatus.QUEUED) -> TaskRun:
    spec = TaskSpec(task_id="task-1", title="Task 1", dispatch=SkillDispatch(skill_name="mock"))
    return TaskRun(
        run_id="run-1",
        batch_id="batch-1",
        parent_conversation_id=1,
        parent_turn_id=1,
        batch_item_index=0,
        username="alice@example.com",
        agent_id="agent",
        agent_instance_id=1,
        project_id=1,
        spec=spec,
        execution_policy=TaskExecutionPolicy(),
        idempotency_key="key",
        executor="local_subprocess",
        queued_at=1,
        status=status,
    )


def _make_batch(status: BatchStatus = BatchStatus.QUEUED) -> BatchRecord:
    return BatchRecord(
        batch_id="batch-1",
        parent_conversation_id=1,
        parent_turn_id=1,
        status=status,
        total_count=1,
        created_at=1,
        updated_at=1,
    )


def test_transition_run_assigns_on_legal_transition() -> None:
    run = _make_run(TaskStatus.QUEUED)
    transition_run(run, TaskStatus.RUNNING)
    assert run.status is TaskStatus.RUNNING


def test_transition_run_allows_retry_rewind() -> None:
    run = _make_run(TaskStatus.FAILED)
    transition_run(run, TaskStatus.QUEUED)
    assert run.status is TaskStatus.QUEUED


def test_transition_run_raises_and_preserves_status_on_illegal() -> None:
    run = _make_run(TaskStatus.COMPLETED)
    with pytest.raises(InvalidTransitionError):
        transition_run(run, TaskStatus.FAILED)
    assert run.status is TaskStatus.COMPLETED


def test_transition_batch_assigns_on_legal_transition() -> None:
    batch = _make_batch(BatchStatus.QUEUED)
    transition_batch(batch, BatchStatus.COMPLETED)
    assert batch.status is BatchStatus.COMPLETED


def test_transition_batch_allows_self_on_terminal() -> None:
    batch = _make_batch(BatchStatus.PARTIAL)
    transition_batch(batch, BatchStatus.PARTIAL)  # idempotent re-mark
    assert batch.status is BatchStatus.PARTIAL


def test_transition_batch_raises_and_preserves_status_on_illegal() -> None:
    batch = _make_batch(BatchStatus.COMPLETED)
    with pytest.raises(InvalidTransitionError):
        transition_batch(batch, BatchStatus.FAILED)
    assert batch.status is BatchStatus.COMPLETED
