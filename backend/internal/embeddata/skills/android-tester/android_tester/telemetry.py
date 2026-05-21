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

"""Lightweight telemetry: time blocks/functions, collect a report.

Default usage hits a module-level singleton::

    from android_tester.telemetry import measure_time, collect_report

    with measure_time("my_op"):
        ...
    print(collect_report())

For isolated collectors (tests, parallel runs), instantiate
``Telemetry`` directly and bind it via :func:`use_telemetry`::

    t = Telemetry()
    with use_telemetry(t), measure_time("my_op"):
        ...
    t.collect_report()
"""

from __future__ import annotations

import contextvars
import functools
import inspect
import logging
import math
import time
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from typing import Any, ParamSpec, TypeVar, overload

_P = ParamSpec("_P")
_T = TypeVar("_T")

logger = logging.getLogger(__name__)


class _Gaussian:
    """Running mean/std/min/max over a stream of floats."""

    __slots__ = ("_n", "_mean", "_sq", "_min", "_max")

    def __init__(self) -> None:
        self._n = 0
        self._mean = 0.0
        self._sq = 0.0
        self._min = math.inf
        self._max = -math.inf

    def push(self, x: float) -> None:
        self._n += 1
        delta = x - self._mean
        self._mean += delta / self._n
        self._sq += delta * (x - self._mean)
        if x < self._min:
            self._min = x
        if x > self._max:
            self._max = x

    def report(self) -> dict[str, Any]:
        if self._n == 0:
            return {"count": 0}
        r: dict[str, Any] = {
            "count": self._n,
            "mean": round(self._mean, 3),
            "min": round(self._min, 3),
            "max": round(self._max, 3),
        }
        if self._n > 1:
            r["std"] = round(
                math.sqrt(self._sq / (self._n - 1)), 3,
            )
        return r


class Telemetry:
    """An isolated telemetry collector."""

    __slots__ = ("_stats", "enabled")

    def __init__(self, *, enabled: bool = True) -> None:
        self._stats: dict[str, _Gaussian] = {}
        self.enabled = enabled

    def record(self, key: str, value: float) -> None:
        if not self.enabled:
            return
        stat = self._stats.get(key)
        if stat is None:
            stat = _Gaussian()
            self._stats[key] = stat
        stat.push(value)

    def collect_report(self) -> dict[str, Any]:
        return {k: s.report() for k, s in self._stats.items()}


class _MeasureTime:
    """Time a block (context manager) or function (decorator)."""

    __slots__ = ("_key", "_t0", "elapsed")

    def __init__(self, key: str) -> None:
        self._key = key
        self._t0 = 0.0
        self.elapsed = 0.0

    # --- context manager ---

    def __enter__(self) -> _MeasureTime:
        logger.info("measurement_start key=%s", self._key)
        self._t0 = time.perf_counter()
        return self

    def __exit__(self, *exc: object) -> None:
        self.elapsed = time.perf_counter() - self._t0
        logger.info(
            "measurement_end key=%s elapsed=%.3f",
            self._key, self.elapsed,
        )
        _current.get().record(self._key, self.elapsed)

    # --- decorator ---

    @overload
    def __call__(
        self, fn: Callable[_P, Awaitable[_T]],
    ) -> Callable[_P, Awaitable[_T]]: ...

    @overload
    def __call__(
        self, fn: Callable[_P, _T],
    ) -> Callable[_P, _T]: ...

    def __call__(
        self, fn: Callable[_P, Any],
    ) -> Callable[_P, Any]:
        key = self._key
        if inspect.iscoroutinefunction(fn):
            @functools.wraps(fn)
            async def _async_wrapper(
                *a: _P.args, **kw: _P.kwargs,
            ) -> Any:
                with _MeasureTime(key):
                    return await fn(*a, **kw)
            return _async_wrapper

        @functools.wraps(fn)
        def _sync_wrapper(
            *a: _P.args, **kw: _P.kwargs,
        ) -> Any:
            with _MeasureTime(key):
                return fn(*a, **kw)
        return _sync_wrapper


# --- module-level default instance + thin wrappers ---

default = Telemetry()
_current: contextvars.ContextVar[Telemetry] = contextvars.ContextVar(
    "android_tester_telemetry", default=default,
)


def init_telemetry(*, enabled: bool = True) -> None:
    """Enable or disable the default telemetry instance."""
    default.enabled = enabled


def measure_time(key: str) -> _MeasureTime:
    """Context manager / decorator bound to the *current* telemetry."""
    return _MeasureTime(key)


def collect_report() -> dict[str, Any]:
    """Snapshot the default instance's recorded stats."""
    return default.collect_report()


@contextmanager
def use_telemetry(telemetry: Telemetry) -> Iterator[Telemetry]:
    """Bind ``telemetry`` as the current instance for this context."""
    token = _current.set(telemetry)
    try:
        yield telemetry
    finally:
        _current.reset(token)
