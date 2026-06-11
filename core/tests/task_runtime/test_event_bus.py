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

"""Tests for the task-runtime event bus and its integration with the state
machine transition helpers."""

from __future__ import annotations

import logging

import pytest

from app.biz.task_runtime.event_bus import (
    BatchStateTransition,
    RunStateTransition,
    RuntimeEvent,
    RuntimeEventBus,
    clear_default_bus,
    get_default_bus,
    publish,
    set_default_bus,
    subscribe,
)
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
    InvalidTransitionError,
    transition_batch,
    transition_run,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _isolated_default_bus():
    """Each test gets a fresh default bus so subscriptions never leak across
    tests. We swap the module-level singleton rather than mutating the prior
    one in case a previous test stored a reference to it.
    """

    previous = get_default_bus()
    set_default_bus(RuntimeEventBus())
    try:
        yield
    finally:
        set_default_bus(previous)
        # The "previous" bus belongs to other tests / production code; do
        # not clear it. The newly-created throwaway bus is dropped on GC.


def _make_run(status: TaskStatus = TaskStatus.QUEUED, *, run_id: str = "run-1", batch_id: str = "batch-1") -> TaskRun:
    spec = TaskSpec(task_id="task-1", title="Task 1", dispatch=SkillDispatch(skill_name="mock"))
    return TaskRun(
        run_id=run_id,
        batch_id=batch_id,
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


def _make_batch(status: BatchStatus = BatchStatus.QUEUED, *, batch_id: str = "batch-1") -> BatchRecord:
    return BatchRecord(
        batch_id=batch_id,
        parent_conversation_id=1,
        parent_turn_id=1,
        status=status,
        total_count=1,
        created_at=1,
        updated_at=1,
    )


# ---------------------------------------------------------------------------
# Bus mechanics
# ---------------------------------------------------------------------------


def test_subscribe_publish_roundtrip() -> None:
    events: list[RuntimeEvent] = []
    subscribe(events.append)
    publish(RunStateTransition(run_id="r", batch_id="b", from_status=TaskStatus.QUEUED, to_status=TaskStatus.RUNNING))
    assert len(events) == 1
    assert isinstance(events[0], RunStateTransition)
    assert events[0].to_status is TaskStatus.RUNNING


def test_handlers_invoked_in_registration_order() -> None:
    order: list[str] = []
    subscribe(lambda _e: order.append("a"))
    subscribe(lambda _e: order.append("b"))
    subscribe(lambda _e: order.append("c"))
    publish(BatchStateTransition(batch_id="b", from_status=BatchStatus.QUEUED, to_status=BatchStatus.COMPLETED))
    assert order == ["a", "b", "c"]


def test_unsubscribe_callback_removes_handler() -> None:
    events: list[RuntimeEvent] = []
    unsub = subscribe(events.append)
    publish(BatchStateTransition(batch_id="b", from_status=BatchStatus.QUEUED, to_status=BatchStatus.COMPLETED))
    assert len(events) == 1
    unsub()
    publish(BatchStateTransition(batch_id="b", from_status=BatchStatus.QUEUED, to_status=BatchStatus.CANCELLED))
    assert len(events) == 1  # second publish did not reach the unsubscribed handler


def test_unsubscribe_is_idempotent() -> None:
    unsub = subscribe(lambda _e: None)
    unsub()
    unsub()  # second call must not raise


def test_failing_handler_does_not_abort_publish_or_break_publisher(caplog: pytest.LogCaptureFixture) -> None:
    events: list[RuntimeEvent] = []

    def bad(_event: RuntimeEvent) -> None:
        raise RuntimeError("boom")

    subscribe(bad)
    subscribe(events.append)
    with caplog.at_level(logging.ERROR, logger="app.biz.task_runtime.event_bus"):
        publish(RunStateTransition(run_id="r", batch_id="b", from_status=TaskStatus.QUEUED, to_status=TaskStatus.RUNNING))
    # The good handler still received the event.
    assert len(events) == 1
    # The bad handler's exception was logged.
    assert any("event handler raised" in rec.message for rec in caplog.records)


def test_clear_default_bus_drops_all_handlers() -> None:
    events: list[RuntimeEvent] = []
    subscribe(events.append)
    assert get_default_bus().handler_count() == 1
    clear_default_bus()
    assert get_default_bus().handler_count() == 0
    publish(BatchStateTransition(batch_id="b", from_status=BatchStatus.QUEUED, to_status=BatchStatus.COMPLETED))
    assert events == []


def test_runtime_event_bus_instance_is_independent_from_default() -> None:
    bus = RuntimeEventBus()
    default_events: list[RuntimeEvent] = []
    instance_events: list[RuntimeEvent] = []
    subscribe(default_events.append)
    bus.subscribe(instance_events.append)
    bus.publish(RunStateTransition(run_id="r", batch_id="b", from_status=TaskStatus.QUEUED, to_status=TaskStatus.RUNNING))
    assert len(instance_events) == 1
    assert default_events == []  # bus.publish goes to bus, not the default


# ---------------------------------------------------------------------------
# Integration with state_machine
# ---------------------------------------------------------------------------


def test_transition_run_publishes_event_with_old_and_new_status() -> None:
    events: list[RuntimeEvent] = []
    subscribe(events.append)
    run = _make_run(TaskStatus.QUEUED, run_id="run-42", batch_id="batch-99")
    transition_run(run, TaskStatus.RUNNING)
    assert run.status is TaskStatus.RUNNING
    assert len(events) == 1
    event = events[0]
    assert isinstance(event, RunStateTransition)
    assert event.run_id == "run-42"
    assert event.batch_id == "batch-99"
    assert event.from_status is TaskStatus.QUEUED
    assert event.to_status is TaskStatus.RUNNING


def test_transition_batch_publishes_event_with_old_and_new_status() -> None:
    events: list[RuntimeEvent] = []
    subscribe(events.append)
    batch = _make_batch(BatchStatus.QUEUED, batch_id="batch-7")
    transition_batch(batch, BatchStatus.PARTIAL)
    assert batch.status is BatchStatus.PARTIAL
    assert len(events) == 1
    event = events[0]
    assert isinstance(event, BatchStateTransition)
    assert event.batch_id == "batch-7"
    assert event.from_status is BatchStatus.QUEUED
    assert event.to_status is BatchStatus.PARTIAL


def test_illegal_transition_does_not_publish() -> None:
    events: list[RuntimeEvent] = []
    subscribe(events.append)
    run = _make_run(TaskStatus.COMPLETED)
    with pytest.raises(InvalidTransitionError):
        transition_run(run, TaskStatus.FAILED)
    assert events == []
    assert run.status is TaskStatus.COMPLETED


def test_self_transition_still_publishes() -> None:
    # Self-transitions are idempotent re-marks (reconciler re-finalizing an
    # already-FAILED run, etc.). The bus publishes them so observers can
    # see "we touched this row" — subscribers can filter by from==to.
    events: list[RuntimeEvent] = []
    subscribe(events.append)
    run = _make_run(TaskStatus.FAILED)
    transition_run(run, TaskStatus.FAILED)
    assert len(events) == 1
    assert events[0].from_status is TaskStatus.FAILED
    assert events[0].to_status is TaskStatus.FAILED
