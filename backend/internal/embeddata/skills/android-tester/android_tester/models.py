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

from dataclasses import dataclass, field
from enum import StrEnum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from android_tester.image_store import Image
from pathlib import Path


class TaskStatus(StrEnum):
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass(slots=True)
class TestCase:
    """One test task to run."""

    instruction: str
    task_id: str | None = None
    task_name: str | None = None


@dataclass(slots=True)
class TestResult:
    """Outcome of running a single :class:`TestCase`."""

    case: TestCase
    task_id: str
    status: TaskStatus
    output_dir: Path
    log_file: Path


@dataclass(slots=True)
class Device:
    id: str
    name: str


@dataclass(slots=True)
class RunState:
    instruction: str
    task_name: str | None = None
    attempt: int | None = None
    progress_status: str = ""
    current_step_goal: str = ""
    last_reflection_obj: Reflection | None = None
    actions: list[str] = field(default_factory=list)
    summaries: list[str] = field(default_factory=list)
    action_keys: list[str] = field(default_factory=list)
    operator_history: list[tuple[str, Image, str]] = field(
        default_factory=list,
    )


class AnswerFormatError(ValueError):
    """Raised when an LLM-produced answer cannot be parsed or executed."""

    def __init__(self, message: str) -> None:
        super().__init__(message)


@dataclass(slots=True)
class Reflection:
    what_happened: str
    outcome: str
    updated_state: str
    next_step_goal: str
