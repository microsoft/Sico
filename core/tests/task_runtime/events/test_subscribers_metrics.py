"""Tests for the metrics subscriber.

All tests use a dedicated :class:`TransitionMetrics` instance (and a fresh
:class:`RuntimeEventBus`) so the module-level defaults stay untouched.
"""

from __future__ import annotations

import pytest

from app.biz.task_runtime.events.bus import (
    BatchStateTransition,
    RunStateTransition,
    RuntimeEventBus,
)
from app.biz.task_runtime.domain.models import BatchStatus, TaskStatus
from app.biz.task_runtime.events.subscribers import metrics as metrics_mod
from app.biz.task_runtime.events.subscribers.metrics import TransitionMetrics


@pytest.fixture
def bus() -> RuntimeEventBus:
    return RuntimeEventBus()


@pytest.fixture
def aggregator() -> TransitionMetrics:
    return TransitionMetrics()


def test_run_transitions_are_counted_by_from_to_pair(bus: RuntimeEventBus, aggregator: TransitionMetrics) -> None:
    metrics_mod.register(bus, metrics=aggregator)

    bus.publish(RunStateTransition("r1", "b1", TaskStatus.QUEUED, TaskStatus.RUNNING))
    bus.publish(RunStateTransition("r2", "b1", TaskStatus.QUEUED, TaskStatus.RUNNING))
    bus.publish(RunStateTransition("r1", "b1", TaskStatus.RUNNING, TaskStatus.COMPLETED))

    snapshot = aggregator.snapshot()
    assert snapshot["run"] == {
        "queued->running": 2,
        "running->completed": 1,
    }
    assert snapshot["batch"] == {}


def test_batch_transitions_are_counted_independently(bus: RuntimeEventBus, aggregator: TransitionMetrics) -> None:
    metrics_mod.register(bus, metrics=aggregator)

    bus.publish(BatchStateTransition("b1", BatchStatus.QUEUED, BatchStatus.RUNNING))
    bus.publish(BatchStateTransition("b1", BatchStatus.RUNNING, BatchStatus.COMPLETED))
    bus.publish(BatchStateTransition("b2", BatchStatus.RUNNING, BatchStatus.FAILED))

    snapshot = aggregator.snapshot()
    assert snapshot["batch"] == {
        "queued->running": 1,
        "running->completed": 1,
        "running->failed": 1,
    }
    assert snapshot["run"] == {}


def test_self_transitions_are_counted(bus: RuntimeEventBus, aggregator: TransitionMetrics) -> None:
    metrics_mod.register(bus, metrics=aggregator)

    bus.publish(RunStateTransition("r1", "b1", TaskStatus.FAILED, TaskStatus.FAILED))

    assert aggregator.snapshot()["run"] == {"failed->failed": 1}


def test_snapshot_returns_independent_copy(bus: RuntimeEventBus, aggregator: TransitionMetrics) -> None:
    metrics_mod.register(bus, metrics=aggregator)
    bus.publish(RunStateTransition("r1", "b1", TaskStatus.QUEUED, TaskStatus.RUNNING))

    snapshot = aggregator.snapshot()
    snapshot["run"]["queued->running"] = 999
    snapshot["run"]["bogus"] = 1

    # Mutating the snapshot must not leak back into the aggregator.
    assert aggregator.snapshot()["run"] == {"queued->running": 1}


def test_reset_clears_all_counters(bus: RuntimeEventBus, aggregator: TransitionMetrics) -> None:
    metrics_mod.register(bus, metrics=aggregator)
    bus.publish(RunStateTransition("r1", "b1", TaskStatus.QUEUED, TaskStatus.RUNNING))
    bus.publish(BatchStateTransition("b1", BatchStatus.QUEUED, BatchStatus.RUNNING))

    aggregator.reset()

    assert aggregator.snapshot() == {"run": {}, "batch": {}}


def test_unsubscribe_stops_counting(bus: RuntimeEventBus, aggregator: TransitionMetrics) -> None:
    unsubscribe = metrics_mod.register(bus, metrics=aggregator)
    bus.publish(RunStateTransition("r1", "b1", TaskStatus.QUEUED, TaskStatus.RUNNING))
    unsubscribe()
    bus.publish(RunStateTransition("r2", "b1", TaskStatus.QUEUED, TaskStatus.RUNNING))

    assert aggregator.snapshot()["run"] == {"queued->running": 1}


def test_unknown_event_type_is_ignored(bus: RuntimeEventBus, aggregator: TransitionMetrics) -> None:
    metrics_mod.register(bus, metrics=aggregator)

    class _SyntheticEvent:
        pass

    bus.publish(_SyntheticEvent())  # type: ignore[arg-type]

    assert aggregator.snapshot() == {"run": {}, "batch": {}}


def test_default_aggregator_helpers_round_trip() -> None:
    """Module-level helpers operate on the singleton aggregator."""

    bus = RuntimeEventBus()
    metrics_mod.reset_default_metrics()
    try:
        metrics_mod.register(bus)  # uses _DEFAULT_METRICS
        bus.publish(RunStateTransition("r1", "b1", TaskStatus.QUEUED, TaskStatus.RUNNING))
        snapshot = metrics_mod.snapshot_default_metrics()
        assert snapshot["run"] == {"queued->running": 1}
        assert metrics_mod.get_default_metrics().snapshot()["run"] == {"queued->running": 1}
    finally:
        metrics_mod.reset_default_metrics()
