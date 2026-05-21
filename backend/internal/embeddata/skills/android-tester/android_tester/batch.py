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

"""Concurrent batch runner over a pool of Android devices.

Tasks are pushed onto an ``asyncio.Queue`` and consumed by one
:class:`_Worker` per device. Each worker pulls a task, runs it on its
dedicated ``AndroidController``, and loops until the queue is empty.
:meth:`BatchRunner.run` returns once every worker has terminated.

Per-task event streams (screenshots, operator/reflector logs, errors,
report URI, telemetry) go to a per-task ``events.jsonl`` inside the
task's output directory. The shared ``progress_broker`` (typically a
``JsonlBroker(sys.stdout)``) sees only ``task_started`` /
``task_finished`` events with progress counters, so interleaved
execution stays readable on the console.
"""

from __future__ import annotations

import asyncio
import logging
import traceback
import uuid
from collections.abc import Iterable, Sequence
from contextlib import AsyncExitStack
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from android_tester.android_controller import AndroidController
from android_tester.asset_uploader import (
    AssetUploader,
    DummyAssetUploader,
)
from android_tester.broker import JsonlBroker
from android_tester.image_store import (
    ImageStore,
    LocalImageStore,
    UploadingImageStore,
)
from android_tester.llm_hub import LLMHubClient
from android_tester.models import TaskStatus, TestCase, TestResult
from android_tester.prompts import PromptRenderer
from android_tester.recorder import RunRecorder
from android_tester.runner import TestRunner
from android_tester.telemetry import Telemetry, use_telemetry

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class _ProgressState:
    """Shared mutable state for progress tracking across workers."""

    total: int
    completed: int = 0
    succeeded: int = 0
    failed: int = 0


class BatchRunner:
    """Run tasks concurrently across a pool of devices.

    One worker is spawned per :class:`AndroidController` provided.
    Workers consume from a shared queue until it is empty, then
    terminate. ``run`` returns once every worker has terminated.
    """

    def __init__(
        self,
        controllers: Sequence[AndroidController],
        llm: LLMHubClient,
        prompts: PromptRenderer,
        output_root: Path,
        progress_broker: JsonlBroker,
        uploader: AssetUploader | None = None,
        runner_kwargs: dict[str, Any] | None = None,
    ) -> None:
        if not controllers:
            raise ValueError(
                "BatchRunner requires at least one controller",
            )
        self._controllers = list(controllers)
        self._llm = llm
        self._prompts = prompts
        self._output_root = output_root
        self._progress_broker = progress_broker
        self._uploader = uploader
        self._runner_kwargs: dict[str, Any] = runner_kwargs or {}

    async def run(
        self, cases: Iterable[TestCase],
    ) -> list[TestResult]:
        queue: asyncio.Queue[TestCase] = asyncio.Queue()
        for case in cases:
            queue.put_nowait(case)

        total = queue.qsize()
        if total == 0:
            return []

        state = _ProgressState(total=total)
        results: list[TestResult] = []
        results_lock = asyncio.Lock()

        await asyncio.gather(
            *(
                self._worker(c, queue, state, results, results_lock)
                for c in self._controllers
            ),
        )
        return results

    async def _worker(
        self,
        controller: AndroidController,
        queue: asyncio.Queue[TestCase],
        state: _ProgressState,
        results: list[TestResult],
        results_lock: asyncio.Lock,
    ) -> None:
        while True:
            try:
                case = queue.get_nowait()
            except asyncio.QueueEmpty:
                return
            result = await self._run_one(controller, case, state)
            async with results_lock:
                results.append(result)

    async def _run_one(
        self,
        controller: AndroidController,
        case: TestCase,
        state: _ProgressState,
    ) -> TestResult:
        device_id = controller.device_id
        task_id = case.task_id or str(uuid.uuid4())
        task_dir = self._output_root / task_id
        task_dir.mkdir(parents=True, exist_ok=True)
        log_file = task_dir / "events.jsonl"

        async with AsyncExitStack() as stack:
            stream = stack.enter_context(
                log_file.open("a", encoding="utf-8"),
            )
            file_broker = JsonlBroker(stream)
            recorder = RunRecorder(file_broker, task_dir)
            image_store = self._build_image_store(task_dir)

            await self._log_task_started(
                case, task_id, device_id, log_file, state,
            )
            telemetry = Telemetry()
            with use_telemetry(telemetry):
                status = await self._run_task_with_error_handling(
                    controller, case, task_id, task_dir, log_file,
                    recorder, image_store,
                )
            if report := telemetry.collect_report():
                await recorder.record("telemetry", **report)
            state.completed += 1
            if status is TaskStatus.COMPLETED:
                state.succeeded += 1
            else:
                state.failed += 1
            await self._log_task_finished(
                case, task_id, device_id, log_file, status, state,
            )

        return TestResult(
            case=case,
            task_id=task_id,
            status=status,
            output_dir=task_dir,
            log_file=log_file,
        )

    async def _run_task_with_error_handling(
        self,
        controller: AndroidController,
        case: TestCase,
        task_id: str,
        task_dir: Path,
        log_file: Path,
        recorder: RunRecorder,
        image_store: ImageStore,
    ) -> TaskStatus:
        runner = TestRunner(
            controller=controller,
            llm=self._llm,
            prompts=self._prompts,
            recorder=recorder,
            image_store=image_store,
            **self._runner_kwargs,
        )
        try:
            status = await runner.run(
                instruction=case.instruction,
                task_id=task_id,
                task_name=case.task_name,
            )
        except Exception as exc:
            status = TaskStatus.FAILED
            await self._log_task_error(
                exc, case, task_id, controller.device_id,
                task_dir, log_file,
            )
        return status

    async def _log_task_error(
        self,
        exc: BaseException,
        case: TestCase,
        task_id: str,
        device_id: str,
        task_dir: Path,
        log_file: Path,
    ) -> None:
        error_file = task_dir / "error.txt"
        tb = "".join(
            traceback.format_exception(
                type(exc), exc, exc.__traceback__,
            ),
        )
        try:
            error_file.write_text(tb, encoding="utf-8")
            error_file_str: str | None = str(error_file)
        except Exception as write_exc:
            logger.exception(
                "failed to persist error info for batch task %s "
                "to %s: %s",
                task_id, error_file, write_exc,
            )
            logger.exception(
                "original task error for %s", task_id, exc,
            )
            error_file_str = None

        await self._progress_broker.emit(
            "task_error",
            task_id=task_id,
            task_name=case.task_name,
            device_id=device_id,
            log_file=str(log_file),
            error_file=error_file_str,
            error=str(exc),
            error_type=type(exc).__name__,
        )

    async def _log_task_started(
        self,
        case: TestCase,
        task_id: str,
        device_id: str,
        log_file: Path,
        state: _ProgressState,
    ) -> None:
        await self._progress_broker.emit(
            "task_started",
            task_id=task_id,
            task_name=case.task_name,
            device_id=device_id,
            instruction=case.instruction,
            log_file=str(log_file),
            completed=state.completed,
            succeeded=state.succeeded,
            failed=state.failed,
            total=state.total,
            remaining=state.total - state.completed,
            progress=round(state.completed / state.total, 4),
        )

    async def _log_task_finished(
        self,
        case: TestCase,
        task_id: str,
        device_id: str,
        log_file: Path,
        status: TaskStatus,
        state: _ProgressState,
    ) -> None:
        await self._progress_broker.emit(
            "task_finished",
            task_id=task_id,
            task_name=case.task_name,
            device_id=device_id,
            status=status.value,
            log_file=str(log_file),
            completed=state.completed,
            succeeded=state.succeeded,
            failed=state.failed,
            total=state.total,
            remaining=state.total - state.completed,
            progress=round(state.completed / state.total, 4),
        )

    def _build_image_store(self, task_dir: Path) -> ImageStore:
        if (
            self._uploader is not None
            and not isinstance(self._uploader, DummyAssetUploader)
        ):
            return UploadingImageStore(self._uploader)
        return LocalImageStore(root=task_dir)
