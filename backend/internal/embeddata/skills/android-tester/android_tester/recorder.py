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

"""Domain-aware recorder for a single test-task run.

:class:`RunRecorder` is the typed façade the runner uses to journal
what happened during a task: per-step events (screenshots,
operator/reflector messages, errors) and the final result. Each
call does two things:

1. Emits a structured event via an :class:`OutputBroker` (transport).
2. Accumulates per-step state used to render an HTML report when
   :meth:`record_result` fires.

The recorder is task-scoped: instantiate one per task. Reusing an
instance across tasks would mingle step state.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from android_tester.broker import OutputBroker
from android_tester.image_store import Image
from android_tester.report import StepRecord, render_report

_TASK_NAME_SANITIZER = re.compile(r"[^\w\-]+")


def _format_operator(data: dict[str, Any]) -> str:
    lines = [f"Thought: {data.get('thought', '')}"]
    lines.append(f"Action: {data.get('action', '')}({data.get('args', {})})")
    rescaled = data.get("rescaled_args")
    if rescaled is not None:
        lines.append(
            f"Rescaled: {data.get('action', '')}({rescaled})",
        )
    lines.append(f"Description: {data.get('conclusion', '')}")
    return "\n".join(lines)


def _format_reflector(data: dict[str, Any]) -> str:
    return (
        f"Outcome: {data.get('outcome', '')}\n"
        f"What Happened: {data.get('what_happened', '')}\n"
        f"Progress: {data.get('progress', '')}\n"
        f"Next Goal: {data.get('next_goal', '')}"
    )


class RunRecorder:
    """Records a single task run and writes its HTML report."""

    def __init__(
        self,
        broker: OutputBroker,
        output_dir: Path,
    ) -> None:
        self._broker = broker
        self._output_dir = output_dir
        self._steps: dict[int, StepRecord] = {}
        self._start_ts: str = datetime.now(UTC).isoformat()

    def _step(self, step: int) -> StepRecord:
        if step not in self._steps:
            self._steps[step] = StepRecord(step)
        return self._steps[step]

    async def record(
        self,
        kind: str,
        task_id: str | None = None,
        step: int | None = None,
        attempt: int | None = None,
        *,
        message: str | None = None,
        image: Image | None = None,
        description: str | None = None,
        **data: Any,
    ) -> None:
        """Record an event.

        For per-step kinds (``"screenshot"``, ``"operator"``,
        ``"reflector"``, ``"error"``) the typed params populate the
        accumulated :class:`StepRecord` used to render the report.
        Any other ``kind`` is passed straight through to the broker
        (e.g. telemetry); ``**data`` carries arbitrary payload keys.
        """
        if step is not None:
            step_rec = self._step(step)
            match kind:
                case "screenshot":
                    assert isinstance(image, Image), (
                        "record(screenshot) requires image"
                    )
                    step_rec.screenshots.append(
                        (image, description or ""),
                    )
                case "operator":
                    step_rec.operator = _format_operator(data)
                case "reflector":
                    step_rec.reflector = _format_reflector(data)
                case "error":
                    if message is not None:
                        step_rec.errors.append(message)

        await self._broker.emit(
            kind,
            task_id=task_id,
            step=step,
            attempt=attempt,
            message=message,
            image=image,
            description=description,
            **data,
        )

    async def record_completion(
        self,
        task_id: str,
        duration: float,
        status: str,
        task_name: str | None = None,
        instruction: str | None = None,
        device_id: str | None = None,
        reason: str | None = None,
        attempt: int | None = None,
    ) -> None:
        report_html = await render_report(
            steps=self._steps,
            task_id=task_id,
            duration=duration,
            status=status,
            start_ts=self._start_ts,
            task_name=task_name,
            instruction=instruction,
            device_id=device_id,
            reason=reason,
        )
        report_name = (
            "report-" + _TASK_NAME_SANITIZER.sub("_", task_name)
            if task_name
            else "report"
        )
        attempt_dir = (
            f"attempt-{attempt}" if attempt is not None else ""
        )
        path = self._output_dir / attempt_dir / f"{report_name}.html"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(report_html, encoding="utf-8")

        await self._broker.emit(
            "task_result",
            task_id=task_id,
            task_name=task_name,
            duration=duration,
            status=status,
            attempt=attempt,
            instruction=instruction,
            device_id=device_id,
            reason=reason,
            report_uri=str(path),
        )
        self.reset()

    def reset(self) -> None:
        self._steps = {}
        self._start_ts = datetime.now(UTC).isoformat()
