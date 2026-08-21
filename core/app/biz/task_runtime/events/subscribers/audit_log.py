"""Audit log subscriber.

Emits a single structured INFO-level log line per state transition. The log
line uses :meth:`logging.Logger.info` with structured ``extra`` fields so it
plays nicely with log aggregators that parse JSON / key-value payloads, and
falls back to a human-readable message body for plain text logs.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from ..bus import BatchStateTransition, RunStateTransition, RuntimeEvent

if TYPE_CHECKING:
    from ..bus import RuntimeEventBus, Unsubscribe

__all__ = ["register"]


_LOGGER = logging.getLogger(__name__)


def _handle(event: RuntimeEvent) -> None:
    if isinstance(event, RunStateTransition):
        _LOGGER.info(
            "task_runtime.run %s %s -> %s (batch=%s)",
            event.run_id,
            event.from_status.value,
            event.to_status.value,
            event.batch_id,
            extra={
                "task_runtime_event": "run_state_transition",
                "run_id": event.run_id,
                "batch_id": event.batch_id,
                "from_status": event.from_status.value,
                "to_status": event.to_status.value,
            },
        )
        return
    if isinstance(event, BatchStateTransition):
        _LOGGER.info(
            "task_runtime.batch %s %s -> %s",
            event.batch_id,
            event.from_status.value,
            event.to_status.value,
            extra={
                "task_runtime_event": "batch_state_transition",
                "batch_id": event.batch_id,
                "from_status": event.from_status.value,
                "to_status": event.to_status.value,
            },
        )
        return
    # Unknown event type — log at debug so the bus stays open for future
    # event variants without spamming production logs.
    _LOGGER.debug("task_runtime audit_log: unknown event type %s", type(event).__name__)


def register(bus: "RuntimeEventBus") -> "Unsubscribe":
    """Wire the audit log handler onto ``bus`` and return its unsubscribe."""

    return bus.subscribe(_handle)
