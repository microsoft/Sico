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

"""Per-run support utilities: stage timing and plan-cancellation polling.

Two small, state-free helpers shared by the run / sandbox coordinators:

- :class:`RunClock` accumulates monotonic-clock durations for the named stages
  of a single :class:`TaskRun`; its ``{stage}_ms`` map is folded into
  :attr:`TaskResult.metrics` for observability.
- The ``is_plan_cancelled`` / ``wait_for_plan_cancelled`` /
  ``await_unless_plan_cancelled`` helpers operate purely on the per-turn
  :class:`TurnContext` so collaborators can poll cancellation without depending
  on ``TaskManager``.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import time
from collections.abc import Awaitable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, TypeVar

from .context import TurnContext
from .models import PlanCancellationRequested

_T = TypeVar("_T")

# Stage labels recorded by the run/sandbox coordinators. Centralized so the
# metric keys stay stable for dashboards.
STAGE_SANDBOX_ACQUIRE = "sandbox_acquire"
STAGE_SANDBOX_RESET = "sandbox_reset"
STAGE_SANDBOX_RELEASE = "sandbox_release"
STAGE_EXECUTE = "execute"


def _now_monotonic_ms() -> int:
    return int(time.monotonic() * 1000)


@dataclass
class RunClock:
    """Accumulate per-stage durations (milliseconds) for one run."""

    timings_ms: dict[str, int] = field(default_factory=dict)

    def record(self, stage: str, duration_ms: int) -> None:
        if not stage or duration_ms < 0:
            return
        self.timings_ms[stage] = self.timings_ms.get(stage, 0) + duration_ms

    @contextmanager
    def measure(self, stage: str) -> Iterator[None]:
        """Time the wrapped block and add it to ``stage`` (even on error)."""
        started = _now_monotonic_ms()
        try:
            yield
        finally:
            self.record(stage, _now_monotonic_ms() - started)

    def as_metrics(self) -> dict[str, int]:
        """Return ``{stage}_ms`` metric keys for merging into a result."""
        return {f"{stage}_ms": value for stage, value in self.timings_ms.items()}


async def is_plan_cancelled(ctx: TurnContext) -> bool:
    """Return ``True`` when the parent plan has been cancelled by the user."""
    checker = getattr(ctx.plan_editor, "is_plan_cancelled", None)
    if checker is None:
        return False
    return bool(await checker())


def _cancel_poll_seconds() -> float:
    return max(0.1, float(os.getenv("TASK_RUNTIME_CANCEL_POLL_SECONDS", "0.5") or 0.5))


async def wait_for_plan_cancelled(ctx: TurnContext) -> bool:
    """Poll ``is_plan_cancelled`` until it flips, then return ``True``.

    Designed to be raced against an execution task via ``asyncio.wait`` so the
    runtime can promptly observe a user cancellation.
    """
    poll_seconds = _cancel_poll_seconds()
    while True:
        if await is_plan_cancelled(ctx):
            return True
        await asyncio.sleep(poll_seconds)


async def await_unless_plan_cancelled(ctx: TurnContext, awaitable: Awaitable[_T]) -> _T:
    """Await ``awaitable`` but raise :class:`PlanCancellationRequested` if the
    plan is cancelled first (cancelling the in-flight operation)."""
    operation_task: asyncio.Task[Any] = asyncio.create_task(awaitable)  # type: ignore[arg-type]
    cancel_task = asyncio.create_task(wait_for_plan_cancelled(ctx))
    try:
        done, _ = await asyncio.wait({operation_task, cancel_task}, return_when=asyncio.FIRST_COMPLETED)
        if cancel_task in done and cancel_task.result():
            operation_task.cancel()
            with contextlib.suppress(Exception, asyncio.CancelledError):
                await operation_task
            raise PlanCancellationRequested
        return await operation_task
    finally:
        cancel_task.cancel()
        with contextlib.suppress(Exception, asyncio.CancelledError):
            await cancel_task
