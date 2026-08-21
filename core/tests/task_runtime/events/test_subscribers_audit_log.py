"""Tests for the audit_log subscriber.

All tests use a fresh ``RuntimeEventBus`` instance so the module-level
default bus is never touched.
"""

from __future__ import annotations

import logging

import pytest

from app.biz.task_runtime.events.bus import (
    BatchStateTransition,
    RunStateTransition,
    RuntimeEventBus,
)
from app.biz.task_runtime.domain.models import BatchStatus, TaskStatus
from app.biz.task_runtime.events.subscribers import audit_log


_AUDIT_LOGGER_NAME = "app.biz.task_runtime.events.subscribers.audit_log"


@pytest.fixture
def bus() -> RuntimeEventBus:
    return RuntimeEventBus()


def test_run_transition_emits_info_log_with_structured_extra(bus: RuntimeEventBus, caplog: pytest.LogCaptureFixture) -> None:
    audit_log.register(bus)

    with caplog.at_level(logging.INFO, logger=_AUDIT_LOGGER_NAME):
        bus.publish(
            RunStateTransition(
                run_id="run-1",
                batch_id="batch-1",
                from_status=TaskStatus.QUEUED,
                to_status=TaskStatus.RUNNING,
            )
        )

    records = [r for r in caplog.records if r.name == _AUDIT_LOGGER_NAME]
    assert len(records) == 1
    record = records[0]
    assert record.levelno == logging.INFO
    assert "run-1" in record.getMessage()
    assert "queued" in record.getMessage()
    assert "running" in record.getMessage()
    # Structured extras for log aggregators.
    assert record.task_runtime_event == "run_state_transition"
    assert record.run_id == "run-1"
    assert record.batch_id == "batch-1"
    assert record.from_status == "queued"
    assert record.to_status == "running"


def test_batch_transition_emits_info_log_with_structured_extra(bus: RuntimeEventBus, caplog: pytest.LogCaptureFixture) -> None:
    audit_log.register(bus)

    with caplog.at_level(logging.INFO, logger=_AUDIT_LOGGER_NAME):
        bus.publish(
            BatchStateTransition(
                batch_id="batch-2",
                from_status=BatchStatus.RUNNING,
                to_status=BatchStatus.COMPLETED,
            )
        )

    records = [r for r in caplog.records if r.name == _AUDIT_LOGGER_NAME]
    assert len(records) == 1
    record = records[0]
    assert record.levelno == logging.INFO
    assert "batch-2" in record.getMessage()
    assert "running" in record.getMessage()
    assert "completed" in record.getMessage()
    assert record.task_runtime_event == "batch_state_transition"
    assert record.batch_id == "batch-2"
    assert record.from_status == "running"
    assert record.to_status == "completed"


def test_self_transition_is_still_logged(bus: RuntimeEventBus, caplog: pytest.LogCaptureFixture) -> None:
    audit_log.register(bus)

    with caplog.at_level(logging.INFO, logger=_AUDIT_LOGGER_NAME):
        bus.publish(
            RunStateTransition(
                run_id="run-3",
                batch_id="batch-3",
                from_status=TaskStatus.FAILED,
                to_status=TaskStatus.FAILED,
            )
        )

    records = [r for r in caplog.records if r.name == _AUDIT_LOGGER_NAME]
    assert len(records) == 1


def test_unsubscribe_stops_log_output(bus: RuntimeEventBus, caplog: pytest.LogCaptureFixture) -> None:
    unsubscribe = audit_log.register(bus)
    unsubscribe()

    with caplog.at_level(logging.INFO, logger=_AUDIT_LOGGER_NAME):
        bus.publish(
            RunStateTransition(
                run_id="run-4",
                batch_id="batch-4",
                from_status=TaskStatus.QUEUED,
                to_status=TaskStatus.RUNNING,
            )
        )

    records = [r for r in caplog.records if r.name == _AUDIT_LOGGER_NAME]
    assert records == []


def test_unknown_event_type_is_debug_logged(bus: RuntimeEventBus, caplog: pytest.LogCaptureFixture) -> None:
    audit_log.register(bus)

    class _SyntheticEvent:
        """Forward-compat shim for hypothetical future event types."""

    with caplog.at_level(logging.DEBUG, logger=_AUDIT_LOGGER_NAME):
        # Publish an unknown event through the bus to exercise the subscriber's
        # forward-compatible fallback branch.
        bus.publish(_SyntheticEvent())  # type: ignore[arg-type]

    records = [r for r in caplog.records if r.name == _AUDIT_LOGGER_NAME]
    assert len(records) == 1
    assert records[0].levelno == logging.DEBUG
    assert "unknown event type" in records[0].getMessage()
