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

"""Domain-aware event logger for a single test-task run.

:class:`EventLogger` is the typed façade the runner uses to journal
what happened during a task: per-step events (screenshots,
operator/reflector messages, errors) and the final result. Each
call does two things:

1. Emits a structured event via an :class:`OutputBroker` (transport).
2. Accumulates per-step state used to render an HTML report when
   :meth:`record_result` fires.

The event logger is task-scoped: instantiate one per task. Reusing an
instance across tasks would mingle step state.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from android_tester.broker import OutputBroker
from android_tester.image_store import Image
from android_tester.models import PreconditionRecord
from android_tester.report import StepRecord, render_report
from android_tester.utils import write_file_atomically

_TASK_NAME_SANITIZER = re.compile(r"[^\w\-]+")
_MAX_REPORT_NAME_LEN = 80


def _format_operator(data: dict[str, Any]) -> str:
    lines = [
        f"Thought: {data.get('thought', '')}",
        f"Action: {data.get('action', '')}({data.get('args', {})})",
    ]
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


def _format_replay(data: dict[str, Any]) -> str:
    action = data.get("action", "")
    args = data.get("args", "")
    matched_by = data.get("matched_by", "")
    detail = data.get("detail", "")
    lines = [f"Replay [{matched_by}]: {action}({args})"]
    if detail:
        lines.append(f"Detail: {detail}")
    return "\n".join(lines)


def _format_action_result(data: dict[str, Any]) -> str:
    action = str(data.get("action", ""))
    execution_result = {
        k: v
        for k, v in (data.get("execution_result") or {}).items()
        if v is not None
    }
    rendered = json.dumps(
        execution_result,
        ensure_ascii=False,
        sort_keys=True,
        default=str,
    )
    if action:
        return f"{action}: {rendered}"
    return rendered


class EventLogger:
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

    @property
    def recorded_step_count(self) -> int:
        """Highest step number recorded so far (0 if none)."""
        return max(self._steps, default=0)

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
        step_rec: StepRecord | None = None
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
                    current_step = data.get("current_step")
                    if isinstance(current_step, str):
                        step_rec.current_step = current_step.strip() or None
                    current_step_id = data.get("current_step_id")
                    if isinstance(current_step_id, int):
                        step_rec.current_step_id = current_step_id or None
                    step_rec.operator = _format_operator(data)
                case "reflector":
                    step_rec.reflector = _format_reflector(data)
                case "replay":
                    step_rec.operator = _format_replay(data)
                case "action_result":
                    step_rec.action_result = _format_action_result(data)
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
        preconditions: list[PreconditionRecord] | None = None,
        precondition_duration: float = 0.0,
        total_duration: float | None = None,
        precondition_step_boundary: int = 0,
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
            preconditions=preconditions or [],
            precondition_duration=precondition_duration,
            total_duration=total_duration or duration,
            precondition_step_boundary=precondition_step_boundary,
        )
        report_name = (
            "report-" + _TASK_NAME_SANITIZER.sub(
                "_", task_name,
            ).strip("_")[:_MAX_REPORT_NAME_LEN]
            if task_name
            else "report"
        )
        attempt_dir = (
            f"attempt-{attempt}" if attempt is not None else ""
        )
        path = self._output_dir / attempt_dir / f"{report_name}.html"
        write_file_atomically(path, report_html)

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
