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

"""Task runtime state machine — legal transition tables, validators, and
in-place transition helpers.

The module owns the single source of truth for which ``TaskStatus`` /
``BatchStatus`` transitions are legal and provides ``transition_run`` /
``transition_batch`` helpers that callers use instead of writing
``run.status = X`` directly. Helpers assert the transition, assign the new
status in place, and publish a typed event on the default
:mod:`event_bus` so observers (audit log, metrics, future plan-editor
refresh, reverse gRPC sync, …) can react.

Invariants encoded:

* ``COMPLETED`` and ``CANCELLED`` allow ONLY self-transition (idempotent
  re-mark). They are absorbing terminal states — a recorded success or a
  user cancellation must never be overwritten.
* ``FAILED`` / ``TIMED_OUT`` / ``BLOCKED`` allow self-transition AND a
  rewind to ``QUEUED`` for retry (see ``RunCoordinator.prepare_retry``: it
  re-reads the persisted row after ``write_result`` settled it to a
  terminal status, then reopens the same row to ``QUEUED`` via
  ``reopen_run_for_retry`` (a compare-and-set-guarded backend op) so the
  next attempt re-uses the same run row. The ``_should_retry`` guard
  already prevents COMPLETED and CANCELLED from reaching this path, so this
  carve-out applies only to retryable failures.
* ``QUEUED`` may settle to any terminal status (pre-execution failure path,
  cancel-before-start, reconciler stranding) or advance to ``RUNNING``.
* ``RUNNING`` may settle to any terminal status; it cannot legally drop
  back to ``QUEUED`` directly — the rewind goes through a terminal status
  first (the write-result + read-back + reopen sequence in
  ``prepare_retry``).

Batch transitions mirror the per-run rules with ``PARTIAL`` joining the
terminal cluster (it represents a settled batch with mixed run outcomes).
Batches never reset to ``QUEUED`` once they have left it — retries are
per-run, not per-batch.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .event_bus import BatchStateTransition, RunStateTransition, publish
from .models import BatchStatus, TaskStatus

if TYPE_CHECKING:
    from .models import BatchRecord, TaskRun

__all__ = [
    "BATCH_TRANSITIONS",
    "InvalidTransitionError",
    "RUN_TRANSITIONS",
    "TERMINAL_BATCH_STATUSES",
    "TERMINAL_RUN_STATUSES",
    "assert_valid_batch_transition",
    "assert_valid_run_transition",
    "is_terminal_batch_status",
    "is_terminal_run_status",
    "is_valid_batch_transition",
    "is_valid_run_transition",
    "transition_batch",
    "transition_run",
]


# ---------------------------------------------------------------------------
# Terminal status sets
# ---------------------------------------------------------------------------


TERMINAL_RUN_STATUSES: frozenset[TaskStatus] = frozenset(
    {
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.CANCELLED,
        TaskStatus.TIMED_OUT,
        TaskStatus.BLOCKED,
    }
)


TERMINAL_BATCH_STATUSES: frozenset[BatchStatus] = frozenset(
    {
        BatchStatus.COMPLETED,
        BatchStatus.PARTIAL,
        BatchStatus.FAILED,
        BatchStatus.CANCELLED,
        BatchStatus.TIMED_OUT,
        BatchStatus.BLOCKED,
    }
)


# ---------------------------------------------------------------------------
# Transition tables
# ---------------------------------------------------------------------------


def _terminal_only(*statuses: TaskStatus | BatchStatus) -> frozenset:
    return frozenset(statuses)


_RUN_NONTERMINAL_TARGETS: frozenset[TaskStatus] = frozenset(
    {
        TaskStatus.COMPLETED,
        TaskStatus.FAILED,
        TaskStatus.CANCELLED,
        TaskStatus.TIMED_OUT,
        TaskStatus.BLOCKED,
    }
)


RUN_TRANSITIONS: dict[TaskStatus, frozenset[TaskStatus]] = {
    # QUEUED may advance to RUNNING (claim) or settle to any terminal state
    # (pre-execution failure / cancel-before-start / reconciler stranding).
    TaskStatus.QUEUED: frozenset({TaskStatus.RUNNING, *_RUN_NONTERMINAL_TARGETS}),
    # RUNNING settles to a terminal state. We disallow RUNNING → QUEUED
    # directly; retries go through a terminal status first (write_result
    # commits FAILED/TIMED_OUT/BLOCKED, then ``prepare_retry`` re-reads the
    # row and reopens it to QUEUED).
    TaskStatus.RUNNING: _RUN_NONTERMINAL_TARGETS,
    # Absorbing terminal states: a recorded success or user cancellation must
    # never be overwritten — self-transition only (idempotent re-mark).
    TaskStatus.COMPLETED: _terminal_only(TaskStatus.COMPLETED),
    TaskStatus.CANCELLED: _terminal_only(TaskStatus.CANCELLED),
    # Retryable terminal states: ``prepare_retry`` reopens the same row back
    # to QUEUED for the next attempt. Self-transition is also allowed for
    # idempotent re-marks from the reconciler path.
    TaskStatus.FAILED: frozenset({TaskStatus.FAILED, TaskStatus.QUEUED}),
    TaskStatus.TIMED_OUT: frozenset({TaskStatus.TIMED_OUT, TaskStatus.QUEUED}),
    TaskStatus.BLOCKED: frozenset({TaskStatus.BLOCKED, TaskStatus.QUEUED}),
}


_BATCH_NONTERMINAL_TARGETS: frozenset[BatchStatus] = frozenset(
    {
        BatchStatus.COMPLETED,
        BatchStatus.PARTIAL,
        BatchStatus.FAILED,
        BatchStatus.CANCELLED,
        BatchStatus.TIMED_OUT,
        BatchStatus.BLOCKED,
    }
)


BATCH_TRANSITIONS: dict[BatchStatus, frozenset[BatchStatus]] = {
    BatchStatus.QUEUED: frozenset({BatchStatus.RUNNING, *_BATCH_NONTERMINAL_TARGETS}),
    BatchStatus.RUNNING: _BATCH_NONTERMINAL_TARGETS,
    BatchStatus.COMPLETED: _terminal_only(BatchStatus.COMPLETED),
    BatchStatus.PARTIAL: _terminal_only(BatchStatus.PARTIAL),
    BatchStatus.FAILED: _terminal_only(BatchStatus.FAILED),
    BatchStatus.CANCELLED: _terminal_only(BatchStatus.CANCELLED),
    BatchStatus.TIMED_OUT: _terminal_only(BatchStatus.TIMED_OUT),
    BatchStatus.BLOCKED: _terminal_only(BatchStatus.BLOCKED),
}


# ---------------------------------------------------------------------------
# Errors + predicates
# ---------------------------------------------------------------------------


class InvalidTransitionError(ValueError):
    """Raised when a status-mutation site tries to make a transition that the
    state machine forbids (e.g. ``COMPLETED → FAILED``, ``CANCELLED → RUNNING``).
    """

    def __init__(self, *, kind: str, old: TaskStatus | BatchStatus, new: TaskStatus | BatchStatus) -> None:
        self.kind = kind
        self.old = old
        self.new = new
        super().__init__(f"illegal {kind} transition: {old.value} -> {new.value}")


def is_terminal_run_status(status: TaskStatus) -> bool:
    return status in TERMINAL_RUN_STATUSES


def is_terminal_batch_status(status: BatchStatus) -> bool:
    return status in TERMINAL_BATCH_STATUSES


def is_valid_run_transition(old: TaskStatus, new: TaskStatus) -> bool:
    allowed = RUN_TRANSITIONS.get(old)
    if allowed is None:
        return False
    return new in allowed


def is_valid_batch_transition(old: BatchStatus, new: BatchStatus) -> bool:
    allowed = BATCH_TRANSITIONS.get(old)
    if allowed is None:
        return False
    return new in allowed


def assert_valid_run_transition(old: TaskStatus, new: TaskStatus) -> None:
    if not is_valid_run_transition(old, new):
        raise InvalidTransitionError(kind="task", old=old, new=new)


def assert_valid_batch_transition(old: BatchStatus, new: BatchStatus) -> None:
    if not is_valid_batch_transition(old, new):
        raise InvalidTransitionError(kind="batch", old=old, new=new)


# ---------------------------------------------------------------------------
# In-place transition helpers
# ---------------------------------------------------------------------------


def transition_run(run: "TaskRun", new_status: TaskStatus, *, publish_event: bool = True) -> None:
    """Assert + assign a TaskRun status transition in place.

    Replaces direct ``run.status = X`` assignments at mutation sites so that
    illegal transitions raise ``InvalidTransitionError`` instead of silently
    corrupting the run row. On success, publishes a ``RunStateTransition``
    event on the default event bus so observers (plan editor refresh,
    reverse gRPC sync, metrics, ...) can react.

    When ``publish_event`` is False the transition is asserted and applied in
    place but NO event is published. The caller is responsible for publishing it
    via :func:`publish_run_transition` once an external persistence step (e.g.
    the reopen RPC) has committed, so a rolled-back transition never emits a
    phantom event to observers.
    """
    old_status = run.status
    assert_valid_run_transition(old_status, new_status)
    run.status = new_status
    if publish_event:
        publish(
            RunStateTransition(
                run_id=run.run_id,
                batch_id=run.batch_id,
                from_status=old_status,
                to_status=new_status,
            )
        )


def publish_run_transition(run: "TaskRun", *, from_status: TaskStatus) -> None:
    """Publish a ``RunStateTransition`` for an already-applied status change.

    Pairs with ``transition_run(..., publish_event=False)`` when the event must
    be deferred until an external persistence step has committed. ``from_status``
    is the status the run held before the (already-applied) transition; the
    current ``run.status`` is the destination.
    """
    publish(
        RunStateTransition(
            run_id=run.run_id,
            batch_id=run.batch_id,
            from_status=from_status,
            to_status=run.status,
        )
    )


def transition_batch(batch: "BatchRecord", new_status: BatchStatus) -> None:
    """Assert + assign a BatchRecord status transition in place.

    Counterpart to :func:`transition_run` for batch-level status mutations.
    Publishes a ``BatchStateTransition`` event on the default event bus on
    success.
    """
    old_status = batch.status
    assert_valid_batch_transition(old_status, new_status)
    batch.status = new_status
    publish(
        BatchStateTransition(
            batch_id=batch.batch_id,
            from_status=old_status,
            to_status=new_status,
        )
    )
