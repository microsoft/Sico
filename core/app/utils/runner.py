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

import asyncio
import time
import traceback
from collections.abc import Awaitable, Callable
from typing import Any, Protocol

from app.utils.logger import logger


class JobRunner(Protocol):
    async def submit(self, fn: Callable[..., Any], *args, **kwargs) -> None: ...
    def submit_blocking(self, fn: Callable[..., Any], *args, **kwargs) -> None: ...
    async def close(self) -> None: ...

class AsyncJobRunner:
    """Simple async job runner with a bounded queue and worker tasks."""

    def __init__(self, workers: int = 4, max_queue: int = 200):
        self._queue: asyncio.Queue[tuple[Callable[..., Any], tuple, dict]] = asyncio.Queue(maxsize=max_queue)
        self._workers = workers
        self._tasks: list[asyncio.Task] = []
        self._closing = False

    async def start(self) -> None:
        for _ in range(self._workers):
            self._tasks.append(asyncio.create_task(self._worker()))

    def submit_blocking(self, fn: Callable[..., Any], *args, **kwargs) -> None:
        if self._closing:
            raise RuntimeError("Runner is closing; cannot accept new jobs")
        while True:
            while self._queue.full():
                time.sleep(0.01)
            try:
                self._queue.put_nowait((fn, args, kwargs))
                return
            except asyncio.QueueFull:
                continue

    async def submit(self, fn: Callable[..., Any], *args, **kwargs) -> None:
        if self._closing:
            raise RuntimeError("Runner is closing; cannot accept new jobs")
        await self._queue.put((fn, args, kwargs))

    async def _worker(self) -> None:
        while True:
            try:
                fn, args, kwargs = await self._queue.get()
            except asyncio.CancelledError:
                break
            try:
                result = fn(*args, **kwargs)
                if isinstance(result, Awaitable):
                    await result
            except Exception as e:  # Intentionally broad; log and continue
                # Replace with structured logging if available
                logger.error(f"[runner] job error: {e}")
                logger.error(traceback.format_exc())
            finally:
                self._queue.task_done()

    async def close(self) -> None:
        self._closing = True
        # Optionally drain: await self._queue.join()
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
