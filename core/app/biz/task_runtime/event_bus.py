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

"""Task runtime event bus.

A single publish/subscribe surface for runtime state transitions. The state
machine (``state_machine.transition_run`` / ``transition_batch``) emits a
typed event after every successful in-place transition, and interested
parties (audit log, metrics, future plan-editor refresh, reverse gRPC sync,
…) can subscribe to react.

Design notes:

* **Synchronous, in-memory only.** Publish/subscribe runs in-process and
  synchronous. Subscribers that need to do async work should spawn their
  own task. Cross-process delivery is not in scope.
* **Handlers must not raise.** Exceptions are caught and logged so a buggy
  subscriber cannot corrupt the calling state-mutation site.
* **Default module-level bus.** The default bus is process-wide; production
  code publishes against it via the module-level :func:`publish`. Tests
  that need isolation should construct a dedicated :class:`RuntimeEventBus`
  instance and either drive it directly or swap it in via
  :func:`set_default_bus` inside an autouse fixture.
* **Self-transitions are still published.** Idempotent re-marks ("the
  reconciler re-finalized an already-FAILED run") are real state activity
  worth observing; subscribers can filter on ``from_status == to_status``
  if they only want true transitions.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Callable, Union

from .models import BatchStatus, TaskStatus

__all__ = [
    "BatchStateTransition",
    "EventHandler",
    "RunStateTransition",
    "RuntimeEvent",
    "RuntimeEventBus",
    "clear_default_bus",
    "get_default_bus",
    "publish",
    "set_default_bus",
    "subscribe",
]


_LOGGER = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Event payloads
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class RunStateTransition:
    """Emitted after a TaskRun's status field is updated in place."""

    run_id: str
    batch_id: str
    from_status: TaskStatus
    to_status: TaskStatus


@dataclass(frozen=True, slots=True)
class BatchStateTransition:
    """Emitted after a BatchRecord's status field is updated in place."""

    batch_id: str
    from_status: BatchStatus
    to_status: BatchStatus


RuntimeEvent = Union[RunStateTransition, BatchStateTransition]

EventHandler = Callable[[RuntimeEvent], None]

Unsubscribe = Callable[[], None]


# ---------------------------------------------------------------------------
# Bus
# ---------------------------------------------------------------------------


class RuntimeEventBus:
    """In-process publish/subscribe surface for runtime state transitions.

    Handlers are invoked in registration order. Exceptions raised by a
    handler are caught and logged so a faulty subscriber cannot break the
    publisher (the state-mutation site).
    """

    def __init__(self) -> None:
        self._handlers: list[EventHandler] = []
        self._lock = threading.RLock()

    def subscribe(self, handler: EventHandler) -> Unsubscribe:
        with self._lock:
            self._handlers.append(handler)

        def _unsubscribe() -> None:
            with self._lock:
                try:
                    self._handlers.remove(handler)
                except ValueError:
                    # Already removed (or removed via clear()) — idempotent.
                    pass

        return _unsubscribe

    def publish(self, event: RuntimeEvent) -> None:
        with self._lock:
            snapshot = list(self._handlers)
        for handler in snapshot:
            try:
                handler(event)
            except Exception:
                _LOGGER.exception(
                    "task_runtime event handler raised; suppressing event=%s",
                    type(event).__name__,
                )

    def clear(self) -> None:
        with self._lock:
            self._handlers.clear()

    def handler_count(self) -> int:
        with self._lock:
            return len(self._handlers)


# ---------------------------------------------------------------------------
# Module-level default bus
# ---------------------------------------------------------------------------


_DEFAULT_BUS: RuntimeEventBus = RuntimeEventBus()


def get_default_bus() -> RuntimeEventBus:
    return _DEFAULT_BUS


def set_default_bus(bus: RuntimeEventBus) -> None:
    """Swap the process-wide default bus. Intended for tests that want full
    isolation; production code should rely on the module-level singleton.
    """

    global _DEFAULT_BUS
    _DEFAULT_BUS = bus


def clear_default_bus() -> None:
    """Remove every subscriber from the default bus. Intended for test
    teardown."""

    _DEFAULT_BUS.clear()


def subscribe(handler: EventHandler) -> Unsubscribe:
    """Subscribe ``handler`` on the default bus and return an unsubscribe
    callback."""

    return _DEFAULT_BUS.subscribe(handler)


def publish(event: RuntimeEvent) -> None:
    """Publish ``event`` to the default bus."""

    _DEFAULT_BUS.publish(event)
