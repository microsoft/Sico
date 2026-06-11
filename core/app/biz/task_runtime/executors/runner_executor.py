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

from __future__ import annotations

import asyncio
import time
from typing import Protocol

from ..models import ErrorClass, TaskResult, TaskRun, TaskStatus
from ..store import RunStore

# NOTE: EXPERIMENTAL / not wired into production. This module is deliberately
# kept out of the ``executors`` package public surface (``__init__.__all__``):
# the default factory + ``DispatchRouter`` never construct a ``RunnerExecutor``.
# It sketches the control-plane side of a future remote/distributed runner
# (enqueue a run, poll the store for the result a worker publishes). Import it
# explicitly from this module path if you are prototyping that backend.


class RunnerQueue(Protocol):
    async def enqueue(self, run_id: str) -> None: ...


class RunnerExecutor:
    def __init__(
        self,
        queue: RunnerQueue,
        *,
        poll_interval_seconds: float = 0.25,
        result_timeout_seconds: float = 3600.0,
    ) -> None:
        self.queue = queue
        self.poll_interval_seconds = poll_interval_seconds
        self.result_timeout_seconds = result_timeout_seconds

    async def enqueue(self, run_id: str) -> None:
        await self.queue.enqueue(run_id)

    async def run(self, run: TaskRun, store: RunStore) -> TaskResult:
        await self.enqueue(run.run_id)
        deadline = time.monotonic() + self.result_timeout_seconds
        while time.monotonic() < deadline:
            detail = await store.get_task_detail(run.run_id, "summary")
            if detail.result is not None:
                return detail.result
            await asyncio.sleep(self.poll_interval_seconds)
        now_ms = int(time.time() * 1000)
        return TaskResult(
            run_id=run.run_id,
            task_id=run.spec.task_id,
            status=TaskStatus.BLOCKED,
            title=run.spec.title,
            summary="Runner did not publish a task result before the control-plane wait timeout.",
            error_class=ErrorClass.TRANSIENT,
            error_message="Runner result wait timed out.",
            started_at=run.started_at,
            ended_at=now_ms,
            duration_ms=max(0, now_ms - (run.started_at or now_ms)),
        )
