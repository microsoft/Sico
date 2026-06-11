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

"""In-process metrics subscriber.

Counts state transitions by ``(from_status, to_status)`` separately for runs
and batches. Exposes a snapshot API for introspection (tests, debug
endpoints, future metrics exporters). This is intentionally a tiny
in-process aggregator — when we wire a real metrics backend (Prometheus,
StatsD, OTel) we can either add a second subscriber or have the exporter
read this snapshot.

Extension points:

* :class:`TransitionMetrics` is a plain class with ``record`` /
  ``snapshot`` / ``reset``; alternate implementations (e.g. one that
  forwards to OpenTelemetry) can be drop-in replacements.
* :func:`register` accepts an optional ``metrics`` argument so tests and
  future exporters can use a dedicated aggregator without colliding with
  the module-level default.
"""

from __future__ import annotations

import threading
from collections import Counter
from typing import TYPE_CHECKING

from ..event_bus import BatchStateTransition, RunStateTransition, RuntimeEvent

if TYPE_CHECKING:
    from ..event_bus import RuntimeEventBus, Unsubscribe

__all__ = [
    "TransitionMetrics",
    "get_default_metrics",
    "register",
    "reset_default_metrics",
    "snapshot_default_metrics",
]


def _key(from_value: str, to_value: str) -> str:
    return f"{from_value}->{to_value}"


class TransitionMetrics:
    """Thread-safe in-process counter for run/batch state transitions."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._run_counts: Counter[str] = Counter()
        self._batch_counts: Counter[str] = Counter()

    def record(self, event: RuntimeEvent) -> None:
        if isinstance(event, RunStateTransition):
            key = _key(event.from_status.value, event.to_status.value)
            with self._lock:
                self._run_counts[key] += 1
            return
        if isinstance(event, BatchStateTransition):
            key = _key(event.from_status.value, event.to_status.value)
            with self._lock:
                self._batch_counts[key] += 1
            return
        # Unknown event type — ignore silently; future event variants stay
        # forward-compatible without spamming counters.

    def snapshot(self) -> dict[str, dict[str, int]]:
        """Return a deep copy of the current counts.

        Shape::

            {
                "run":   {"queued->running": 5, "running->completed": 3, ...},
                "batch": {"queued->running": 1, "running->failed": 1, ...},
            }
        """

        with self._lock:
            return {
                "run": dict(self._run_counts),
                "batch": dict(self._batch_counts),
            }

    def reset(self) -> None:
        with self._lock:
            self._run_counts.clear()
            self._batch_counts.clear()


_DEFAULT_METRICS = TransitionMetrics()


def get_default_metrics() -> TransitionMetrics:
    return _DEFAULT_METRICS


def reset_default_metrics() -> None:
    """Zero the module-level metrics. Intended for test teardown."""

    _DEFAULT_METRICS.reset()


def snapshot_default_metrics() -> dict[str, dict[str, int]]:
    """Return a snapshot of the module-level metrics."""

    return _DEFAULT_METRICS.snapshot()


def register(
    bus: "RuntimeEventBus",
    metrics: TransitionMetrics | None = None,
) -> "Unsubscribe":
    """Wire a metrics aggregator onto ``bus`` and return its unsubscribe.

    When ``metrics`` is ``None`` the module-level default aggregator is
    used; tests should pass a dedicated :class:`TransitionMetrics` instance
    to keep their assertions isolated.
    """

    target = metrics if metrics is not None else _DEFAULT_METRICS
    return bus.subscribe(target.record)
